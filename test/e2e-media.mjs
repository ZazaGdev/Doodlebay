// End-to-end check of GIFs and videos on a board, run after `npm run build`:
// `node test/e2e-media.mjs`, or with DOODLEBAY_EXE set to check a packaged build.
// Uses a temp settings folder and a temp drawings folder.
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
const clip = (await fs.readFile(path.join(root, 'test', 'fixtures', 'clip.webm'))).toString('base64');

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (err) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n  ${err.message.split('\n')[0]}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open() {
  // DOODLEBAY_EXE runs the checks against a packaged build, e.g. dist/win-unpacked/Doodlebay.exe.
  const exe = process.env.DOODLEBAY_EXE;
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [root] }), env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('  page error:', e.message));
  // A hidden window barely paints, so GIFs hardly advance. Show it off screen and unfocused.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: -6000, y: -6000, width: 1400, height: 900 }); w.showInactive(); });
  await page.locator('.tree-name', { hasText: /^Board$/ }).click();
  await page.locator('canvas.interactive').waitFor();
  return { app, page };
}

// Two frames 300ms apart: a GIF that animates looks different at some point in a second.
const save = async page => {
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => ['Saved', undefined].includes(document.querySelector('.save-pill')?.textContent));
  await sleep(300);
  return JSON.parse(await fs.readFile(board, 'utf8'));
};
const videoEl = s => s.elements.find(e => !e.isDeleted && e.customData?.video);
// What the video on the board is doing right now.
const video = page => page.evaluate(() => {
  const v = document.querySelector('.media-layer video');
  return v && { time: v.currentTime, paused: v.paused, ended: v.ended, muted: v.muted, loop: v.loop };
});
// The 1.2 second clip: true when it is moving, checked over half a second.
async function playing(page) {
  const a = await video(page);
  await sleep(500);
  const b = await video(page);
  return !!a && !b.paused && b.time !== a.time;
}
const button = (page, text) => page.locator('.media-controls button', { hasText: text });
// Clicks the middle of the video so Excalidraw selects it and shows its buttons.
async function selectVideo(page) {
  const box = await page.locator('.media-layer video').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.media-controls').waitFor();
}

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

await check('a dropped video is copied next to the board and plays muted, on repeat', async () => {
  await page.evaluate(async ([b64]) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clip.webm', { type: 'video/webm' }));
    const target = document.querySelector('canvas.interactive');
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.x + 500, clientY: r.y + 550, bubbles: true, cancelable: true }));
  }, [clip]);
  await page.locator('.media-layer video').waitFor();
  const copy = await fs.readFile(path.join(drawings, 'Board.media', 'clip.webm'));
  assert.equal(copy.toString('base64'), clip, 'video copy differs');
  const s = await save(page);
  const el = videoEl(s);
  assert.deepEqual(el?.customData, { video: 'Board.media/clip.webm', loop: true });
  assert.equal(s.files[el.fileId].mimeType, 'image/jpeg', 'the board keeps a still frame of the video');
  assert.ok(!JSON.stringify(s).includes(clip.slice(0, 200)), 'the video itself must not be inside the board');
  const v = await video(page);
  assert.equal(v.muted, true, 'starts muted');
  assert.equal(v.loop, true, 'repeat is on for a new video');
  await sleep(1600);
  assert.ok(await playing(page), 'video is not playing past its end on repeat');
  assert.equal(await page.locator('.tree-name', { hasText: /Board\.media/ }).count(), 0, 'media folder shows in the sidebar');
  await page.screenshot({ path: path.join(out, 'media-03-video.png') });
});

await check('a video dropped from disk is copied from its path', async () => {
  const from = path.join(root, 'test', 'fixtures', 'clip.webm');
  const rel = await page.evaluate(([b, f]) => window.desk.addMedia(b, 'clip.webm', f), [board, from]);
  assert.equal(rel, 'Board.media/clip 2.webm');
  assert.equal((await fs.readFile(path.join(drawings, 'Board.media', 'clip 2.webm'))).toString('base64'), clip);
  const refused = await page.evaluate(([b, f]) => window.desk.addMedia(b, 'x.mp4', f).then(() => 'copied', () => 'refused'), [board, path.join(userData, 'settings.json')]);
  assert.equal(refused, 'refused', 'a non-video file was copied in');
  const outside = await page.evaluate(f => fetch(`/media?board=${encodeURIComponent(f)}&src=${encodeURIComponent('../user/settings.json')}`).then(r => r.status), board);
  assert.equal(outside, 404, 'the media address served a file outside the media folder');
});

await check('unmute, and repeat off stops at the end, repeat on plays it again', async () => {
  await page.locator('.media-controls').waitFor();
  await button(page, 'Unmute').click();
  assert.equal((await video(page)).muted, false, 'unmute did not unmute');
  await button(page, 'Repeat: on').click();
  await button(page, 'Repeat: off').waitFor();
  await page.waitForFunction(() => document.querySelector('.media-layer video')?.ended, null, { timeout: 4000 });
  const stopped = await video(page);
  await sleep(500);
  assert.equal((await video(page)).time, stopped.time, 'video kept going with repeat off');
  assert.equal(videoEl(await save(page)).customData.loop, false, 'repeat off not saved');
  await page.screenshot({ path: path.join(out, 'media-04-repeat-off.png') });
  await button(page, 'Repeat: off').click();
  assert.ok(await playing(page), 'repeat on did not play it again');
  assert.equal(videoEl(await save(page)).customData.loop, true, 'repeat on not saved');
  // Leave it off, to see that survives a reopen.
  await button(page, 'Repeat: on').click();
  assert.equal(videoEl(await save(page)).customData.loop, false);
});

await app.close();
({ app, page } = await open());

await check('after reopening, the video plays muted with repeat still off, and repeat on loops it', async () => {
  await page.locator('.media-layer video').waitFor();
  const v = await video(page);
  assert.equal(v.muted, true);
  assert.equal(v.loop, false);
  await page.waitForFunction(() => document.querySelector('.media-layer video')?.ended, null, { timeout: 4000 });
  await selectVideo(page);
  await button(page, 'Repeat: off').click();
  assert.ok(await playing(page), 'repeat on did not play it again after reopening');
  await sleep(1500);
  assert.ok(await playing(page), 'did not loop after reopening');
  await page.screenshot({ path: path.join(out, 'media-05-video-reopened.png') });
});

await check('after reopening, the GIF still plays', async () => {
  assert.ok(await animates(page), 'GIF did not change frames after reopening');
  await page.screenshot({ path: path.join(out, 'media-02-gif-reopened.png') });
});

await app.close();
await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
