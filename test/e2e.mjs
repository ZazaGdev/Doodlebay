// End-to-end check of the real app, run hidden: `npm run e2e`. Screenshots land in test/out/.
// Uses a temp settings folder and a temp drawings folder, so nothing real is touched.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'test', 'out');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-e2e-'));
const userData = path.join(tmp, 'user');
const drawings = path.join(tmp, 'Drawings');
await fs.mkdir(path.join(drawings, 'Sub'), { recursive: true });
const rect = { id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 120, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: solid(), strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
function solid() { return 'solid'; }
const scene = els => JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: els, appState: { viewBackgroundColor: '#ffffff' }, files: {} });
const plan = path.join(drawings, 'Plan.excalidraw');
await fs.writeFile(plan, scene([rect]));
await fs.writeFile(path.join(drawings, 'Sub', 'Inside.excalidraw'), scene([]));
await fs.writeFile(path.join(drawings, 'notes.txt'), 'not a drawing');

const results = [];
let step = 'launch';
const check = async (name, fn) => {
  step = name;
  try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (err) { results.push(['FAIL', name]); await shot(page, `fail-${results.length}`).catch(() => {}); console.log(`FAIL ${name}\n  ${err.message.split('\n')[0]}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readScene = async f => JSON.parse(await fs.readFile(f, 'utf8'));

async function launch(extra = []) {
  // DOODLEBAY_EXE runs the checks against a packaged build, e.g. dist/win-unpacked/Doodlebay.exe.
  const exe = process.env.DOODLEBAY_EXE;
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: extra } : { args: [root, ...extra] }), env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('  page error:', e.message));
  // Chromium reports the CDN font fallbacks as CSP errors even though the bundled fonts load.
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('esm.sh')) console.log(`  console [${step}]:`, m.text().slice(0, 120)); });
  await page.waitForSelector('.sidebar');
  return { app, page };
}
// A hidden packaged window did not paint in testing, so screenshots are skipped for it.
const shot = (page, name) => (process.env.DOODLEBAY_EXE ? Promise.resolve() : page.screenshot({ path: path.join(out, `${name}.png`) }));
const row = (page, name) => page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) });
const canvas = page => page.locator('canvas.interactive');
// Keyboard shortcuts only reach the editor once it has focus.
const focusCanvas = page => canvas(page).click({ position: { x: 800, y: 650 } });

let { app, page } = await launch();
await page.setViewportSize?.({ width: 1400, height: 900 });

await check('app starts with the empty sidebar', async () => {
  await page.getByText('Attach a folder to see its drawings here.').waitFor();
  await shot(page, '01-start');
});

const drawRect = async (x, y) => {
  const box = await canvas(page).boundingBox();
  await focusCanvas(page);
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 120, box.y + y + 80, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
};

await check('with no drawing open, a blank canvas is ready and drawing on it makes Untitled 1 in Drafts', async () => {
  await canvas(page).waitFor();
  assert.equal(await page.locator('.save-pill').count(), 0, 'blank canvas should not show a save state');
  assert.equal(await row(page, 'Drafts').count(), 0, 'Drafts should be hidden while empty');
  await drawRect(400, 300);
  await row(page, 'Untitled 1').waitFor();
  await row(page, 'Drafts').waitFor();
  await page.waitForFunction(() => document.title === 'Untitled 1 - Doodlebay');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  const s = await readScene(path.join(userData, 'Drafts', 'Untitled 1.excalidraw'));
  assert.equal(s.elements.filter(e => !e.isDeleted && e.type === 'rectangle').length, 1);
  await drawRect(600, 300);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  const s2 = await readScene(path.join(userData, 'Drafts', 'Untitled 1.excalidraw'));
  assert.equal(s2.elements.filter(e => !e.isDeleted && e.type === 'rectangle').length, 2, 'later strokes not saved');
  await shot(page, '01b-blank-to-untitled');
});

await check('attaching a folder lists its drawings and subfolders', async () => {
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, drawings);
  await page.getByRole('button', { name: 'Attach a folder' }).click();
  await row(page, 'Drawings').waitFor();
  await row(page, 'Plan').waitFor();
  await row(page, 'Sub').waitFor();
  assert.equal(await row(page, 'notes.txt').count(), 0);
  assert.equal(await row(page, 'notes').count(), 0);
  await row(page, 'Sub').click();
  await row(page, 'Inside').waitFor();
  await shot(page, '02-attached');
});

const mtime0 = (await fs.stat(plan)).mtimeMs;
await check('a drawing opens and opening does not rewrite it', async () => {
  await row(page, 'Plan').click();
  await canvas(page).waitFor();
  await page.locator('.save-pill').waitFor();
  await sleep(1500);
  assert.equal((await fs.stat(plan)).mtimeMs, mtime0, 'file was rewritten on open');
  assert.equal(await page.locator('.save-pill').textContent(), 'Saved');
  await shot(page, '03-open');
});

await check('drawing a rectangle, text and an image saves to the file', async () => {
  const box = await canvas(page).boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];
  await focusCanvas(page);
  await page.keyboard.press('r');
  await page.mouse.move(...at(500, 300));
  await page.mouse.down();
  await page.mouse.move(...at(650, 420), { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('t');
  await page.mouse.click(...at(500, 520));
  await page.keyboard.type('hello from Doodlebay');
  await page.keyboard.press('Escape');
  // Drop a small PNG on the canvas, as a user dragging an image in would.
  await page.evaluate(async ([x, y]) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#6965db'; g.fillRect(0, 0, 64, 64);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'square.png', { type: 'image/png' }));
    const target = document.querySelector('canvas.interactive');
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, at(800, 300));
  await sleep(1500);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  await sleep(300);
  const s = await readScene(plan);
  const live = s.elements.filter(e => !e.isDeleted);
  const types = live.map(e => e.type).sort();
  assert.ok(types.filter(t => t === 'rectangle').length === 2, `types: ${types}`);
  assert.ok(live.some(e => e.type === 'text' && e.text === 'hello from Doodlebay'), `types: ${types}`);
  assert.ok(types.includes('image'), `types: ${types}`);
  // Text measured before its font loads comes out too narrow and gets cut off.
  assert.ok(live.find(e => e.type === 'text').width > 200, 'text was measured with the wrong font');
  assert.equal(Object.keys(s.files).length, 1);
  assert.equal(s.type, 'excalidraw');
  await shot(page, '04-drawn');
});

await check('every tool in the toolbar is there', async () => {
  for (const tool of ['selection', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'eraser']) {
    assert.equal(await page.locator(`[data-testid="toolbar-${tool}"]`).count(), 1, `missing ${tool}`);
  }
});

await check('dark mode switches the editor and the sidebar', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Shift+D');
  await page.waitForSelector('.excalidraw.theme--dark');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, '05-dark');
});

await check('export to PNG and SVG produces real images', async () => {
  // Stand in for the save dialog so the exported bytes can be checked.
  await page.evaluate(() => {
    window.__saved = [];
    window.showSaveFilePicker = async opts => ({
      name: opts?.suggestedName || 'export',
      createWritable: async () => {
        const parts = [];
        return { write: async d => parts.push(d), close: async () => { window.__saved.push({ name: opts?.suggestedName, blob: new Blob(parts) }); } };
      },
    });
  });
  await page.keyboard.press('Control+Shift+e');
  await page.locator('.ImageExportModal').waitFor();
  await shot(page, '06-export-dialog');
  await page.locator('.ImageExportModal').getByRole('button', { name: /PNG/i }).first().click();
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 15000 });
  await page.locator('.ImageExportModal').getByRole('button', { name: /SVG/i }).first().click();
  await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 15000 });
  const files = await page.evaluate(async () => Promise.all(window.__saved.map(async s => ({ name: s.name, bytes: [...new Uint8Array(await s.blob.arrayBuffer())] }))));
  const png = Buffer.from(files[0].bytes);
  const svg = Buffer.from(files[1].bytes).toString('utf8');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(svg.includes('<svg'), 'no svg tag');
  await fs.writeFile(path.join(out, 'export.png'), png);
  await fs.writeFile(path.join(out, 'export.svg'), svg);
  await page.keyboard.press('Escape');
});

await check('Mermaid text-to-diagram makes elements', async () => {
  await page.evaluate(() => document.querySelector('[data-testid="dropdown-menu-button"], .App-toolbar .dropdown-menu-button')?.click());
  const item = page.getByText('Mermaid to Excalidraw');
  await item.click();
  await page.locator('.ttd-dialog').waitFor();
  await page.waitForSelector('.ttd-dialog-output-canvas-container canvas, .ttd-dialog-output-canvas-container svg', { timeout: 15000 });
  await shot(page, '07-mermaid');
  await page.keyboard.press('Escape');
});

await check('an empty library shows Browse libraries at the top and no pulsing +', async () => {
  // A selected shape is what makes Excalidraw show its pulsing "+".
  await focusCanvas(page);
  const box = await canvas(page).boundingBox();
  await page.mouse.click(box.x + 515, box.y + 530);
  await page.locator('.sidebar-trigger').first().click();
  const cta = page.locator('.ed-lib-browse');
  await cta.waitFor();
  assert.equal(await page.locator('.library-unit__adder').isVisible(), false, 'the pulsing + still shows');
  const top = await page.evaluate(() => document.querySelector('.layer-ui__library .library-menu-items-container').firstElementChild.className);
  assert.equal(top, 'ed-lib-cta-host', 'the button is not at the top of the panel');
  assert.equal(await page.locator('.library-menu-browse-button').first().isVisible(), false, 'two Browse libraries links show');
  await shot(page, '08-library-empty');
  const childP = app.waitForEvent('window');
  await cta.click();
  const child = await childP;
  // Offline the site cannot load, so check where the window was sent instead.
  const href = await page.locator('.library-menu-browse-button').first().evaluate(a => a.href);
  assert.match(href, /^https:\/\/libraries\.excalidraw\.com\//);
  await child.close();
  await page.keyboard.press('Escape');
});

await check('an item added to the library is stored', async () => {
  // Excalidraw does not put images in the library yet, so add the text on its own.
  await focusCanvas(page);
  const text = page.mouse;
  const box = await canvas(page).boundingBox();
  await text.click(box.x + 515, box.y + 530);
  await text.click(box.x + 515, box.y + 530, { button: 'right' });
  await shot(page, '08-context-menu');
  await page.getByText('Add to library').click();
  await sleep(1000);
  const lib = JSON.parse(await fs.readFile(path.join(userData, 'library.excalidrawlib'), 'utf8'));
  assert.equal(lib.libraryItems.length, 1);
  if (!await page.locator('.layer-ui__library').isVisible()) await page.locator('.sidebar-trigger').first().click();
  await page.locator('.library-menu-browse-button').first().waitFor();
  assert.equal(await page.locator('.ed-lib-browse').count(), 0, 'the empty-library button still shows');
  await shot(page, '08-library');
});

// Needs the internet: the library site is live. Skipped when it cannot be reached.
const LIB = 'https://libraries.excalidraw.com/libraries/youritjang/software-architecture.excalidrawlib';
const LIB2 = 'https://libraries.excalidraw.com/libraries/kaligule/robots.excalidrawlib';
const online = await fetch(LIB, { method: 'HEAD' }).then(r => r.ok, () => false);
const libraryOpen = async () => {
  if (!await page.getByText('Browse libraries').isVisible()) await page.locator('.sidebar-trigger').first().click();
  await page.getByText('Browse libraries').waitFor();
};
// What the site's "Add to Excalidraw" button does: send the window back to the editor.
const installFromSite = async lib => {
  await libraryOpen();
  // The site hands back the token from this link; a different token makes Excalidraw ask first.
  const href = await page.getByText('Browse libraries').evaluate(a => a.closest('a').href);
  const token = new URL(href).searchParams.get('token');
  const childP = app.waitForEvent('window');
  await page.getByText('Browse libraries').click();
  const child = await childP;
  await child.waitForURL(/libraries\.excalidraw\.com/, { timeout: 20000 });
  await child.waitForLoadState('load');
  await child.evaluate(([l, t]) => { location.href = `app://doodlebay/index.html#addLibrary=${encodeURIComponent(l)}&token=${t}`; }, [lib, token]).catch(() => {});
  await page.waitForFunction(() => !location.hash.includes('addLibrary'), null, { timeout: 15000 });
  await sleep(800);
  assert.equal((await app.windows()).length, 1, 'library window was not closed');
};
const section = name => page.locator('.ed-lib-section', { has: page.locator('.ed-lib-name', { hasText: new RegExp(`^${name}$`) }) });
if (online) await check('two installed libraries show as two named sections that fold, and their items drag onto the canvas', async () => {
  await page.keyboard.press('Escape');
  await installFromSite(LIB);
  await installFromSite(LIB2);
  await libraryOpen();
  await section('Software Architecture').waitFor();
  await section('Robots').waitFor();
  assert.equal(await page.locator('.ed-lib-section').count(), 2);
  assert.equal(await page.locator('.library-menu-items-container__header--excal').isVisible(), false, 'the old single grid still shows');
  assert.equal(await page.locator('.ed-lib-grid').count(), 0, 'sections should start folded');
  await shot(page, '08b-library-sections-folded');
  await section('Robots').locator('.ed-lib-head').click();
  await section('Robots').locator('.ed-lib-item').first().waitFor();
  await section('Software Architecture').locator('.ed-lib-head').click();
  await section('Software Architecture').locator('.ed-lib-item').first().waitFor();
  await section('Software Architecture').locator('.ed-lib-head').click();
  assert.equal(await section('Software Architecture').locator('.ed-lib-item').count(), 0, 'did not fold');
  await page.waitForFunction(() => document.querySelector('.ed-lib-item svg'));
  await shot(page, '08c-library-sections-open');
  const live = async () => (await readScene(plan)).elements.filter(e => !e.isDeleted).length;
  await page.keyboard.press('Control+s');
  await sleep(500);
  const before = await live();
  await section('Robots').locator('.ed-lib-item').first().dragTo(canvas(page), { targetPosition: { x: 300, y: 600 } });
  await sleep(500);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  await sleep(300);
  const afterDrag = await live();
  assert.ok(afterDrag > before, `drag added nothing (${before} -> ${afterDrag})`);
  // Like Excalidraw's own library, the panel closes once you work on the canvas.
  await libraryOpen();
  await section('Robots').locator('.ed-lib-item').first().click();
  await sleep(500);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  await sleep(300);
  assert.ok(await live() > afterDrag, 'click added nothing');
  const ids = (await readScene(plan)).elements.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'inserted elements share ids');
  const lib = JSON.parse(await fs.readFile(path.join(userData, 'library.excalidrawlib'), 'utf8'));
  assert.ok(lib.libraryItems.length >= 8);
  await shot(page, '08d-library-dragged');
  await page.keyboard.press('Escape');
});
else console.log('SKIP library site install (offline)');

await check('a new drawing can be made in an attached folder and its subfolder', async () => {
  await page.keyboard.press('Escape');
  await row(page, 'Drawings').hover();
  await row(page, 'Drawings').getByTitle('New drawing in this folder').click();
  await page.locator('.tree-input').fill('Fresh idea');
  await page.locator('.tree-input').press('Enter');
  await row(page, 'Fresh idea').waitFor();
  await page.waitForFunction(() => document.title === 'Fresh idea - Doodlebay');
  assert.equal((await readScene(path.join(drawings, 'Fresh idea.excalidraw'))).type, 'excalidraw');
  await row(page, 'Sub').hover();
  await row(page, 'Sub').getByTitle('New drawing in this folder').click();
  await page.locator('.tree-input').press('Enter');
  await row(page, 'Untitled 1').waitFor();
  await fs.access(path.join(drawings, 'Sub', 'Untitled 1.excalidraw'));
  await shot(page, '09-new');
});

// Asks Windows itself whether the window carries WS_EX_TOPMOST, the flag that keeps it above
// other apps after Alt+Tab or a click elsewhere. Elsewhere it falls back to Electron's view.
const onTop = async () => {
  const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  if (process.platform !== 'win32') return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop());
  const ps = `Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);'; ([U.W]::GetWindowLongPtr([IntPtr]${hwnd}, -20).ToInt64() -band 8) -ne 0`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim() === 'True';
};
await check('the new-drawing field creates the file on click-away, Enter still works, Esc cancels', async () => {
  const before = (await fs.readdir(drawings)).length;
  // Esc cancels.
  await row(page, 'Drawings').hover();
  await row(page, 'Drawings').getByTitle('New drawing in this folder').click();
  await page.locator('.tree-input').fill('Never made');
  await page.locator('.tree-input').press('Escape');
  await sleep(500);
  assert.equal((await fs.readdir(drawings)).length, before, 'Esc made a file');
  // A typed name, then a click on the canvas.
  await row(page, 'Drawings').hover();
  await row(page, 'Drawings').getByTitle('New drawing in this folder').click();
  await page.locator('.tree-input').fill('Clicked away');
  await canvas(page).click({ position: { x: 800, y: 650 } });
  await row(page, 'Clicked away').waitFor();
  await page.waitForFunction(() => document.title === 'Clicked away - Doodlebay');
  await fs.access(path.join(drawings, 'Clicked away.excalidraw'));
  // The default name left alone, then a click elsewhere: the next free Untitled.
  await row(page, 'Drawings').hover();
  await row(page, 'Drawings').getByTitle('New drawing in this folder').click();
  await page.locator('.brand').click();
  await row(page, 'Untitled 1').first().waitFor();
  await fs.access(path.join(drawings, 'Untitled 1.excalidraw'));
  assert.equal((await fs.readdir(drawings)).length, before + 2);
});

