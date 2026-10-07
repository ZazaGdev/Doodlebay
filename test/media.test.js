import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mediaDir, addMediaFile, resolveMedia } from '../lib/media.js';
import { listDir } from '../lib/files.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-'));

test('a board keeps its videos in "<name>.media" beside it, with free names', async () => {
  const dir = await tmp();
  const board = path.join(dir, 'Plan.excalidraw');
  assert.equal(mediaDir(board), path.join(dir, 'Plan.media'));
  assert.equal(await addMediaFile(board, 'my:clip.MP4', new Uint8Array([1])), 'Plan.media/my-clip.mp4');
  // Two at once with the same name each get their own file.
  const both = await Promise.all([1, 2].map(b => addMediaFile(board, 'my:clip.mp4', new Uint8Array([b]))));
  assert.deepEqual(both.sort(), ['Plan.media/my-clip 2.mp4', 'Plan.media/my-clip 3.mp4']);
  const bytes = await Promise.all(both.map(r => fs.readFile(path.join(dir, r))));
  assert.deepEqual(bytes.map(b => b[0]).sort(), [1, 2]);
  await assert.rejects(addMediaFile(board, 'notes.txt', new Uint8Array([1])), /Only MP4/);
  await assert.rejects(addMediaFile(dir, 'a.mp4', new Uint8Array([1])), /drawing/);
});

test('a video copied from disk must be a video file', async () => {
  const dir = await tmp();
  const board = path.join(dir, 'Plan.excalidraw');
  const secret = path.join(dir, 'secret.txt');
  await fs.writeFile(secret, 'key');
  await assert.rejects(addMediaFile(board, 'x.mp4', secret), /Only MP4/);
  await fs.mkdir(path.join(dir, 'folder.mp4'));
  await assert.rejects(addMediaFile(board, 'x.mp4', path.join(dir, 'folder.mp4')));
  const clip = path.join(dir, 'Real clip.webm');
  await fs.writeFile(clip, 'v');
  assert.equal(await addMediaFile(board, 'ignored.mp4', clip), 'Plan.media/Real clip.webm');
});

test('resolveMedia only gives files inside that board\'s media folder', () => {
  const board = 'C:\\d\\Plan.excalidraw';
  assert.equal(resolveMedia(board, 'Plan.media/a.mp4'), 'C:\\d\\Plan.media\\a.mp4');
  assert.throws(() => resolveMedia(board, 'Other.media/a.mp4'));
  assert.throws(() => resolveMedia(board, 'Plan.media/../secret.mp4'));
  assert.throws(() => resolveMedia(board, 'Plan.media'));
  assert.throws(() => resolveMedia(board, 'C:\\Windows\\a.mp4'));
  assert.throws(() => resolveMedia('C:\\d', '../d.media/a.mp4'), /Not a drawing/);
});

test('listDir hides a board\'s media folder but not other folders ending in .media', async () => {
  const dir = await tmp();
  await fs.writeFile(path.join(dir, 'Plan.excalidraw'), '{}');
  await fs.mkdir(path.join(dir, 'Plan.media'));
  await fs.mkdir(path.join(dir, 'Social.media'));
  assert.deepEqual((await listDir(dir)).map(e => e.name), ['Social.media', 'Plan']);
});
