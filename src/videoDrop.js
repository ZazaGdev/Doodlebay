// Adding a video to a board. Excalidraw has no video element, so a video goes on the board
// as an image of its first frame, with customData.video pointing at the copy in the board's
// media folder (see lib/media.js). MediaLayer plays the video over that image, and exports
// show the frame. customData.loop is the per-video repeat setting, on for a new video, and
// customData.id tells videos apart when they are copied between boards.
import { convertToExcalidrawElements, viewportCoordsToSceneCoords, newElementWith, CaptureUpdateAction } from '@excalidraw/excalidraw';

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
    customData: { video: src, loop: true, id: newId() },
  }]);
  claim(board, el.customData.id, src);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), el],
    appState: { selectedElementIds: { [el.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

// A video copied from board A and pasted into board B still points at "A.media/...", which
// B cannot play. Each video's id is remembered with the board it belongs to (when that board
// is opened or the video is added), so a video with an id B does not own is copied into
// B's media folder, under a new id, and pointed there. Board names are not enough: two
// folders can each hold an "Untitled 1". Excalidraw can still put its own copy of a
// just-pasted element back afterwards, so the new path is applied on every change until it
// holds.
const newId = () => crypto.randomUUID().replace(/-/g, '');
const lower = board => board.toLowerCase();
const owned = new Map(); // board -> Set of video ids
const homes = new Map(); // video id -> the video file on disk
// `${board}|${id}` -> a promise while copying, { video, id } once copied, null if it failed
const copies = new Map();
const onDisk = (board, src) => board.replace(/[^\\/]+$/, '') + src.replace(/\//g, '\\');
const ownedBy = board => {
  if (!owned.has(lower(board))) owned.set(lower(board), new Set());
  return owned.get(lower(board));
};

function claim(board, id, src) {
  ownedBy(board).add(id);
  homes.set(id, onDisk(board, src));
}

// The videos a board has when it opens are its own, except ones a paste left pointing
// elsewhere when the board was closed before their copy was done.
export function claimLoaded(board, elements) {
  for (const el of elements) {
    const { id, video } = el.customData || {};
    if (typeof id !== 'string' || typeof video !== 'string') continue;
    if (copies.get(`${lower(board)}|${id}`)) continue;
    claim(board, id, video);
  }
}

function repoint(api, board) {
  const done = e => copies.get(`${lower(board)}|${e.customData?.id}`);
  const stale = e => !!done(e) && typeof done(e).id === 'string';
  if (!api.getSceneElementsIncludingDeleted().some(stale)) return;
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map(e => (stale(e)
      ? newElementWith(e, { customData: { ...e.customData, video: done(e).video, id: done(e).id } })
      : e)),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

export function adoptVideos(api, board, elements, onError) {
  if (!board) return;
  const own = ownedBy(board);
  let due = false;
  for (const el of elements) {
    const { id, video } = el.customData || {};
    if (typeof id !== 'string' || typeof video !== 'string' || own.has(id)) continue;
    const key = `${lower(board)}|${id}`;
    if (copies.has(key)) { due ||= typeof copies.get(key)?.id === 'string'; continue; }
    const home = homes.get(id);
    // Pasted from a board not opened in this run of the app: nothing known to copy from.
    if (!home) { copies.set(key, null); continue; }
    copies.set(key, window.desk.addMedia(board, video.split('/').pop(), home)
      .then(copy => {
        const fresh = newId();
        claim(board, fresh, copy);
        copies.set(key, { video: copy, id: fresh });
        setTimeout(() => repoint(api, board));
      })
      .catch(err => {
        copies.set(key, null);
        onError?.(`Could not copy the pasted video: ${err.message}`);
      }));
  }
  if (due) setTimeout(() => repoint(api, board));
}
