import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { History, Trash, toKeep, EVERY } from '../lib/history.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-history-'));
const H = 3600 * 1000;
const D = 24 * H;

test('toKeep keeps the last day, then one per day for 30 days', () => {
  const now = 100 * D + 12 * H;
  const times = [now - H, now - 2 * H, now - 2 * D, now - 2 * D - H, now - 5 * D, now - 31 * D];
  assert.deepEqual([...toKeep(times, now)].sort(), [now - H, now - 2 * H, now - 2 * D, now - 5 * D].sort());
});

test('snapshots keep the old state at most every five minutes, skip repeats, and are read back', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'Plan.excalidraw');
  const history = new History(path.join(dir, 'History'));
  await fs.writeFile(file, 'v1');
  const t0 = Date.now();
  assert.equal(await history.snapshot(file, { now: t0 }), t0);
  await fs.writeFile(file, 'v2');
  assert.equal(await history.snapshot(file, { now: t0 + 1000 }), null, 'too soon');
  assert.equal(await history.snapshot(file, { now: t0 + EVERY }), t0 + EVERY);
  assert.equal(await history.snapshot(file, { now: t0 + 2 * EVERY }), null, 'same as the newest');
  await fs.writeFile(file, 'v3');
  assert.ok(await history.snapshot(file, { force: true, now: t0 + EVERY + 10 }));
  const times = await history.list(file);
  assert.equal(times.length, 3);
  assert.deepEqual(await Promise.all(times.map(t => history.read(file, t))), ['v3', 'v2', 'v1']);
  // Nothing is written next to the drawing.
  assert.deepEqual((await fs.readdir(dir)).sort(), ['History', 'Plan.excalidraw']);
});

test('the trash moves a drawing out, lists it, restores it where it was, and empties after 30 days', async () => {
  const dir = await tmp();
  const trash = new Trash(path.join(dir, 'Trash'));
  const file = path.join(dir, 'Sub', 'Plan.excalidraw');
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, 'drawing');
  const now = Date.now();
  const id = await trash.put(file, now);
  await assert.rejects(fs.access(file));
  const [item] = await trash.list();
  assert.equal(item.name, 'Plan.excalidraw');
  assert.equal(item.from, file);

  // The name was taken again meanwhile, so it comes back as "Plan 2".
  await fs.writeFile(file, 'new one');
  const back = await trash.restore(id);
  assert.equal(back, path.join(dir, 'Sub', 'Plan 2.excalidraw'));
  assert.equal(await fs.readFile(back, 'utf8'), 'drawing');
  assert.deepEqual(await trash.list(), []);

  await trash.put(back, now - 31 * D);
  const keep = await trash.put(file, now - 29 * D);
  await trash.sweep(now);
  assert.deepEqual((await trash.list()).map(i => i.id), [keep]);
  await assert.rejects(trash.get('../x'));
  await trash.remove(keep);
  assert.deepEqual(await trash.list(), []);
});
