// The bridge between the editor page and the main process. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => fn => {
  const handler = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('desk', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  attachFolders: () => ipcRenderer.invoke('folders:attach'),
  detachFolder: root => ipcRenderer.invoke('folders:detach', root),
  listDir: dir => ipcRenderer.invoke('dir:list', dir),
  readFile: file => ipcRenderer.invoke('file:read', file),
  writeFile: (file, text) => ipcRenderer.invoke('file:write', file, text),
  createFile: (dir, name) => ipcRenderer.invoke('file:create', dir, name),
  createUntitled: () => ipcRenderer.invoke('file:untitled'),
  draftsDir: () => ipcRenderer.invoke('drafts:dir'),
  pendingFile: () => ipcRenderer.invoke('file:pending'),
  onOpenFile: on('file:open'),
  revealFile: file => ipcRenderer.invoke('file:reveal', file),
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: text => ipcRenderer.invoke('library:save', text),
  onFoldersChanged: on('folders:changed'),
  onLibraryInstall: on('library:install'),
  onFlush: on('app:flush'),
  flushed: () => ipcRenderer.send('app:flushed'),
});
