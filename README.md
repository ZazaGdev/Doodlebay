# ExcaliDesk

A free, minimal desktop drawing app built on the open-source [Excalidraw](https://github.com/excalidraw/excalidraw)
editor. Your drawings stay as ordinary `.excalidraw` files in your own folders. No account,
no cloud, no subscription.

- **The whole Excalidraw editor:** shapes, arrows, freehand, text, images, frames, the
  library (including "Browse libraries"), Mermaid text-to-diagram, search, export to PNG,
  SVG and clipboard, dark mode, canvas background, every keyboard shortcut.
- **Folder sidebar:** attach as many folders as you like. They show their subfolders and
  drawings, stay attached after a restart, and update when files change on disk.
  Attaching a folder never moves or changes anything in it.
- **Saves to the file:** a drawing saves back to its own `.excalidraw` file a moment after
  each change, and on Ctrl+S. The status button at the top right says whether it is saved.
- **New drawings:** hover a folder in the sidebar and press **+**.
- **Always on top:** the pin button at the top of the sidebar keeps the window above every
  other window, even when you switch apps. Press it again to turn it off. It is off by
  default and remembered.

- **Blank canvas to start:** with no drawing open you can draw straight away. The first
  stroke saves it as "Untitled 1" (then 2, 3...) in the folder you used last, or under
  **Drafts** in the sidebar when no folder is attached.
- **Opens .excalidraw files from Explorer:** double-click one and it opens in ExcaliDesk,
  in the window that is already open. A file outside your folders shows under
  **Opened file** and saves back to itself.
- **Library sections:** each library you add from "Browse libraries" gets its own named
  section that folds open and closed.

Files made here open on excalidraw.com and in any other Excalidraw app, and the other way round.

## Download

Get `ExcaliDesk-Setup-<version>.exe` from the
[latest release](https://github.com/ZazaGdev/ExcaliDesk/releases/latest) and run it.
It is not code-signed, so Windows SmartScreen shows "Windows protected your PC" the first
time: click **More info**, then **Run anyway**.

## Run it from the code

You need [Node.js](https://nodejs.org) 20 or newer (22 is what it is built with) and Windows.

```
git clone https://github.com/ZazaGdev/ExcaliDesk.git
cd ExcaliDesk
npm install
npm start
```

`npm start` builds the editor page and opens the app.

## Build the installer

```
npm run dist
```

This writes `dist/ExcaliDesk-Setup-<version>.exe`, an installer you can give to anyone on
Windows. It is not code-signed, so Windows SmartScreen shows "Windows protected your PC"
the first time: click **More info**, then **Run anyway**.

`npm run pack` makes an unpacked app in `dist/win-unpacked/` instead, which is quicker for
trying a build.

## Tests

```
npm test       # unit tests for the file handling
npm run e2e    # drives the real app (hidden) through every feature; screenshots in test/out/
```

To run the same checks against a packaged build, set `EXCALIDESK_EXE` to
`dist/win-unpacked/ExcaliDesk.exe` before `node test/e2e.mjs`.

The end-to-end run uses temporary folders, so it never touches your drawings or settings.
One check installs a library from libraries.excalidraw.com and is skipped when offline.

## Where things live

| What | Where |
| --- | --- |
| Your drawings | wherever they already are, in the folders you attach |
| Attached folders, theme, always-on-top | `%APPDATA%\ExcaliDesk\settings.json` |
| Your library | `%APPDATA%\ExcaliDesk\library.excalidrawlib` |

| Code | |
| --- | --- |
| `main.js` | the window, file access (only inside attached folders), folder watching, library site window |
| `preload.cjs` | the small bridge the page uses to reach `main.js` |
| `lib/files.js` | file helpers (listing, safe names, atomic saves, settings) |
| `src/` | the page: `main.jsx` app shell, `Sidebar.jsx` folder tree, `Editor.jsx` Excalidraw |
| `vite.config.js` | builds `src/` into `dist-renderer/` and copies the editor's fonts so it works offline |
| `src/LibrarySections.jsx` | the per-library sections in the library panel |
| `build/make-icon.mjs` | draws `build/icon.png` |
| `build/licenses.cjs` | writes `THIRD_PARTY_LICENSES.txt` |

## What is left out

Real-time collaboration, share links and the AI features (text-to-diagram AI, wireframe to
code) need Excalidraw's servers, so they are not in this app. The Mermaid tab of
text-to-diagram works offline and is included.

## Licence

MIT, see [LICENSE](LICENSE). Excalidraw is MIT licensed too; its notice is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and every other bundled package and font
is listed with its licence in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). ExcaliDesk is not made by or connected to
the Excalidraw team.
