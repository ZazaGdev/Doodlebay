// Videos on a board are not stored inside the .excalidraw file. Each one is copied into a
// folder next to the board, "Board.media", and the board keeps the path relative to its own
// folder ("Board.media/clip.mp4"), so the board and its folder can move together.
import fs from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import path from 'node:path';
import { EXT, isInside, cleanName } from './files.js';

export const MEDIA = '.media';
export const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg' };

export const mediaDir = board => path.join(path.dirname(board), path.basename(board, EXT) + MEDIA);

const isBoard = board => String(board || '').toLowerCase().endsWith(EXT);
const videoExt = name => {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!VIDEO_TYPES[ext]) throw new Error('Only MP4, WebM, MOV and OGV videos can be added.');
  return ext;
};

// Copies a video into the board's media folder under a free name ("clip.mp4", "clip 2.mp4"...)
// and returns what the board stores for it. source is the video's path on disk, or its bytes
// (then name gives the file name). Each name is claimed exclusively, so two adds at once
// never write over each other.
export async function addMediaFile(board, name, source) {
  if (!isBoard(board)) throw new Error('Videos can only be added to a drawing.');
  if (typeof source === 'string') {
    videoExt(source);
    if (!(await fs.stat(source)).isFile()) throw new Error('Not a file.');
    name = path.basename(source);
  }
  const ext = videoExt(name);
  const base = cleanName(path.basename(name, path.extname(name))) || 'video';
  const dir = mediaDir(board);
  await fs.mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const target = path.join(dir, `${n === 1 ? base : `${base} ${n}`}${ext}`);
    try {
      if (typeof source === 'string') await fs.copyFile(source, target, fsc.COPYFILE_EXCL);
      else await fs.writeFile(target, Buffer.from(source), { flag: 'wx' });
      return relativeToBoard(board, target);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

// What the board stores for a media file: its path from the board's folder, with forward slashes.
export const relativeToBoard = (board, file) => path.relative(path.dirname(board), file).split(path.sep).join('/');

// The media file a board refers to. Only files inside that board's media folder are allowed.
export function resolveMedia(board, rel) {
  if (!isBoard(board)) throw new Error('Not a drawing.');
  const full = path.resolve(path.dirname(board), String(rel || ''));
  if (!isInside(mediaDir(board), full) || full.toLowerCase() === mediaDir(board).toLowerCase()) throw new Error('Not a media file of this drawing.');
  return full;
}

// A board that comes back under a new name ("Board 2") gets its media folder renamed to
// match, so its stored video paths are rewritten from "Board.media/" to "Board 2.media/".
export function renameMediaRefs(text, oldBoard, newBoard) {
  const from = path.basename(oldBoard, EXT) + MEDIA + '/';
  const to = path.basename(newBoard, EXT) + MEDIA + '/';
  if (from === to) return text;
  try {
    const scene = JSON.parse(text);
    let changed = false;
    for (const el of scene.elements || []) {
      const v = el.customData?.video;
      if (typeof v === 'string' && v.startsWith(from)) {
        el.customData = { ...el.customData, video: to + v.slice(from.length) };
        changed = true;
      }
    }
    return changed ? JSON.stringify(scene, null, 2) : text;
  } catch { return text; }
}
