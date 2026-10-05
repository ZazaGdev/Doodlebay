// File helpers for the main process. Kept free of Electron so they can be unit tested.
import fs from 'node:fs/promises';
import path from 'node:path';

export const EXT = '.excalidraw';

// Folders that are never worth showing in the sidebar.
const SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

const norm = p => path.resolve(p).toLowerCase();

// True when target is root itself or somewhere inside it.
export function isInside(root, target) {
  const rel = path.relative(norm(root), norm(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function insideAny(roots, target) {
  return roots.some(r => isInside(r, target));
}

// The direct children of dir: subfolders first, then .excalidraw files, both by name.
export async function listDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).sort(byName);
  const files = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith(EXT)).sort(byName);
  return [
    ...dirs.map(e => ({ type: 'dir', name: e.name, path: path.join(dir, e.name) })),
    ...files.map(e => ({ type: 'file', name: e.name.slice(0, -EXT.length), path: path.join(dir, e.name) })),
  ];
}

// A file name that is safe on Windows: no reserved characters, no trailing dots or spaces.
export function cleanName(name) {
  const base = String(name || '').replace(/\.excalidraw$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? `${base}-drawing` : base;
}

// A path for a new drawing in dir that does not overwrite anything: "Name.excalidraw",
// then "Name 2.excalidraw" and so on.
export async function freePath(dir, name) {
  const base = cleanName(name) || 'Untitled';
  for (let n = 1; ; n++) {
    const p = path.join(dir, `${n === 1 ? base : `${base} ${n}`}${EXT}`);
    try { await fs.access(p); } catch { return p; }
  }
}

// The first free "Untitled N.excalidraw" in dir, counting from 1.
export async function untitledPath(dir) {
  for (let n = 1; ; n++) {
    const p = path.join(dir, `Untitled ${n}${EXT}`);
    try { await fs.access(p); } catch { return p; }
  }
}

// An empty drawing in the format Excalidraw itself writes.
export function emptyScene() {
  return JSON.stringify({
    type: 'excalidraw', version: 2, source: 'ExcaliDesk',
    elements: [], appState: { gridSize: 20, viewBackgroundColor: '#ffffff' }, files: {},
  }, null, 2);
}

// Writes through a temp file and a rename, so a crash mid-save never leaves half a drawing.
export async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

// A small JSON settings file. Missing or broken files read as the defaults.
export async function readJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(await fs.readFile(file, 'utf8')) }; } catch { return { ...fallback }; }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify(data, null, 2));
}
