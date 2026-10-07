// Doodlebay main process: the window, the app:// protocol that serves the built editor,
// and the file access the sidebar and editor ask for. The renderer can only read and write
// inside folders the user attached, and attaching a folder never changes anything in it.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXT, insideAny, listDir, cleanName, freePath, untitledPath, emptyScene, writeAtomic, readJson, writeJson } from './lib/files.js';
import { SearchIndex } from './lib/search.js';
import { History, Trash } from './lib/history.js';
import { VIDEO_TYPES, addMediaFile, resolveMedia } from './lib/media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, 'dist-renderer');
const ORIGIN = 'app://doodlebay';
const LIBRARY_SITE = 'libraries.excalidraw.com';

// Tests point this at a temp folder so they never touch the real settings.
if (process.env.DOODLEBAY_USER_DATA) app.setPath('userData', process.env.DOODLEBAY_USER_DATA);
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const LIBRARY = () => path.join(app.getPath('userData'), 'library.excalidrawlib');
// Drawings started on the blank canvas while no folder is attached land here.
const DRAFTS = () => path.join(app.getPath('userData'), 'Drafts');
// Earlier saves of each drawing, and deleted drawings, kept here and never in the user's folders.
const history = new History(path.join(app.getPath('userData'), 'History'));
const trash = new Trash(path.join(app.getPath('userData'), 'Trash'));
// Drawings moved to the trash this run. A save still on its way for one of them is dropped,
// so a deleted drawing does not come back.
const trashed = new Set();
const DEFAULTS = { folders: [], theme: 'light', sidebar: true, alwaysOnTop: false, lastFolder: null };

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let settings = { ...DEFAULTS };
const watchers = new Map();

// Search over every drawing in the attached folders and Drafts, kept in memory only. Any
// change on disk marks it stale, and the next search reads the changed files again.
const index = new SearchIndex();
let indexStale = true;
let indexing = null;
function freshIndex() {
  if (indexing) return indexing.then(freshIndex);
  if (!indexStale) return Promise.resolve();
  indexStale = false;
  const roots = [...settings.folders, DRAFTS()].filter(r => fs.existsSync(r));
  indexing = index.refresh(roots).finally(() => { indexing = null; });
  // A change that came in while reading is picked up by one more pass.
  return indexing.then(freshIndex);
}

// 'screen-saver' is the highest level Windows allows, so the window also stays above the
// taskbar and other always-on-top windows.
function applyOnTop() {
  win?.setAlwaysOnTop(!!settings.alwaysOnTop, 'screen-saver');
}

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  if ('alwaysOnTop' in patch) applyOnTop();
  await writeJson(SETTINGS(), settings);
  return settings;
}

// Drawings opened from Explorer that are not in an attached folder. Only these exact files
// are reachable, and only for this run; their folders are not attached.
const opened = new Set();

// Every path the renderer sends is checked against the attached folders.
function guard(p) {
  const full = path.resolve(String(p || ''));
  if (!opened.has(full.toLowerCase()) && !insideAny([...settings.folders, DRAFTS()], full)) throw new Error('That file is not in an attached folder.');
  return full;
}

// A .excalidraw path among command-line arguments (Explorer passes the double-clicked file).
function fileFromArgs(argv) {
  const hit = argv.slice(1).find(a => a.toLowerCase().endsWith(EXT) && fs.existsSync(a));
  if (!hit) return null;
  const full = path.resolve(hit);
  opened.add(full.toLowerCase());
  return full;
}

// The file waiting for the page to be ready, then handed over with 'file:open'.
let pendingFile = null;
let pageReady = false;
function openExternal(file) {
  if (!file) return;
  if (pageReady && win) win.webContents.send('file:open', file);
  else pendingFile = file;
}

// One copy only: a second launch (another double-click) hands its file to this window.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    openExternal(fileFromArgs(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!process.env.DOODLEBAY_HIDDEN) win.show();
      win.focus();
    }
  });
}

// One recursive watcher per attached folder; the sidebar reloads what it shows.
function watch(root) {
  if (watchers.has(root)) return;
  let timer = null;
  try {
    const w = fs.watch(root, { recursive: true }, () => {
      indexStale = true;
      clearTimeout(timer);
      timer = setTimeout(() => win?.webContents.send('folders:changed', root), 250);
    });
    w.on('error', () => {});
    watchers.set(root, w);
  } catch { /* a folder that has gone away is shown as missing by the sidebar */ }
}

