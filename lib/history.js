// Local version history and a trash for drawings. Both live in Doodlebay's own data
// folder, never next to the drawings. Kept free of Electron so they can be unit tested.
//
// History/<key>/<time>.excalidraw   earlier saves of one drawing, key from its path
// Trash/<id>/<name>.excalidraw       a deleted drawing, with meta.json saying where it was
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXT, freePath } from './files.js';

export const EVERY = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 30;

const keyOf = file => crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);
const stamp = name => Number(name.slice(0, -EXT.length));

// Which snapshot times to keep: everything from the last day, then the newest of each day
// for 30 days, nothing older.
export function toKeep(times, now) {
  const keep = new Set();
  const days = new Set();
  for (const t of [...times].sort((a, b) => b - a)) {
    const age = now - t;
    if (age < DAY) keep.add(t);
    else if (age < KEEP_DAYS * DAY) {
      const day = Math.floor(t / DAY);
      if (!days.has(day)) { days.add(day); keep.add(t); }
    }
  }
  return keep;
}

export class History {
  constructor(dir) { this.dir = dir; }

  folder(file) { return path.join(this.dir, keyOf(file)); }

  // Times of the saved versions of file, newest first.
  async list(file) {
    let names = [];
    try { names = await fs.readdir(this.folder(file)); } catch { return []; }
    return names.filter(n => n.endsWith(EXT)).map(stamp).filter(Number.isFinite).sort((a, b) => b - a);
  }

  read(file, time) {
    return fs.readFile(path.join(this.folder(file), `${Number(time)}${EXT}`), 'utf8');
  }

  // Keeps what is on disk now as a version, unless the newest version is the same or, when
  // not forced, is less than five minutes old. Returns the new version's time, or null.
  async snapshot(file, { force = false, now = Date.now() } = {}) {
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { return null; }
    const times = await this.list(file);
    if (times.length) {
      if (!force && now - times[0] < EVERY) return null;
      if (await this.read(file, times[0]).catch(() => null) === text) return null;
    }
    const dir = this.folder(file);
    await fs.mkdir(dir, { recursive: true });
    const time = times.length && now <= times[0] ? times[0] + 1 : now;
    await fs.writeFile(path.join(dir, `${time}${EXT}`), text, 'utf8');
    await fs.writeFile(path.join(dir, 'file.txt'), path.resolve(file), 'utf8');
    await this.prune(file, now);
    return time;
  }

  async prune(file, now = Date.now()) {
    const times = await this.list(file);
    const keep = toKeep(times, now);
    for (const t of times) if (!keep.has(t)) await fs.rm(path.join(this.folder(file), `${t}${EXT}`), { force: true });
    if (!keep.size) await fs.rm(this.folder(file), { recursive: true, force: true });
  }

  // Prunes every drawing's history, for drawings that are not opened again.
  async pruneAll(now = Date.now()) {
    let keys = [];
    try { keys = await fs.readdir(this.dir); } catch { return; }
    for (const key of keys) {
      const file = await fs.readFile(path.join(this.dir, key, 'file.txt'), 'utf8').catch(() => null);
      if (file) await this.prune(file, now);
    }
  }
}

// Moves a file, also across drives.
async function move(from, to) {
  try { await fs.rename(from, to); } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.copyFile(from, to);
    await fs.rm(from);
  }
}

export class Trash {
  constructor(dir) { this.dir = dir; }

  async put(file, now = Date.now()) {
    const id = `${now}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join(this.dir, id);
    await fs.mkdir(dir, { recursive: true });
    const name = path.basename(file);
    await move(file, path.join(dir, name));
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ from: path.resolve(file), name, deletedAt: now }), 'utf8');
    return id;
  }

  // Newest first: [{ id, name, from, deletedAt }].
  async list() {
    let ids = [];
    try { ids = await fs.readdir(this.dir); } catch { return []; }
    const items = [];
    for (const id of ids) {
      try { items.push({ id, ...JSON.parse(await fs.readFile(path.join(this.dir, id, 'meta.json'), 'utf8')) }); } catch { /* not ours */ }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async get(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new Error('Not in the trash.');
    const meta = JSON.parse(await fs.readFile(path.join(this.dir, id, 'meta.json'), 'utf8'));
    return { id, ...meta };
  }

  // Back where it was; under a new name if that name has been taken since.
  async restore(id) {
    const item = await this.get(id);
    const dir = path.dirname(item.from);
    await fs.mkdir(dir, { recursive: true });
    let target = item.from;
    try { await fs.access(target); target = await freePath(dir, item.name); } catch { /* free */ }
    await move(path.join(this.dir, id, item.name), target);
    await fs.rm(path.join(this.dir, id), { recursive: true, force: true });
    return target;
  }

  async remove(id) {
    await this.get(id);
    await fs.rm(path.join(this.dir, id), { recursive: true, force: true });
  }

  // Empties anything deleted more than 30 days ago.
  async sweep(now = Date.now()) {
    for (const item of await this.list()) if (now - item.deletedAt >= KEEP_DAYS * DAY) await this.remove(item.id);
  }
}
