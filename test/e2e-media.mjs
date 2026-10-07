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
const empty = JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
await fs.writeFile(board, empty);
const board2 = path.join(drawings, 'Board2.excalidraw');
await fs.writeFile(board2, empty);
// Same name as the first board, in another folder.
const twin = path.join(drawings, 'Sub', 'Board.excalidraw');
await fs.mkdir(path.dirname(twin));
await fs.writeFile(twin, empty);
const gif = (await fs.readFile(path.join(root, 'test', 'fixtures', 'blink.gif'))).toString('base64');
const clip = (await fs.readFile(path.join(root, 'test', 'fixtures', 'clip.webm'))).toString('base64');

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (err) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n  ${err.message.split('\n')[0]}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(name = 'Board') {
  // DOODLEBAY_EXE runs the checks against a packaged build, e.g. dist/win-unpacked/Doodlebay.exe.
  const exe = process.env.DOODLEBAY_EXE;
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [root] }), env: { ...process.env, DOODLEBAY_HIDDEN: '1', DOODLEBAY_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('  page error:', e.message));
  // A hidden window barely paints, so GIFs hardly advance. Show it off screen and unfocused.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: -6000, y: -6000, width: 1400, height: 900 }); w.showInactive(); });
  if (name) await openBoard(page, name);
  await page.locator('canvas.interactive').waitFor();
  return { app, page };
}

async function openBoard(page, name) {
  await page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator('.save-pill').waitFor();
  await sleep(800);
}
const readScene = async f => JSON.parse(await fs.readFile(f, 'utf8'));
const drop = (page, b64, name, type, x, y) => page.evaluate(async ([b64, name, type, x, y]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type }));
  const target = document.querySelector('canvas.interactive');
  const r = target.getBoundingClientRect();
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.x + x, clientY: r.y + y, bubbles: true, cancelable: true }));
}, [b64, name, type, x, y]);
// Clicks an empty spot of the canvas, which also clears the selection.
const clickEmpty = page => page.mouse.click(1300, 820);

// True when the still copy Excalidraw draws sits exactly under the live GIF: with the live
// layer hidden, points 4px inside each corner of the GIF's box must show the GIF, not paper.
async function aligned(page) {
  const box = await page.locator('.media-layer img').first().boundingBox();
  await page.evaluate(() => { document.querySelector('.media-layer').style.visibility = 'hidden'; });
  await sleep(100);
  const shot = (await page.screenshot({ clip: box })).toString('base64');
  await page.evaluate(() => { document.querySelector('.media-layer').style.visibility = ''; });
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const at = (x, y) => g.getImageData(x, y, 1, 1).data;
    const w = img.width - 5, h = img.height - 5;
    return [[4, 4], [w, 4], [4, h], [w, h]].every(([x, y]) => { const [r, gg, b] = at(x, y); return !(r > 240 && gg > 240 && b > 240); });
  }, shot);
}

// Two frames 300ms apart: a GIF that animates looks different at some point in a second.
const save = async (page, file = board) => {
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => ['Saved', undefined].includes(document.querySelector('.save-pill')?.textContent));
  await sleep(300);
  return JSON.parse(await fs.readFile(file, 'utf8'));
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
  assert.equal(el?.customData.video, 'Board.media/clip.webm');
  assert.equal(el.customData.loop, true);
  assert.match(el.customData.id, /^[0-9a-f]{32}$/);
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

await check('the live GIF stays exactly over the drawn one when zoomed and scrolled', async () => {
  await clickEmpty(page);
  assert.ok(await aligned(page), 'misaligned at 100%');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.mouse.move(900, 500);
  await page.mouse.wheel(120, 90);
  await sleep(400);
  assert.ok(await aligned(page), 'misaligned after zooming and scrolling');
  await page.screenshot({ path: path.join(out, 'media-06-zoomed.png') });
  await page.keyboard.press('Shift+1');
  await sleep(400);
});

await check('deleting a GIF removes it from the board, and undo brings it back playing', async () => {
  const box = await page.locator('.media-layer img').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => !document.querySelector('.media-layer img'));
  await page.keyboard.press('Control+z');
  await page.locator('.media-layer img').waitFor();
  assert.ok(await animates(page), 'GIF did not play after undo');
  await clickEmpty(page);
});

