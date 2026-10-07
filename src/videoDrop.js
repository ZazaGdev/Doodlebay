// Adding a video to a board. Excalidraw has no video element, so a video goes on the board
// as an image of its first frame, with customData.video pointing at the copy in the board's
// media folder (see lib/media.js). MediaLayer plays the video over that image, and exports
// show the frame. customData.loop is the per-video repeat setting, on for a new video.
import { convertToExcalidrawElements, viewportCoordsToSceneCoords, CaptureUpdateAction } from '@excalidraw/excalidraw';

const VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i;
const POSTER_MAX = 1280;
const BOARD_MAX = 640;

export const videosIn = files => [...(files || [])].filter(f => f.type.startsWith('video/') || VIDEO.test(f.name));

export const mediaURL = (board, src) =>
  `${location.origin}/media?board=${encodeURIComponent(board)}&src=${encodeURIComponent(src)}`;

// A JPEG of the video's first moments. Fails for a format Chromium cannot play, before
// anything is copied.
function posterOf(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = fn => arg => { URL.revokeObjectURL(url); v.removeAttribute('src'); fn(arg); };
    v.muted = true;
    v.preload = 'auto';
    v.onloadeddata = () => { v.currentTime = Math.min(0.1, (v.duration || 0) / 2); };
    v.onseeked = done(() => {
      const scale = Math.min(1, POSTER_MAX / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      resolve({ dataURL: c.toDataURL('image/jpeg', 0.85), width: c.width, height: c.height });
    });
    v.onerror = done(() => reject(new Error(`${file.name} is not a video format Doodlebay can play.`)));
    v.src = url;
  });
}

// Copies the video next to the board and places it centred on the given point of the window.
export async function addVideo(api, board, file, clientX, clientY) {
  const poster = await posterOf(file);
  const src = await window.desk.addMedia(board, file.name, window.desk.pathOf(file) || await file.arrayBuffer());
  const fileId = crypto.randomUUID().replace(/-/g, '');
  const scale = Math.min(1, BOARD_MAX / Math.max(poster.width, poster.height));
  const width = poster.width * scale;
  const height = poster.height * scale;
  const { x, y } = viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
  api.addFiles([{ id: fileId, dataURL: poster.dataURL, mimeType: 'image/jpeg', created: Date.now() }]);
  const [el] = convertToExcalidrawElements([{
    type: 'image', fileId, status: 'saved', x: x - width / 2, y: y - height / 2, width, height,
    customData: { video: src, loop: true },
  }]);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), el],
    appState: { selectedElementIds: { [el.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