function unwatch(root) {
  watchers.get(root)?.close();
  watchers.delete(root);
  indexStale = true;
}

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => {
  const { folders, ...rest } = patch || {};
  return saveSettings(rest);
});

ipcMain.handle('folders:attach', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Attach folders', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings.folders;
  const known = new Set(settings.folders.map(f => f.toLowerCase()));
  const added = r.filePaths.map(p => path.resolve(p)).filter(p => !known.has(p.toLowerCase()));
  added.forEach(watch);
  indexStale = true;
  return (await saveSettings({ folders: [...settings.folders, ...added] })).folders;
});

ipcMain.handle('folders:detach', async (_e, root) => {
  unwatch(root);
  return (await saveSettings({ folders: settings.folders.filter(f => f !== root) })).folders;
});

ipcMain.handle('dir:list', async (_e, dir) => {
  try { return await listDir(guard(dir)); } catch (err) { return { error: err.code === 'ENOENT' ? 'Folder not found' : err.message }; }
});

ipcMain.handle('file:read', (_e, file) => fsp.readFile(guard(file), 'utf8'));
// Saves of one file run one after another: two at once would share a temp file.
const writing = new Map();
ipcMain.handle('file:write', (_e, file, text) => {
  const full = guard(file);
  if (!full.toLowerCase().endsWith(EXT)) throw new Error('Only .excalidraw files are saved.');
  const key = full.toLowerCase();
  const run = (writing.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    if (trashed.has(key)) return;
    // Keeps what was there as a version first, at most every five minutes.
    await history.snapshot(full).catch(() => {});
    await writeAtomic(full, text);
  });
  writing.set(key, run);
  run.finally(() => { if (writing.get(key) === run) writing.delete(key); }).catch(() => {});
  return run;
});
// Called when a drawing is closed or switched away from: keep its last state as a version.
ipcMain.handle('history:checkpoint', (_e, file) => history.snapshot(guard(file), { force: true }).catch(() => null));
ipcMain.handle('history:list', (_e, file) => history.list(guard(file)));
ipcMain.handle('history:read', (_e, file, time) => history.read(guard(file), time));
// The drawing as it is now is kept as a version too, so a restore can itself be undone.
ipcMain.handle('history:restore', async (_e, file, time) => {
  const full = guard(file);
  const text = await history.read(full, time);
  await history.snapshot(full, { force: true });
  await writeAtomic(full, text);
});
ipcMain.handle('trash:put', async (_e, file) => {
  const full = guard(file);
  await history.snapshot(full, { force: true }).catch(() => {});
  trashed.add(full.toLowerCase());
  await trash.put(full);
});
ipcMain.handle('trash:list', () => trash.list());
ipcMain.handle('trash:restore', async (_e, id) => {
  const file = await trash.restore(id);
  trashed.delete(file.toLowerCase());
  return file;
});
ipcMain.handle('trash:remove', (_e, id) => trash.remove(id));
// Left as "Untitled" (or blank), a new drawing is numbered like the blank canvas: Untitled 1, 2...
ipcMain.handle('file:create', async (_e, dir, name) => {
  // "Add new" with no folder attached makes the drawing in Drafts, which may not exist yet.
  if (path.resolve(String(dir || '')).toLowerCase() === DRAFTS().toLowerCase()) {
    await fsp.mkdir(DRAFTS(), { recursive: true });
    watch(DRAFTS());
  }
  const base = cleanName(name);
  const file = !base || base.toLowerCase() === 'untitled' ? await untitledPath(guard(dir)) : await freePath(guard(dir), base);
  await fsp.writeFile(file, emptyScene(), { encoding: 'utf8', flag: 'wx' });
  trashed.delete(file.toLowerCase());
  return file;
});
// The blank canvas becomes "Untitled N" once something is drawn: in the folder last used
// (or the first attached one), or in Drafts when no folder is attached.
ipcMain.handle('file:untitled', async () => {
  const last = settings.lastFolder;
  let dir = last && insideAny(settings.folders, last) && fs.existsSync(last) ? last : settings.folders.find(f => fs.existsSync(f));
  if (!dir) {
    dir = DRAFTS();
    await fsp.mkdir(dir, { recursive: true });
    watch(dir);
  }
  const file = await untitledPath(dir);
  await fsp.writeFile(file, emptyScene(), { encoding: 'utf8', flag: 'wx' });
  trashed.delete(file.toLowerCase());
  return file;
});
ipcMain.handle('drafts:dir', () => DRAFTS());
ipcMain.handle('search:query', async (_e, q) => {
  await freshIndex();
  return index.query(q);
});
ipcMain.handle('file:pending', () => {
  pageReady = true;
  const file = pendingFile;
  pendingFile = null;
  return file;
});
// A video dropped on a board is copied into the board's media folder, from its path on
// disk when there is one, otherwise from the bytes the editor sends.
ipcMain.handle('media:add', (_e, board, name, source) => addMediaFile(guard(board), name, source));
ipcMain.handle('file:reveal', (_e, file) => shell.showItemInFolder(guard(file)));

