// Draws ExcaliDesk's own logo into build/icon.png (512 x 512): a folder with a pencil stroke
// across it. Run with `node build/make-icon.mjs`. No dependencies: it writes the PNG itself.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const S = 512;
const px = new Float32Array(S * S * 4);

// Signed distance helpers, so every edge is antialiased.
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (x, y, ax, ay, bx, by, r) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};

const WAVE = Array.from({ length: 25 }, (_, k) => [176 + k * 7, 286 - 34 * Math.sin((k / 24) * Math.PI * 2)]);

const layers = [
  // background tile
  { color: [105, 101, 219], d: (x, y) => roundRect(x, y, 256, 256, 240, 240, 96) },
  // folder tab and body
  { color: [255, 255, 255], d: (x, y) => roundRect(x, y, 186, 160, 70, 34, 22) },
  { color: [255, 255, 255], d: (x, y) => roundRect(x, y, 256, 276, 150, 112, 30) },
  // a hand-drawn wave across the folder
  { color: [105, 101, 219], d: (x, y) => Math.min(...WAVE.slice(1).map((p, k) => segment(x, y, ...WAVE[k], ...p, 15))) },
];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    for (const { color, d } of layers) {
      const a = Math.max(0, Math.min(1, 0.5 - d(x + 0.5, y + 0.5)));
      if (!a) continue;
      for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * (1 - a) + color[c] * a;
      px[i + 3] = px[i + 3] + (1 - px[i + 3]) * a;
    }
  }
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, o = y * (S * 4 + 1) + 1 + x * 4;
    const a = px[i + 3];
    raw[o] = a ? Math.round(px[i] / a) : 0;
    raw[o + 1] = a ? Math.round(px[i + 1] / a) : 0;
    raw[o + 2] = a ? Math.round(px[i + 2] / a) : 0;
    raw[o + 3] = Math.round(a * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(fileURLToPath(new URL('./icon.png', import.meta.url)), png);