await check('always on top is off by default and the pin turns it on and off', async () => {
  assert.equal(await onTop(), false);
  await page.locator('.pin').click();
  assert.equal(await onTop(), true);
  await page.locator('.pin').click();
  assert.equal(await onTop(), false);
  await page.locator('.pin').click();
  assert.equal(await onTop(), true);
  await shot(page, '09b-pinned');
});

await check('a file added on disk shows up in the sidebar', async () => {
  await fs.writeFile(path.join(drawings, 'From outside.excalidraw'), scene([]));
  await row(page, 'From outside').waitFor({ timeout: 5000 });
});

const textEl = (id, t, x, y) => ({ ...rect, id, type: 'text', x, y, width: 220, height: 25, text: t, originalText: t, fontSize: 20, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true });
await check('search finds text in any attached drawing, opens it at the match, and follows changes on disk', async () => {
  await fs.writeFile(path.join(drawings, 'Sub', 'Deep note.excalidraw'), scene([rect, textEl('far', 'the zebracorn lives here', 3000, 2200)]));
  await focusCanvas(page);
  await page.keyboard.press('Control+Shift+F');
  const box = page.getByLabel('Search all drawings');
  assert.equal(await box.evaluate(el => el === document.activeElement), true, 'Ctrl+Shift+F did not reach the search box');
  await box.fill('zebracorn');
  const hit = page.locator('.search-match', { hasText: 'zebracorn' });
  await hit.waitFor({ timeout: 5000 });
  await shot(page, '12-search');
  await hit.click();
  await page.waitForFunction(() => document.title.startsWith('Deep note'));
  // The text is selected, so Excalidraw shows its text properties.
  await page.getByText('Font family').waitFor({ timeout: 5000 });
  await sleep(600);
  await shot(page, '12b-search-opened');

  // A drawing changed outside Doodlebay is searchable straight away.
  await fs.writeFile(path.join(drawings, 'Sub', 'Inside.excalidraw'), scene([textEl('q1', 'feed the quokka', 100, 100)]));
  await sleep(600);
  await box.fill('quokka');
  await page.locator('.search-hit', { hasText: 'Inside' }).waitFor({ timeout: 5000 });
  await box.press('Escape');
  await row(page, 'Plan').waitFor();
});

