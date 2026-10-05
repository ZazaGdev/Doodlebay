// The app shell: the folder sidebar on the left, the open drawing on the right.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@excalidraw/excalidraw/index.css';
import './app.css';
import Sidebar from './Sidebar.jsx';
import Editor from './Editor.jsx';

const fileName = p => (p.split(/[\\/]/).pop() || p).replace(/\.excalidraw$/i, '');
const under = (root, p) => p.toLowerCase().startsWith(`${root.toLowerCase().replace(/[\\/]+$/, '')}\\`);
const folderOf = p => p.replace(/[\\/][^\\/]*$/, '');

function App({ initial }) {
  const [folders, setFolders] = useState(initial.folders);
  const [theme, setTheme] = useState(initial.theme);
  const [sidebar, setSidebar] = useState(initial.sidebar);
  const [onTop, setOnTop] = useState(initial.alwaysOnTop);
  // key changes only when another drawing is opened, so the blank canvas turning into
  // "Untitled N" keeps the same editor (and its undo history).
  const [doc, setDoc] = useState({ key: 0, file: null, focus: null });
  const openFile = doc.file;
  const [error, setError] = useState(null);
  // Files opened from Explorer that are not in an attached folder, shown at the top of the sidebar.
  const [opened, setOpened] = useState([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = openFile ? `${fileName(openFile)} - Doodlebay` : 'Doodlebay';
  }, [theme, openFile]);

  const onError = useCallback(msg => setError(msg), []);
  const pickTheme = useCallback(t => { setTheme(t); window.desk.setSettings({ theme: t }); }, []);
  const toggleOnTop = () => { setOnTop(!onTop); window.desk.setSettings({ alwaysOnTop: !onTop }); };
  const toggleSidebar = () => { setSidebar(!sidebar); window.desk.setSettings({ sidebar: !sidebar }); };

  const remember = file => { if (!file.toLowerCase().startsWith(initial.drafts.toLowerCase())) window.desk.setSettings({ lastFolder: folderOf(file) }); };
  // focusId, from a search result, is the element to bring into view once the drawing is open.
  const open = (file, focusId = null) => {
    const focus = focusId ? { id: focusId, at: Date.now() } : null;
    setDoc(d => (d.file === file ? (focus ? { ...d, focus } : d) : { key: d.key + 1, file, focus }));
    remember(file);
  };
  // Ctrl+Shift+F shows the folders if hidden and puts the cursor in the search box.
  const [searchAt, setSearchAt] = useState(0);
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setSidebar(true);
        setSearchAt(Date.now());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const onCreated = useCallback(file => {
    setDoc(d => ({ ...d, file }));
    remember(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const show = file => {
      if (!file) return;
      if (![...foldersRef.current, initial.drafts].some(r => under(r, file))) {
        setOpened(list => (list.some(f => f.toLowerCase() === file.toLowerCase()) ? list : [file, ...list]));
      }
      openRef.current(file);
    };
    window.desk.pendingFile().then(show);
    return window.desk.onOpenFile(show);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const attach = async () => setFolders(await window.desk.attachFolders());
  const detach = async root => {
    if (openFile && openFile.toLowerCase().startsWith(root.toLowerCase())) setDoc(d => ({ key: d.key + 1, file: null }));
    setFolders(await window.desk.detachFolder(root));
  };

  return (
    <div className={`app ${sidebar ? '' : 'no-side'}`}>
      {sidebar && (
        <Sidebar
          folders={folders} drafts={initial.drafts} opened={opened} openFile={openFile} onOpen={open} searchAt={searchAt}
          onAttach={attach} onDetach={detach} onError={onError}
          header={(
            <button
              className={`head-btn pin${onTop ? ' on' : ''}`} onClick={toggleOnTop} aria-pressed={onTop}
              title={onTop ? 'Always on top is on: click to let other windows cover this one' : 'Keep this window on top of all other windows'}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z" /></svg>
            </button>
          )}
        />
      )}
      <main className="stage">
        <button className="side-toggle" onClick={toggleSidebar} title={sidebar ? 'Hide the folders' : 'Show the folders'}>
          {sidebar ? '‹' : '›'}
        </button>
        <Editor
          key={doc.key} file={openFile} name={openFile ? fileName(openFile) : ''} focus={doc.focus}
          theme={theme} onTheme={pickTheme} onError={onError} onCreated={onCreated}
        />
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} title="Dismiss">×</button>
          </div>
        )}
      </main>
    </div>
  );
}

Promise.all([window.desk.getSettings(), window.desk.draftsDir()]).then(([settings, drafts]) => {
  const initial = { ...settings, drafts };
  createRoot(document.getElementById('root')).render(<App initial={initial} />);
});
