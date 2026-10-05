// The folder explorer: attached folders, their subfolders and their .excalidraw drawings.
// Folders load as they are expanded and reload when something on disk changes.
import React, { useCallback, useEffect, useRef, useState } from 'react';

const baseName = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
const isUnder = (root, p) => p === root || p.toLowerCase().startsWith(`${root.toLowerCase()}\\`) || p.toLowerCase().startsWith(`${root.toLowerCase()}/`);

function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem('expanded') || '[]')); } catch { return new Set(); }
}

// Enter or clicking away creates the drawing; Esc cancels. Whichever comes first wins.
function NewDrawing({ onCreate, onCancel }) {
  const [name, setName] = useState('Untitled');
  const done = useRef(false);
  const finish = fn => { if (done.current) return; done.current = true; fn(); };
  return (
    <input
      className="tree-input" autoFocus value={name} aria-label="New drawing name"
      onFocus={e => e.target.select()}
      onChange={e => setName(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') finish(() => onCreate(name));
        if (e.key === 'Escape') finish(onCancel);
      }}
      onBlur={() => finish(() => onCreate(name))}
    />
  );
}

// Search across every drawing in the attached folders and Drafts. While there is a query
// the results take the tree's place; Esc clears it.
function SearchResults({ results, query, openFile, onOpen }) {
  if (!results) return <div className="tree-note">Searching...</div>;
  if (!results.length) return <div className="tree-note">Nothing found for "{query}"</div>;
  return results.map(r => (
    <div key={r.file} className="search-hit">
      <div className={`tree-row file${r.file === openFile ? ' active' : ''}`} onClick={() => onOpen(r.file)} title={r.file}>
        <span className="tree-name">{r.name}</span>
        <span className="search-where">{baseName(r.file.replace(/[\\/][^\\/]*$/, ''))}</span>
      </div>
      {r.matches.slice(0, 5).map(m => (
        <div key={m.id} className="search-match" onClick={() => onOpen(r.file, m.id)} title={m.kind === 'frame' ? 'Frame name' : 'Text'}>
          {m.kind === 'frame' && <span className="search-kind">Frame</span>}
          {m.text}
        </div>
      ))}
      {r.matches.length > 5 && <div className="search-more">{r.matches.length - 5} more in this drawing</div>}
    </div>
  ));
}