await check('copying the GIF and the video into another board keeps both playing there', async () => {
  await clickEmpty(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await sleep(300);
  await openBoard(page, 'Board2');
  await clickEmpty(page);
  await page.keyboard.press('Control+v');
  await page.locator('.media-layer video').waitFor();
  await sleep(1500);
  const s = await save(page, board2);
  const el = videoEl(s);
  assert.equal(el?.customData.video, 'Board2.media/clip.webm', 'pasted video still points at the first board');
  assert.equal((await fs.readFile(path.join(drawings, 'Board2.media', 'clip.webm'))).toString('base64'), clip);
  const gifFile = Object.values(s.files).find(f => f.mimeType === 'image/gif');
  assert.equal(gifFile?.dataURL.split(',')[1], gif, 'pasted GIF is not the animated original');
  assert.ok(await playing(page), 'pasted video does not play');
  assert.ok(await animates(page), 'pasted GIF does not play');
  await page.screenshot({ path: path.join(out, 'media-07-pasted.png') });
});

await check('a board in the Trash takes its videos with it, and gets them back on restore', async () => {
  await openBoard(page, 'Board');
  await page.evaluate(f => window.desk.trashFile(f), board2);
  await assert.rejects(fs.access(path.join(drawings, 'Board2.media')), 'media folder left behind');
  const [item] = await page.evaluate(() => window.desk.listTrash());
  await page.evaluate(id => window.desk.restoreTrash(id), item.id);
  await fs.access(path.join(drawings, 'Board2.media', 'clip.webm'));
  await openBoard(page, 'Board2');
  assert.ok(await playing(page), 'the restored board video does not play');
});

await check('pasting into a board of the same name in another folder copies the video there too', async () => {
  await openBoard(page, 'Board');
  const source = videoEl(await readScene(board));
  await clickEmpty(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await sleep(300);
  await page.locator('.tree-name', { hasText: /^Sub$/ }).click();
  // Sub's own drawings are listed under it, before the folder's other drawings.
  const boards = page.locator('.tree-name', { hasText: /^Board$/ });
  await boards.nth(1).waitFor();
  await boards.first().click();
  await page.locator('.tree-row.active', { has: page.locator('.tree-name', { hasText: /^Board$/ }) }).waitFor();
  assert.equal(await page.locator('.tree-row').nth(2).getAttribute('class').then(c => c.includes('active')), true, 'Sub/Board did not open');
  await page.locator('.save-pill').waitFor();
  await sleep(800);
  await clickEmpty(page);
  await page.keyboard.press('Control+v');
  await page.locator('.media-layer video').first().waitFor();
  await sleep(1500);
  const saved = await save(page, twin);
  const el = videoEl(saved);
  assert.equal(el?.customData.video, 'Board.media/clip.webm');
  assert.notEqual(el.customData.id, source.customData.id, 'the copy should be its own video');
  assert.equal((await fs.readFile(path.join(drawings, 'Sub', 'Board.media', 'clip.webm'))).toString('base64'), clip);
  assert.ok(await playing(page), 'video does not play in the same-named board');
});

await app.close();
({ app, page } = await open(null));

await check('on the blank canvas a video asks for a saved board, and a GIF starts one that keeps it', async () => {
  await drop(page, clip, 'clip.webm', 'video/webm', 500, 400);
  await page.getByText('Draw something first').waitFor();
  await drop(page, gif, 'blink.gif', 'image/gif', 500, 400);
  await page.locator('.tree-name', { hasText: /^Untitled 1$/ }).waitFor();
  await sleep(1500);
  const found = [];
  // It lands in the folder used last, or in Drafts.
  for (const d of [drawings, path.join(drawings, 'Sub'), path.join(userData, 'Drafts')]) for (const f of await fs.readdir(d).catch(() => [])) if (f === 'Untitled 1.excalidraw') found.push(path.join(d, f));
  assert.equal(found.length, 1, `Untitled files: ${found}`);
  const s = await readScene(found[0]);
  const file = Object.values(s.files)[0];
  assert.equal(file?.dataURL.split(',')[1], gif, 'GIF on a new board was not kept animated');
  assert.ok(await animates(page), 'GIF on a new board does not play');
});

await app.close();
await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