await check('closing the window saves the last edit', async () => {
  await row(page, 'Fresh idea').click();
  await canvas(page).waitFor();
  await sleep(500);
  const box = await canvas(page).boundingBox();
  await focusCanvas(page);
  await page.keyboard.press('o');
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 380, { steps: 5 });
  await page.mouse.up();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await app.waitForEvent('close').catch(() => {});
  const s = await readScene(path.join(drawings, 'Fresh idea.excalidraw'));
  assert.ok(s.elements.some(e => e.type === 'ellipse'), 'ellipse not saved');
});

({ app, page } = await launch());
await check('attached folders, theme, always on top and library survive a restart', async () => {
  await row(page, 'Plan').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await onTop(), true, 'always on top was not kept');
  await row(page, 'Plan').click();
  await canvas(page).waitFor();
  await page.locator('.sidebar-trigger').first().click();
  await page.locator('.library-unit').first().waitFor({ timeout: 5000 });
  if (online) {
    // Robots was left open and Software Architecture folded.
    await section('Robots').locator('.ed-lib-item').first().waitFor({ timeout: 5000 });
    assert.equal(await section('Software Architecture').locator('.ed-lib-item').count(), 0, 'fold state not kept');
  }
  await shot(page, '10-restart');
});
await app.close();

({ app, page } = await launch());
await check('after a restart the blank canvas saves as the next Untitled in the last used folder', async () => {
  await canvas(page).waitFor();
  const existing = new Set(await fs.readdir(drawings));
  await drawRect(400, 300);
  await page.waitForFunction(() => /^Untitled \d+ - Doodlebay$/.test(document.title));
  const name = (await page.title()).replace(' - Doodlebay', '');
  const file = path.join(drawings, `${name}.excalidraw`);
  assert.ok(!existing.has(`${name}.excalidraw`), 'reused an existing name');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  assert.equal((await readScene(file)).elements.filter(e => !e.isDeleted).length, 1);
  // Opening another drawing straight after a stroke keeps the stroke.
  await drawRect(600, 300);
  await row(page, 'Plan').click();
  await page.waitForFunction(() => document.title === 'Plan - Doodlebay');
  await sleep(500);
  assert.equal((await readScene(file)).elements.filter(e => !e.isDeleted).length, 2, 'stroke lost when switching');
  await shot(page, '11-untitled-in-folder');
});
await app.close();

