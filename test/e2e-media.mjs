// End-to-end check of GIFs (and later videos) on a board, run hidden after `npm run build`:
// `node test/e2e-media.mjs`. Uses a temp settings folder and a temp drawings folder.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'test', 'out');
await fs.mkdir(out, { recursive: true });

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'doodlebay-media-'));
const userData = path.join(tmp, 'user');
const drawings = path.join(tmp, 'Drawings');
await fs.mkdir(drawings, { recursive: true });
await fs.mkdir(userData, { recursive: true });
await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({ folders: [drawings], theme: 'light', sidebar: true, alwaysOnTop: false }));
const board = path.join(drawings, 'Board.excalidraw');
await fs.writeFile(board, JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }));
const gif = (await fs.readFile(path.join(root, 'test', 'fixtures', 'blink.gif'))).toString('base64');

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (err) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n  ${err.message.split('\n')[0]}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open() {
  const app = await electron.launch({ args: [root], env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('  page error:', e.message));
  // A hidden window barely paints, so GIFs hardly advance. Show it off screen and unfocused.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: -6000, y: -6000, width: 1400, height: 900 }); w.showInactive(); });
  await page.locator('.tree-name', { hasText: /^Board$/ }).click();
  await page.locator('canvas.interactive').waitFor();
  return { app, page };
}

// Two frames 300ms apart: a GIF that animates looks different at some point in a second.
async function animates(page) {
  const img = page.locator('.media-layer img').first();
  await img.waitFor();
  const first = await img.screenshot();
  for (let i = 0; i < 8; i++) {
    await sleep(150);
    if (!(await img.screenshot()).equals(first)) return true;
  }
  return false;
}

let { app, page } = await open();

await check('a dropped GIF is saved as the animated GIF and plays on the board', async () => {
  await page.evaluate(async ([b64]) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'blink.gif', { type: 'image/gif' }));
    const target = document.querySelector('canvas.interactive');
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.x + 600, clientY: r.y + 300, bubbles: true, cancelable: true }));
  }, [gif]);
  await sleep(1500);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.save-pill')?.textContent === 'Saved');
  await sleep(300);
  const s = JSON.parse(await fs.readFile(board, 'utf8'));
  const file = Object.values(s.files)[0];
  assert.equal(file?.mimeType, 'image/gif');
  assert.equal(file.dataURL.split(',')[1], gif, 'saved GIF is not the original file');
  assert.ok(await animates(page), 'GIF on the board did not change frames');
  await page.screenshot({ path: path.join(out, 'media-01-gif.png') });
});

await app.close();
({ app, page } = await open());

await check('after reopening, the GIF still plays', async () => {
  assert.ok(await animates(page), 'GIF did not change frames after reopening');
  await page.screenshot({ path: path.join(out, 'media-02-gif-reopened.png') });
});

await app.close();
await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
