// One foldable section per installed library in Excalidraw's library panel. Excalidraw keeps
// every installed item in a single "Excalidraw Library" grid, so this hides that grid and
// shows the same items grouped by the library they came from. The items themselves stay
// in Excalidraw's library; Doodlebay only remembers which library each one came from.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { exportToSvg, serializeLibraryAsJSON, MIME_TYPES } from '@excalidraw/excalidraw';

const IMPORTED = 'Imported';
const FOLD_KEY = 'librarySectionsOpen';

let items = [];
let sources = {};
let known = new Set();
let pendingName = null;
const listeners = new Set();
let snapshot = { items, sources };
const emit = () => { snapshot = { items, sources }; listeners.forEach(fn => fn()); };
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// ".../libraries/youritjang/software-architecture.excalidrawlib" -> "Software Architecture"
export function libraryNameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).pop() || '';
    const words = last.replace(/\.excalidrawlib$/i, '').split(/[-_\s]+/).filter(Boolean);
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || IMPORTED;
  } catch { return IMPORTED; }
}

// The site's own name for the library, from its index; the file name if that fails.
async function siteName(url) {
  const fallback = libraryNameFromUrl(url);
  try {
    const { origin, pathname } = new URL(url);
    const source = decodeURIComponent(pathname).replace(/^\/libraries\//, '');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const list = await fetch(`${origin}/libraries.json`, { signal: ctl.signal }).then(r => r.json());
    clearTimeout(timer);
    return list.find(l => l.source === source)?.name || fallback;
  } catch { return fallback; }
}

// Called with the #addLibrary=... hash before Excalidraw installs it.
export async function noteInstall(hash) {
  const url = new URLSearchParams(hash.replace(/^#/, '')).get('addLibrary');
  if (url) pendingName = await siteName(url);
}

// The storage adapter Excalidraw's useHandleLibrary reads and writes through.
export const libraryAdapter = {
  load: async () => {
    const text = await window.desk.loadLibrary();
    if (!text) return null;
    try {
      const data = JSON.parse(text);
      const list = data.libraryItems || data.library || [];
      // Libraries saved before the rename to Doodlebay keep their sections under the old key.
      sources = data.doodlebay?.sources || data.excalidesk?.sources || {};
      items = list;
      known = new Set(list.map(i => i.id));
      emit();
      return { libraryItems: list };
    } catch { return null; }
  },
  save: async ({ libraryItems }) => {
    const fresh = libraryItems.filter(i => !known.has(i.id));
    if (pendingName && fresh.some(i => i.status === 'published')) {
      sources = { ...sources };
      for (const i of fresh) if (i.status === 'published') sources[i.id] = pendingName;
      pendingName = null;
    }
    known = new Set(libraryItems.map(i => i.id));
    // Forget items that were removed from the library.
    sources = Object.fromEntries(Object.entries(sources).filter(([id]) => known.has(id)));
    items = libraryItems;
    emit();
    const data = JSON.parse(serializeLibraryAsJSON(libraryItems));
    data.doodlebay = { sources };
    return window.desk.saveLibrary(JSON.stringify(data, null, 2));
  },
};

function readFolds() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; }
}

// The SVG element Excalidraw renders is appended as a node, never parsed from a string.
function Preview({ item, theme }) {
  const box = useRef(null);
  useEffect(() => {
    let live = true;
    exportToSvg({ elements: item.elements, appState: { exportBackground: false, exportWithDarkMode: theme === 'dark' }, files: null })
      .then(svg => { if (live && box.current) box.current.replaceChildren(svg); })
      .catch(() => {});
    return () => { live = false; };
  }, [item, theme]);
  return <div className="ed-lib-preview" ref={box} />;
}

// Dropping the item on the canvas, the way Excalidraw's own library does it.
const payload = item => serializeLibraryAsJSON([item]);
function insertAtCenter(item) {
  const target = document.querySelector('canvas.interactive');
  if (!target) return;
  const r = target.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.setData(MIME_TYPES.excalidrawlib, payload(item));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
}

function Sections({ theme }) {
  const { items: all, sources: src } = useSyncExternalStore(subscribe, () => snapshot);
  const [open, setOpen] = useState(readFolds);
  const groups = new Map();
  for (const item of all) {
    if (item.status !== 'published') continue;
    const name = src[item.id] || IMPORTED;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  if (!groups.size) return null;
  const toggle = name => setOpen(o => {
    const next = { ...o, [name]: !o[name] };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  return (
    <div className="ed-libs">
      {[...groups].map(([name, list]) => (
        <div key={name} className="ed-lib-section">
          <button className="ed-lib-head" onClick={() => toggle(name)} aria-expanded={!!open[name]}>
            <span className="ed-lib-caret">{open[name] ? '▾' : '▸'}</span>
            <span className="ed-lib-name">{name}</span>
            <span className="ed-lib-count">{list.length}</span>
          </button>
          {open[name] && (
            <div className="ed-lib-grid">
              {list.map(item => (
                <div
                  key={item.id} className="ed-lib-item" draggable title={item.name || 'Drag onto the canvas, or click to add'}
                  onDragStart={e => e.dataTransfer.setData(MIME_TYPES.excalidrawlib, payload(item))}
                  onClick={() => insertAtCenter(item)}
                >
                  <Preview item={item} theme={theme} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// The empty library's call to action. It clicks Excalidraw's own Browse libraries link,
// which app.css hides while the library is empty, so the site opens exactly as before.
function BrowseCta() {
  const browse = () => document.querySelector('.layer-ui__library .library-menu-browse-button')?.click();
  return <button className="ed-lib-browse" onClick={browse}>Browse libraries</button>;
}

// Puts a host div in front of `anchor` (or as the first child of `parent`) whenever the
// panel is open, and drops it when the panel closes.
function useHost(className, find) {
  const [host, setHost] = useState(null);
  useEffect(() => {
    const place = () => {
      const spot = find();
      if (!spot) { setHost(null); return; }
      const [parent, before] = spot;
      let el = before ? before.previousElementSibling : parent.firstElementChild;
      if (!el || !el.classList.contains(className)) {
        el = document.createElement('div');
        el.className = className;
        parent.insertBefore(el, before || parent.firstChild);
      }
      setHost(h => (h === el ? h : el));
    };
    place();
    const obs = new MutationObserver(place);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [className, find]);
  return host;
}

// Finds Excalidraw's "Excalidraw Library" heading whenever the panel is open and puts the
// sections in front of it; the heading and its grid are hidden by app.css.
const findSections = () => {
  const head = document.querySelector('.library-menu-items-container__header--excal');
  return head && [head.parentNode, head];
};
const findNothing = () => null;
const findTop = () => {
  const box = document.querySelector('.layer-ui__library .library-menu-items-container');
  return box && [box, null];
};

export default function LibrarySections({ theme }) {
  const { items: all } = useSyncExternalStore(subscribe, () => snapshot);
  const empty = all.length === 0;
  useEffect(() => {
    document.body.classList.toggle('ed-lib-empty', empty);
  }, [empty]);
  const host = useHost('ed-libs-host', findSections);
  const top = useHost('ed-lib-cta-host', empty ? findTop : findNothing);
  return (
    <>
      {host && createPortal(<Sections theme={theme} />, host)}
      {top && createPortal(<BrowseCta />, top)}
    </>
  );
}