// Opening from Explorer: Windows runs the app with the file as its argument.
const elsewhere = path.join(tmp, 'Elsewhere');
await fs.mkdir(elsewhere);
const loose = path.join(elsewhere, 'Loose.excalidraw');
const loose2 = path.join(elsewhere, 'Second.excalidraw');
await fs.writeFile(loose, scene([rect]));
await fs.writeFile(loose2, scene([]));
({ app, page } = await launch([loose]));
await check('a file passed on start opens on its own as an Opened file and saves back to itself', async () => {
  await page.waitForFunction(() => document.title === 'Loose - Doodlebay');
  await row(page, 'Opened file').waitFor();
  await row(page, 'Loose').waitFor();
  assert.equal(await row(page, 'Elsewhere').count(), 0, 'its folder must not be attached');
  await canvas(page).waitFor();
  await drawRect(600, 450);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  assert.equal((await readScene(loose)).elements.filter(e => !e.isDeleted).length, 2);
  await shot(page, '12-opened-file');
});

await check('a second launch with a file opens it in the running window and exits', async () => {
  const exe = process.env.DOODLEBAY_EXE || createRequire(import.meta.url)('electron');
  const args = process.env.DOODLEBAY_EXE ? [loose2] : [root, loose2];
  const second = spawn(exe, args, { env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: userData }, stdio: 'ignore' });
  const code = await new Promise((res, rej) => { second.on('exit', res); setTimeout(() => rej(new Error('second copy kept running')), 20000); });
  assert.equal(code, 0);
  await page.waitForFunction(() => document.title === 'Second - Doodlebay', null, { timeout: 10000 });
  await row(page, 'Second').waitFor();
  await row(page, 'Loose').waitFor();
  assert.equal((await app.windows()).length, 1);
  await shot(page, '13-second-launch');
});
await app.close();

