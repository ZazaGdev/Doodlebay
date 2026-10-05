// ExcaliDesk main process: the window, the app:// protocol that serves the built editor,
// and the file access the sidebar and editor ask for. The renderer can only read and write
// inside folders the user attached, and attaching a folder never changes anything in it.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXT, insideAny, listDir, freePath, emptyScene, writeAtomic, readJson, writeJson } from './lib/files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, 'dist-renderer');
const ORIGIN = 'app://excalidesk';
const LIBRARY_SITE = 'libraries.excalidraw.com';

// Tests point this at a temp folder so they never touch the real settings.
if (process.env.EXCALIDESK_USER_DATA) app.setPath('userData', process.env.EXCALIDESK_USER_DATA);
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const LIBRARY = () => path.join(app.getPath('userData'), 'library.excalidrawlib');
const DEFAULTS = { folders: [], theme: 'light', sidebar: true, alwaysOnTop: false };

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let settings = { ...DEFAULTS };
const watchers = new Map();

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

// Every path the renderer sends is checked against the attached folders.
function guard(p) {
  const full = path.resolve(String(p || ''));
  if (!insideAny(settings.folders, full)) throw new Error('That file is not in an attached folder.');
  return full;
}

// One recursive watcher per attached folder; the sidebar reloads what it shows.
function watch(root) {
  if (watchers.has(root)) return;
  let timer = null;
  try {
    const w = fs.watch(root, { recursive: true }, () => {
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
ipcMain.handle('file:write', (_e, file, text) => {
  const full = guard(file);
  if (!full.toLowerCase().endsWith(EXT)) throw new Error('Only .excalidraw files are saved.');
  return writeAtomic(full, text);
});
ipcMain.handle('file:create', async (_e, dir, name) => {
  const file = await freePath(guard(dir), name);
  await fsp.writeFile(file, emptyScene(), { encoding: 'utf8', flag: 'wx' });
  return file;
});
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
    title: 'ExcaliDesk', icon: path.join(here, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: settings.theme === 'dark' ? '#121212' : '#ffffff',
    show: !process.env.EXCALIDESK_HIDDEN,
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

  win.loadURL(`${ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  settings = await readJson(SETTINGS(), DEFAULTS);
  settings.folders.forEach(watch);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