export default function Sidebar({ folders, drafts, opened = [], openFile, onOpen, onAttach, onDetach, onError, header, searchAt }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const searchBox = useRef(null);
  useEffect(() => { if (searchAt) { searchBox.current?.focus(); searchBox.current?.select(); } }, [searchAt]);
  // Searches a moment after typing stops, and again when a drawing changes on disk.
  const [changed, setChanged] = useState(0);
  useEffect(() => window.desk.onFoldersChanged(() => setChanged(n => n + 1)), []);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      window.desk.search(q).then(r => { if (live) setResults(r); }, () => { if (live) setResults([]); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [query, changed]);

  const [children, setChildren] = useState({});
  const [expanded, setExpanded] = useState(() => {
    const s = loadExpanded();
    folders.forEach(f => s.add(f));
    return s;
  });
  const [creatingIn, setCreatingIn] = useState(null);

  const load = useCallback(async dir => {
    const items = await window.desk.listDir(dir);
    setChildren(c => ({ ...c, [dir]: items }));
  }, []);

  // New roots start expanded; expanded folders are remembered for next time.
  useEffect(() => {
    setExpanded(s => {
      const next = new Set(s);
      folders.forEach(f => { if (!children[f]) next.add(f); });
      return next;
    });
  }, [folders]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem('expanded', JSON.stringify([...expanded])); } catch { /* not kept */ }
    expanded.forEach(dir => { if (!children[dir] && folders.some(f => isUnder(f, dir))) load(dir); });
  }, [expanded, folders]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => window.desk.onFoldersChanged(root => {
    expanded.forEach(dir => { if (isUnder(root, dir)) load(dir); });
    if (root === drafts) load(drafts);
  }), [expanded, load, drafts]);

  // Drawings started on the blank canvas with no folder attached. Shown only when there are some.
  useEffect(() => { load(drafts); }, [drafts, load]);
  const draftItems = Array.isArray(children[drafts]) ? children[drafts].filter(i => i.type === 'file') : [];

  const toggle = dir => setExpanded(s => {
    const next = new Set(s);
    next.has(dir) ? next.delete(dir) : next.add(dir);
    return next;
  });

  const startNew = dir => {
    setExpanded(s => new Set(s).add(dir));
    setCreatingIn(dir);
  };

  const create = async (dir, name) => {
    setCreatingIn(null);
    try {
      const file = await window.desk.createFile(dir, name);
      await load(dir);
      onOpen(file);
    } catch (err) { onError(`Could not create the drawing: ${err.message}`); }
  };

  const renderDir = (dir, depth) => {
    const items = children[dir];
    const pad = { paddingLeft: 10 + depth * 14 };
    return (
      <>
        {creatingIn === dir && (
          <div className="tree-row" style={pad}>
            <NewDrawing onCreate={name => create(dir, name)} onCancel={() => setCreatingIn(null)} />
          </div>
        )}
        {items?.error && <div className="tree-note" style={pad}>{items.error}</div>}
        {Array.isArray(items) && !items.length && creatingIn !== dir && <div className="tree-note" style={pad}>No drawings here</div>}
        {Array.isArray(items) && items.map(item => item.type === 'dir'
          ? (
            <div key={item.path}>
              <div className="tree-row dir" style={pad} onClick={() => toggle(item.path)} title={item.path}>
                <span className="caret">{expanded.has(item.path) ? '▾' : '▸'}</span>
                <span className="tree-name">{item.name}</span>
                <button className="row-btn" title="New drawing in this folder" onClick={e => { e.stopPropagation(); startNew(item.path); }}>+</button>
              </div>
              {expanded.has(item.path) && renderDir(item.path, depth + 1)}
            </div>
          )
          : (
            <div
              key={item.path} className={`tree-row file${item.path === openFile ? ' active' : ''}`} style={pad}
              onClick={() => onOpen(item.path)} title={item.path}
            >
              <span className="caret" />
              <span className="tree-name">{item.name}</span>
            </div>
          ))}
      </>
    );
  };

  return (
    <aside className="sidebar">
      <div className="side-head">
        <span className="brand">Doodlebay</span>
        <span className="spacer" />
        {header}
        <button className="head-btn" onClick={onAttach} title="Attach folders">+ Folder</button>
      </div>
      <div className="side-search">
        <input
          ref={searchBox} type="search" value={query} placeholder="Search all drawings (Ctrl+Shift+F)" aria-label="Search all drawings"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.target.blur(); } }}
        />
      </div>
      {query.trim() ? (
        <div className="tree search-results">
          <SearchResults results={results} query={query.trim()} openFile={openFile} onOpen={onOpen} />
        </div>
      ) : (
      <div className="tree">
        {opened.length > 0 && (
          <div className="root">
            <div className="tree-row root-row" title="Opened from Explorer; their folders are not attached">
              <span className="caret" />
              <span className="tree-name">{opened.length === 1 ? 'Opened file' : 'Opened files'}</span>
            </div>
            {opened.map(file => (
              <div
                key={file} className={`tree-row file${file === openFile ? ' active' : ''}`} style={{ paddingLeft: 24 }}
                onClick={() => onOpen(file)} title={file}
              >
                <span className="caret" />
                <span className="tree-name">{baseName(file).replace(/\.excalidraw$/i, '')}</span>
              </div>
            ))}
          </div>
        )}
        {!folders.length && (
          <div className="empty-side">
            <p>Attach a folder to see its drawings here.</p>
            <p className="muted">Attaching a folder does not move or change anything in it.</p>
            <button className="primary" onClick={onAttach}>Attach a folder</button>
          </div>
        )}
        {folders.map(root => (
          <div key={root} className="root">
            <div className="tree-row root-row" onClick={() => toggle(root)} title={root}>
              <span className="caret">{expanded.has(root) ? '▾' : '▸'}</span>
              <span className="tree-name">{baseName(root)}</span>
              <button className="row-btn" title="New drawing in this folder" onClick={e => { e.stopPropagation(); startNew(root); }}>+</button>
              <button className="row-btn" title="Detach this folder (its files stay where they are)" onClick={e => { e.stopPropagation(); onDetach(root); }}>×</button>
            </div>
            {expanded.has(root) && renderDir(root, 1)}
          </div>
        ))}
        {draftItems.length > 0 && (
          <div className="root">
            <div className="tree-row root-row" title={`Not in an attached folder: ${drafts}`}>
              <span className="caret" />
              <span className="tree-name">Drafts</span>
            </div>
            {draftItems.map(item => (
              <div
                key={item.path} className={`tree-row file${item.path === openFile ? ' active' : ''}`} style={{ paddingLeft: 24 }}
                onClick={() => onOpen(item.path)} title={item.path}
              >
                <span className="caret" />
                <span className="tree-name">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </aside>
  );
}
