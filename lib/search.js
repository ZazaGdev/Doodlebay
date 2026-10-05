// Search across every drawing in the attached folders and Drafts. The index is kept in
// memory in the main process, never written anywhere, and is refreshed from disk when a
// watched folder changes. Kept free of Electron so it can be unit tested.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXT } from './files.js';

const SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_RESULTS = 200;

// The searchable words of one drawing: its text elements and frame names.
export function drawingText(json) {
  let data;
  try { data = JSON.parse(json); } catch { return []; }
  const out = [];
  for (const el of Array.isArray(data?.elements) ? data.elements : []) {
    if (!el || el.isDeleted) continue;
    if (el.type === 'text') {
      const text = String(el.originalText ?? el.text ?? '').trim();
      if (text) out.push({ id: el.id, kind: 'text', text });
    } else if ((el.type === 'frame' || el.type === 'magicframe') && el.name) {
      out.push({ id: el.id, kind: 'frame', text: String(el.name) });
    }
  }
  return out;
}

// Every .excalidraw file under dir, skipping hidden and system folders like the sidebar.
export async function walk(dir, found = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP.has(e.name)) await walk(p, found); }
    else if (e.isFile() && e.name.toLowerCase().endsWith(EXT)) found.push(p);
  }
  return found;
}

const fileName = p => path.basename(p).slice(0, -EXT.length);

// A short piece of text around the first hit, on one line.
function snippet(text, at, len) {
  const flat = text.replace(/\s+/g, ' ');
  const start = Math.max(0, at - 30);
  const end = Math.min(flat.length, at + len + 50);
  return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`;
}

export class SearchIndex {
  constructor() { this.files = new Map(); }

  // Brings the index for these roots up to date: new and changed files are read again,
  // files that are gone or no longer under a root are dropped.
  async refresh(roots) {
    const seen = new Set();
    for (const root of roots) {
      for (const file of await walk(root)) {
        seen.add(file);
        let stat;
        try { stat = await fs.stat(file); } catch { continue; }
        const had = this.files.get(file);
        if (had && had.mtime === stat.mtimeMs && had.size === stat.size) continue;
        try {
          const items = drawingText(await fs.readFile(file, 'utf8'));
          this.files.set(file, { mtime: stat.mtimeMs, size: stat.size, items });
        } catch { this.files.delete(file); }
      }
    }
    for (const file of this.files.keys()) if (!seen.has(file)) this.files.delete(file);
  }

  // Drawings whose name or contents contain the query, ignoring case. Name hits first.
  query(q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    const results = [];
    for (const [file, { items }] of this.files) {
      const name = fileName(file);
      const nameHit = name.toLowerCase().includes(needle);
      const matches = [];
      for (const item of items) {
        const at = item.text.replace(/\s+/g, ' ').toLowerCase().indexOf(needle);
        if (at >= 0) matches.push({ id: item.id, kind: item.kind, text: snippet(item.text, at, needle.length) });
      }
      if (nameHit || matches.length) results.push({ file, name, nameHit, matches });
    }
    results.sort((a, b) => (b.nameHit - a.nameHit) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return results.slice(0, MAX_RESULTS);
  }
}
