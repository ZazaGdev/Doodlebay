import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drawingText, SearchIndex } from '../lib/search.js';

const scene = els => JSON.stringify({ type: 'excalidraw', elements: els });
const text = (id, t, extra = {}) => ({ id, type: 'text', text: t, originalText: t, ...extra });

test('drawingText keeps live text and frame names only', () => {
  const items = drawingText(scene([
    text('t1', 'Hello world'),
    text('t2', 'gone', { isDeleted: true }),
    { id: 'f1', type: 'frame', name: 'Login flow' },
    { id: 'f2', type: 'frame', name: null },
    { id: 'r1', type: 'rectangle' },
  ]));
  assert.deepEqual(items, [
    { id: 't1', kind: 'text', text: 'Hello world' },
    { id: 'f1', kind: 'frame', text: 'Login flow' },
  ]);
  assert.deepEqual(drawingText('not json'), []);
  assert.deepEqual(drawingText('{}'), []);
});

test('the index finds text, frame names and file names, and follows changes on disk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-search-'));
  await fs.mkdir(path.join(dir, 'Sub'));
  await fs.mkdir(path.join(dir, 'node_modules'));
  const a = path.join(dir, 'Sub', 'Plan.excalidraw');
  await fs.writeFile(a, scene([text('t1', 'Ship the\nZebra release'), { id: 'f1', type: 'frame', name: 'Zebra frame' }]));
  await fs.writeFile(path.join(dir, 'Zebra notes.excalidraw'), scene([]));
  await fs.writeFile(path.join(dir, 'node_modules', 'x.excalidraw'), scene([text('t9', 'zebra')]));

  const index = new SearchIndex();
  await index.refresh([dir]);
  const hits = index.query('zebra');
  assert.deepEqual(hits.map(h => h.name), ['Zebra notes', 'Plan']);
  assert.deepEqual(hits[1].matches.map(m => [m.id, m.kind]), [['t1', 'text'], ['f1', 'frame']]);
  assert.equal(hits[1].matches[0].text, 'Ship the Zebra release');
  assert.deepEqual(index.query('  '), []);

  // A change on disk is picked up; a deleted file drops out.
  await fs.writeFile(a, scene([text('t1', 'Quokka now')]));
  await fs.utimes(a, new Date(), new Date(Date.now() + 5000));
  await fs.rm(path.join(dir, 'Zebra notes.excalidraw'));
  await index.refresh([dir]);
  assert.deepEqual(index.query('zebra'), []);
  assert.deepEqual(index.query('QUOKKA').map(h => h.matches[0].id), ['t1']);

  // Detaching the folder empties the index.
  await index.refresh([]);
  assert.deepEqual(index.query('quokka'), []);
});
