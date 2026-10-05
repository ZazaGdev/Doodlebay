// The Excalidraw editor for one open drawing. It loads the file, saves it back a moment
// after each change (and on Ctrl+S, file switch and window close), and keeps the shared
// library in the app's own data folder. With no file it is a blank canvas: the first
// stroke turns it into "Untitled N" (see onCreated), and from then on it saves like any file.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Excalidraw, MainMenu, loadFromBlob, serializeAsJSON, serializeLibraryAsJSON,
  getSceneVersion, useHandleLibrary,
} from '@excalidraw/excalidraw';

const SAVE_DELAY = 800;

const UI = {
  canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: true, export: { saveFileToDisk: true } },
};

const libraryAdapter = {
  load: async () => {
    const text = await window.desk.loadLibrary();
    if (!text) return null;
    try {
      const data = JSON.parse(text);
      return { libraryItems: data.libraryItems || data.library || [] };
    } catch { return null; }
  },
  save: async ({ libraryItems }) => window.desk.saveLibrary(serializeLibraryAsJSON(libraryItems)),
};

// What has to change for the file on disk to be out of date.
const sceneKey = (elements, appState, files) =>
  `${getSceneVersion(elements)}|${appState.viewBackgroundColor}|${Object.keys(files || {}).length}`;

export default function Editor({ file, name, theme, onTheme, onError, onCreated }) {
  const [api, setApi] = useState(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const creating = useRef(false);
  const [status, setStatus] = useState('saved');
  const latest = useRef(null);
  const savedKey = useRef(null);
  const timer = useRef(null);

  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

  // Excalidraw measures new text with whatever font is loaded at that moment, and loads a
  // font only once some text uses it, so the first text typed came out too narrow and was
  // cut off. The fonts are local files, so load them all up front. Xiaolai (CJK, 13 MB)
  // still loads on demand.
  useEffect(() => {
    if (!api) return;
    for (const face of document.fonts) if (!/Xiaolai/i.test(face.family)) face.load().catch(() => {});
  }, [api]);

  const [initialData] = useState(() => !file ? null : window.desk.readFile(file)
    .then(text => loadFromBlob(new Blob([text], { type: 'application/json' }), null, null))
    .then(scene => ({ ...scene, scrollToContent: true }))
    .catch(err => { onError(`Could not open ${name}: ${err.message}`); return null; }));

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const s = latest.current;
    const target = fileRef.current;
    if (!target || !s || s.key === savedKey.current) return;
    setStatus('saving');
    try {
      await window.desk.writeFile(target, serializeAsJSON(s.elements, s.appState, s.files, 'local'));
      savedKey.current = s.key;
      setStatus(latest.current.key === s.key ? 'saved' : 'unsaved');
    } catch (err) {
      setStatus('error');
      onError(`Could not save ${name}: ${err.message}`);
    }
  }, [name, onError]);

  const onChange = (elements, appState, files) => {
    const key = sceneKey(elements, appState, files);
    // The first change is the drawing as loaded; nothing to save yet.
    if (savedKey.current === null) savedKey.current = key;
    latest.current = { elements, appState, files, key };
    if (appState.theme !== theme) onTheme(appState.theme);
    if (key === savedKey.current) return;
    if (!fileRef.current) {
      // Blank canvas: wait for something actually drawn, then make the file once.
      if (creating.current || !elements.some(e => !e.isDeleted)) return;
      creating.current = true;
      window.desk.createUntitled()
        .then(created => { fileRef.current = created; onCreated(created); return save(); })
        .catch(err => { creating.current = false; onError(`Could not create the drawing: ${err.message}`); });
      return;
    }
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
  };

  // Ctrl+S saves now; the window closing and switching to another drawing save too.
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        save();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const offFlush = window.desk.onFlush(() => save().finally(() => window.desk.flushed()));
    const offInstall = window.desk.onLibraryInstall(hash => { window.location.hash = hash; });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      offFlush();
      offInstall();
      save();
    };
  }, [save]);

  const label = { saved: 'Saved', saving: 'Saving...', unsaved: 'Unsaved', error: 'Not saved' }[status];

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initialData}
      theme={theme}
      name={name || 'Untitled'}
      UIOptions={UI}
      onChange={onChange}
      renderTopRightUI={() => file && (
        <button className={`save-pill ${status}`} onClick={save} title="Saved to the file automatically. Ctrl+S saves now.">{label}</button>
      )}
    >
      <MainMenu>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        {file && <MainMenu.Separator />}
        {file && <MainMenu.Item onSelect={() => window.desk.revealFile(file)}>Show in folder</MainMenu.Item>}
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
