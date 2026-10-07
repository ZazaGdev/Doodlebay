// Excalidraw draws images on a canvas, which only ever shows a GIF's first frame, and it
// re-encodes every inserted image through a canvas too, which throws the other frames away.
// So keepGif hands Excalidraw the same file id it would make itself, but remembers the
// original GIF, and keepGifFrames puts it back into the drawing's files before they are
// saved. MediaLayer then lays a live <img> of each GIF over the spot the canvas draws it,
// under the selection handles and above the rest of the drawing, the way Excalidraw
// places embeds. The canvas copy stays, so exports and thumbnails show a still frame.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const GIF = 'image/gif';
const originals = new Map();

const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const readDataURL = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// Excalidraw's own id for a file is the SHA-1 of its bytes; keep that so duplicates still match.
export async function keepGif(file) {
  const bytes = await file.arrayBuffer();
  const id = hex(await crypto.subtle.digest('SHA-1', bytes));
  if (file.type === GIF) originals.set(id, await readDataURL(file));
  return id;
}

// Swaps the re-encoded copy for the original GIF. The file objects are Excalidraw's own,
// so the next save writes the animated GIF.
export function keepGifFrames(files) {
  for (const [id, dataURL] of originals) {
    const f = files?.[id];
    if (!f) continue;
    if (f.dataURL !== dataURL) f.dataURL = dataURL;
    originals.delete(id);
  }
}

const gifsIn = (elements, files) => elements.filter(e =>
  e.type === 'image' && !e.isDeleted && e.fileId && files[e.fileId]?.mimeType === GIF);

function Gif({ el, src, appState }) {
  const z = appState.zoom.value;
  const [sx, sy] = el.scale || [1, 1];
  const box = {
    left: (el.x + appState.scrollX) * z,
    top: (el.y + appState.scrollY) * z,
    width: el.width * z,
    height: el.height * z,
    opacity: el.opacity / 100,
    transform: `rotate(${el.angle}rad) scale(${sx}, ${sy})`,
  };
  // A cropped image shows part of the picture, scaled so that part fills the element.
  const c = el.crop;
  const img = c
    ? {
        width: c.naturalWidth * (box.width / c.width),
        height: c.naturalHeight * (box.height / c.height),
        left: -c.x * (box.width / c.width),
        top: -c.y * (box.height / c.height),
      }
    : { width: '100%', height: '100%', left: 0, top: 0 };
  return (
    <div className="media-item" style={box}>
      <img src={src} alt="" draggable={false} style={img} />
    </div>
  );
}

export default function MediaLayer({ api }) {
  const [scene, setScene] = useState(null);
  const [host, setHost] = useState(null);

  useEffect(() => {
    if (!api) return;
    const update = (elements, appState, files) => {
      keepGifFrames(files);
      const gifs = gifsIn(elements, files);
      setScene(prev => (!gifs.length && !prev?.gifs.length ? prev : { gifs, appState, files }));
    };
    update(api.getSceneElements(), api.getAppState(), api.getFiles());
    return api.onChange(update);
  }, [api]);

  // The layer goes just before the interactive canvas, so selection handles draw on top.
  useEffect(() => {
    if (!api) return;
    const canvas = document.querySelector('.excalidraw canvas.interactive');
    if (!canvas) return;
    const div = document.createElement('div');
    div.className = 'media-layer';
    canvas.parentElement.insertBefore(div, canvas);
    setHost(div);
    return () => { div.remove(); setHost(null); };
  }, [api]);

  if (!host || !scene?.gifs.length) return null;
  const { gifs, appState, files } = scene;
  return createPortal(
    gifs
      .filter(el => el.id !== appState.croppingElementId)
      .map(el => <Gif key={el.id} el={el} src={files[el.fileId].dataURL} appState={appState} />),
    host,
  );
}
