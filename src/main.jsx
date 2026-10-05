// The app shell: the folder sidebar on the left, the open drawing on the right.
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@excalidraw/excalidraw/index.css';
import './app.css';
import Sidebar from './Sidebar.jsx';
import Editor from './Editor.jsx';

const fileName = p => (p.split(/[\\/]/).pop() || p).replace(/\.excalidraw$/i, '');

function App({ initial }) {
  const [folders, setFolders] = useState(initial.folders);
  const [theme, setTheme] = useState(initial.theme);
  const [sidebar, setSidebar] = useState(initial.sidebar);
  const [onTop, setOnTop] = useState(initial.alwaysOnTop);
  const [openFile, setOpenFile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = openFile ? `${fileName(openFile)} - ExcaliDesk` : 'ExcaliDesk';
  }, [theme, openFile]);

  const onError = useCallback(msg => setError(msg), []);
  const pickTheme = useCallback(t => { setTheme(t); window.desk.setSettings({ theme: t }); }, []);
  const toggleOnTop = () => { setOnTop(!onTop); window.desk.setSettings({ alwaysOnTop: !onTop }); };
  const toggleSidebar = () => { setSidebar(!sidebar); window.desk.setSettings({ sidebar: !sidebar }); };

  const attach = async () => setFolders(await window.desk.attachFolders());
  const detach = async root => {
    if (openFile && openFile.toLowerCase().startsWith(root.toLowerCase())) setOpenFile(null);
    setFolders(await window.desk.detachFolder(root));
  };

  return (
    <div className={`app ${sidebar ? '' : 'no-side'}`}>
      {sidebar && (
        <Sidebar
          folders={folders} openFile={openFile} onOpen={setOpenFile}
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
        {openFile
          ? <Editor key={openFile} file={openFile} name={fileName(openFile)} theme={theme} onTheme={pickTheme} onError={onError} />
          : (
            <div className="empty-stage">
              <h1>ExcaliDesk</h1>
              <p>{folders.length ? 'Pick a drawing on the left, or press + next to a folder to make a new one.' : 'Attach a folder to start.'}</p>
              <p className="muted">A free desktop app built on the open-source Excalidraw editor. Your drawings stay as .excalidraw files in your own folders.</p>
            </div>
          )}
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

window.desk.getSettings().then(initial => {
  createRoot(document.getElementById('root')).render(<App initial={initial} />);
});
