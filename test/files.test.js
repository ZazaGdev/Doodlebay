import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isInside, insideAny, listDir, cleanName, freePath, untitledPath, emptyScene, readJson, writeJson, writeAtomic } from '../lib/files.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-'));

test('isInside accepts the root and its children only', () => {
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\b'), true);
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\b\\c\\d.excalidraw'), true);
  assert.equal(isInside('C:\\a\\b', 'c:\\A\\B\\x'), true);
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\bc'), false);
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\b\\..\\c'), false);
  assert.equal(isInside('C:\\a\\b', 'D:\\a\\b'), false);
  assert.equal(insideAny(['C:\\x', 'C:\\a'], 'C:\\a\\f'), true);
  assert.equal(insideAny([], 'C:\\a\\f'), false);
});

test('listDir shows subfolders then drawings, and skips everything else', async () => {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, 'Sub'));
  await fs.mkdir(path.join(dir, '.hidden'));
  await fs.mkdir(path.join(dir, 'node_modules'));
  await fs.writeFile(path.join(dir, 'b.excalidraw'), '{}');
  await fs.writeFile(path.join(dir, 'A.excalidraw'), '{}');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
  const items = await listDir(dir);
  assert.deepEqual(items.map(i => [i.type, i.name]), [['dir', 'Sub'], ['file', 'A'], ['file', 'b']]);
  assert.equal(items[1].path, path.join(dir, 'A.excalidraw'));
});

test('cleanName makes a Windows-safe file name', () => {
  assert.equal(cleanName('My: plan?'), 'My- plan-');
  assert.equal(cleanName('ideas.excalidraw'), 'ideas');
  assert.equal(cleanName('trailing. '), 'trailing');
  assert.equal(cleanName('CON'), 'CON-drawing');
  assert.equal(cleanName(''), '');
});

test('freePath never reuses an existing name', async () => {
  const dir = await tmp();
  assert.equal(await freePath(dir, 'Plan'), path.join(dir, 'Plan.excalidraw'));
  await fs.writeFile(path.join(dir, 'Plan.excalidraw'), '{}');
  assert.equal(await freePath(dir, 'Plan'), path.join(dir, 'Plan 2.excalidraw'));
  assert.equal(await freePath(dir, '  '), path.join(dir, 'Untitled.excalidraw'));
});

test('untitledPath counts Untitled 1, 2, 3 and fills gaps', async () => {
  const dir = await tmp();
  assert.equal(await untitledPath(dir), path.join(dir, 'Untitled 1.excalidraw'));
  await fs.writeFile(path.join(dir, 'Untitled 1.excalidraw'), '{}');
  await fs.writeFile(path.join(dir, 'Untitled 3.excalidraw'), '{}');
  assert.equal(await untitledPath(dir), path.join(dir, 'Untitled 2.excalidraw'));
});

test('emptyScene is a valid empty Excalidraw file', () => {
  const s = JSON.parse(emptyScene());
  assert.equal(s.type, 'excalidraw');
  assert.deepEqual(s.elements, []);
});

test('writeAtomic replaces the file and leaves no temp file', async () => {
  const dir = await tmp();
  const f = path.join(dir, 'd.excalidraw');
  await fs.writeFile(f, 'old');
  await writeAtomic(f, 'new');
  assert.equal(await fs.readFile(f, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(dir), ['d.excalidraw']);
});

test('readJson falls back to defaults, writeJson round-trips', async () => {
  const dir = await tmp();
  const f = path.join(dir, 'nested', 'settings.json');
  assert.deepEqual(await readJson(f, { folders: [] }), { folders: [] });
  await writeJson(f, { folders: ['C:\\x'] });
  assert.deepEqual(await readJson(f, { folders: [], theme: 'light' }), { folders: ['C:\\x'], theme: 'light' });
  await fs.writeFile(f, 'not json');
  assert.deepEqual(await readJson(f, { folders: [] }), { folders: [] });
});
