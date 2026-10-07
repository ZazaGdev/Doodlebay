// Excalidraw draws images on a canvas, which only ever shows a GIF's first frame, and it
// re-encodes every inserted image through a canvas too, which throws the other frames away.
// So keepGif hands Excalidraw the same file id it would make itself, but remembers the
// original GIF, and keepGifFrames puts it back into the drawing's files before they are
// saved. MediaLayer then lays a live <img> of each GIF, and a <video> for each video image
// (see videoDrop.js), over the spot the canvas draws it: under the selection handles and
// above the rest of the drawing, the way Excalidraw places embeds. The canvas copy stays,
// so exports and thumbnails show a still frame.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { newElementWith, CaptureUpdateAction } from '@excalidraw/excalidraw';
import { mediaURL, adoptVideos, claimLoaded } from './videoDrop.js';

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

const isGif = (el, files) => !!el.fileId && files[el.fileId]?.mimeType === GIF;
const isVideo = el => typeof el.customData?.video === 'string';
const mediaIn = (elements, files) => elements.filter(e =>
  e.type === 'image' && !e.isDeleted && (isVideo(e) || isGif(e, files)));

// Where the element sits on screen, and how a cropped picture fills it.
function place(el, appState) {
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
  const c = el.crop;
  const inner = c
    ? {
        width: c.naturalWidth * (box.width / c.width),
        height: c.naturalHeight * (box.height / c.height),
        left: -c.x * (box.width / c.width),
        top: -c.y * (box.height / c.height),
      }
    : { width: '100%', height: '100%', left: 0, top: 0 };
  return { box, inner };
}

function Video({ el, src, appState, muted }) {
  const ref = useRef(null);
  const loop = el.customData.loop !== false;
  // React does not keep the muted property in step, so set it here.
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  // Turning repeat back on restarts a video that already reached its end. (With loop set,
  // `ended` reads false, so look at `paused` instead.)
  useEffect(() => { const v = ref.current; if (v && loop && v.paused) v.play().catch(() => {}); }, [loop]);
  const { box, inner } = place(el, appState);
  return (
    <div className="media-item" style={box}>
      <video ref={ref} src={src} style={inner} autoPlay muted loop={loop} playsInline />
    </div>
  );
}

// Sound and repeat buttons above the selected video.
function Controls({ el, appState, muted, onMuted, onLoop }) {
  const { box } = place(el, appState);
  const loop = el.customData.loop !== false;
  return (
    <div className="media-controls" style={{ left: box.left, top: Math.max(0, box.top - 34) }}>
      <button className={muted ? '' : 'on'} onClick={() => onMuted(!muted)} title="Sound for this video while the board is open">
        {muted ? 'Unmute' : 'Mute'}
      </button>
      <button className={loop ? 'on' : ''} onClick={() => onLoop(!loop)} title="Play again from the start when it ends">
        Repeat: {loop ? 'on' : 'off'}
      </button>
    </div>
  );
}

// One layer just before the interactive canvas, so selection handles draw on top; the
// controls go after it, so they can be clicked.
function useHosts(api) {
  const [hosts, setHosts] = useState(null);
  useEffect(() => {
    if (!api) return;
    const canvas = document.querySelector('.excalidraw canvas.interactive');
    if (!canvas) return;
    const layer = document.createElement('div');
    layer.className = 'media-layer';
    const controls = document.createElement('div');
    controls.className = 'media-layer media-layer-controls';
    canvas.parentElement.insertBefore(layer, canvas);
    canvas.after(controls);
    setHosts({ layer, controls });
    return () => { layer.remove(); controls.remove(); setHosts(null); };
  }, [api]);
  return hosts;
}

export default function MediaLayer({ api, file, onError }) {
  const [scene, setScene] = useState(null);
  const [unmuted, setUnmuted] = useState(() => new Set());
  const hosts = useHosts(api);
  const fileRef = useRef(file);
  fileRef.current = file;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  // Set once the board's own content has loaded (see claimLoaded).
  const loaded = useRef(false);

  useEffect(() => {
    if (!api) return;
    const update = (elements, appState, files) => {
      keepGifFrames(files);
      const items = mediaIn(elements, files);
      if (!appState.isLoading && !loaded.current && fileRef.current) {
        loaded.current = true;
        claimLoaded(fileRef.current, items);
      }
      adoptVideos(api, fileRef.current, items, errorRef.current);
      setScene(prev => (!items.length && !prev?.items.length ? prev : { items, appState, files }));
    };
    update(api.getSceneElements(), api.getAppState(), api.getFiles());
    return api.onChange(update);
  }, [api]);

  if (!hosts || !scene?.items.length) return null;
  const { items, appState, files } = scene;
  const shown = items.filter(el => el.id !== appState.croppingElementId && (!isVideo(el) || file));
  const selected = Object.keys(appState.selectedElementIds || {});
  const picked = selected.length === 1 && shown.find(el => el.id === selected[0] && isVideo(el));

  const setMuted = (id, muted) => setUnmuted(prev => {
    const next = new Set(prev);
    if (muted) next.delete(id); else next.add(id);
    return next;
  });
  const setLoop = (id, loop) => api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map(e =>
      (e.id === id ? newElementWith(e, { customData: { ...e.customData, loop } }) : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return (
    <>
      {createPortal(shown.map(el => (isVideo(el)
        ? <Video key={el.id} el={el} src={mediaURL(file, el.customData.video)} appState={appState} muted={!unmuted.has(el.id)} />
        : (
          <div key={el.id} className="media-item" style={place(el, appState).box}>
            <img src={files[el.fileId].dataURL} alt="" draggable={false} style={place(el, appState).inner} />
          </div>
        ))), hosts.layer)}
      {picked && !appState.selectedElementsAreBeingDragged && createPortal(
        <Controls el={picked} appState={appState} muted={!unmuted.has(picked.id)}
          onMuted={m => setMuted(picked.id, m)} onLoop={l => setLoop(picked.id, l)} />,
        hosts.controls,
      )}
    </>
  );
}