ipcMain.handle('library:load', () => fsp.readFile(LIBRARY(), 'utf8').catch(() => null));
ipcMain.handle('library:save', (_e, text) => writeAtomic(LIBRARY(), text));

// "Browse libraries" opens libraries.excalidraw.com. Its "Add to Excalidraw" button sends
// the browser back to the editor's own address with #addLibrary=... in the hash; that
// navigation is caught here and handed to the editor, which installs the library.
function openLibrarySite(url) {
  const child = new BrowserWindow({ parent: win, width: 1100, height: 800, autoHideMenuBar: true, title: 'Excalidraw libraries' });
  const handBack = target => {
    if (!target.startsWith(ORIGIN)) return false;
    const hash = new URL(target).hash;
    if (hash.includes('addLibrary')) win?.webContents.send('library:install', hash);
    child.close();
    win?.focus();
    return true;
  };
  child.webContents.on('will-navigate', (e, target) => { if (handBack(target)) e.preventDefault(); });
  child.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!handBack(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  child.loadURL(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 720, minHeight: 480,
    title: 'Doodlebay', icon: path.join(here, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: settings.theme === 'dark' ? '#121212' : '#ffffff',
    show: !process.env.DOODLEBAY_HIDDEN,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  applyOnTop();

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).hostname === LIBRARY_SITE) openLibrarySite(url);
      else if (/^https?:/.test(url)) shell.openExternal(url);
    } catch { /* not a URL */ }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // Give the editor a moment to write the open drawing before the window goes.
  let closing = false;
  win.on('close', e => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    const done = () => { if (!win.isDestroyed()) win.destroy(); };
    ipcMain.once('app:flushed', done);
    setTimeout(done, 3000);
    win.webContents.send('app:flush');
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('did-start-loading', () => { pageReady = false; });

  win.loadURL(`${ORIGIN}/index.html`);
}

// The app was called ExcaliDesk before. On the first start under the new name, bring over
// its settings, library and Drafts from the old data folder beside this one. Drawings in
// attached folders never move, so nothing else is needed.
async function migrateFromExcaliDesk() {
  const dir = app.getPath('userData');
  const old = path.join(path.dirname(dir), 'ExcaliDesk');
  if (fs.existsSync(SETTINGS()) || !fs.existsSync(path.join(old, 'settings.json'))) return;
  await fsp.mkdir(dir, { recursive: true });
  for (const name of ['settings.json', 'library.excalidrawlib', 'Drafts']) {
    const from = path.join(old, name);
    if (fs.existsSync(from)) await fsp.cp(from, path.join(dir, name), { recursive: true, errorOnExist: false, force: false });
  }
}

app.whenReady().then(async () => {
  if (!firstCopy) return;
  protocol.handle('app', req => {
    // app://doodlebay/media?board=...&src=... plays a video from a board's media folder.
    const url = new URL(req.url);
    if (url.pathname === '/media') {
      try {
        const file = resolveMedia(guard(url.searchParams.get('board')), url.searchParams.get('src'));
        if (!VIDEO_TYPES[path.extname(file).toLowerCase()]) throw new Error('Not a video');
        return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  await migrateFromExcaliDesk().catch(() => {});
  settings = await readJson(SETTINGS(), DEFAULTS);
  settings.folders.forEach(watch);
  if (fs.existsSync(DRAFTS())) watch(DRAFTS());
  freshIndex().catch(() => {});
  history.pruneAll().catch(() => {});
  trash.sweep().catch(() => {});
  pendingFile = fileFromArgs(process.argv);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