// First start after the rename: ExcaliDesk's data folder sits beside Doodlebay's.
{
  const old = path.join(tmp, 'ExcaliDesk');
  await fs.mkdir(path.join(old, 'Drafts'), { recursive: true });
  await fs.writeFile(path.join(old, 'settings.json'), JSON.stringify({ folders: [drawings], theme: 'dark', sidebar: true, alwaysOnTop: false }));
  await fs.copyFile(path.join(userData, 'library.excalidrawlib'), path.join(old, 'library.excalidrawlib'));
  await fs.writeFile(path.join(old, 'Drafts', 'Old draft.excalidraw'), scene([]));
  const fresh = path.join(tmp, 'Doodlebay');
  const exe = process.env.DOODLEBAY_EXE;
  const app2 = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [root] }), env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: fresh } });
  const page2 = await app2.firstWindow();
  await page2.waitForSelector('.sidebar');
  await check('first start after the rename brings over ExcaliDesk folders, theme, library and Drafts', async () => {
    await page2.locator('.tree-name', { hasText: /^Plan$/ }).waitFor();
    await page2.locator('.tree-name', { hasText: /^Old draft$/ }).waitFor();
    assert.equal(await page2.evaluate(() => document.documentElement.dataset.theme), 'dark');
    const lib = JSON.parse(await fs.readFile(path.join(fresh, 'library.excalidrawlib'), 'utf8'));
    assert.ok(lib.libraryItems.length >= 1, 'library not carried over');
    await fs.access(path.join(old, 'settings.json'));
  });
  await app2.close();
}

await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
