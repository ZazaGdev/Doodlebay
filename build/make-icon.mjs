// Draws Doodlebay's logo into build/icon.png (512 x 512): a whiteboard on legs with a squiggle
// and an orange marker. The shapes follow build/logo.svg (a 256 x 256 viewBox), so change both
// together. Run with `node build/make-icon.mjs`. No dependencies: it writes the PNG itself.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const S = 512;
const K = S / 256; // pixels per logo.svg unit
const px = new Float32Array(S * S * 4);

// Signed distance helpers in logo.svg units, so every edge is antialiased.
const rect = (x, y, left, top, w, h, r) => {
  const qx = Math.abs(x - left - w / 2) - w / 2 + r, qy = Math.abs(y - top - h / 2) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (x, y, ax, ay, bx, by, r) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};

// The squiggle "M66 128c14-40 30-40 40-10s26 30 40-6 30-30 44 4" as absolute cubic curves,
// flattened into short segments.
const CURVES = [
  [[66, 128], [80, 88], [96, 88], [106, 118]],
  [[106, 118], [116, 148], [132, 148], [146, 112]],
  [[146, 112], [160, 76], [176, 82], [190, 116]],
];
const SQUIGGLE = CURVES.flatMap(([a, b, c, d], i) => Array.from({ length: 25 }, (_, k) => {
  const t = k / 24, u = 1 - t;
  return [0, 1].map(j => u * u * u * a[j] + 3 * u * u * t * b[j] + 3 * u * t * t * c[j] + t * t * t * d[j]);
}).slice(i ? 1 : 0));
const line = (x, y, pts, r) => Math.min(...pts.slice(1).map((p, k) => segment(x, y, ...pts[k], ...p, r)));

const layers = [
  { color: [107, 99, 221], d: (x, y) => rect(x, y, 0, 0, 256, 256, 56) },        // tile
  { color: [255, 255, 255], d: (x, y) => rect(x, y, 40, 52, 176, 120, 12) },     // board
  { color: [107, 99, 221], d: (x, y) => line(x, y, SQUIGGLE, 6) },              // squiggle
  { color: [230, 228, 251], d: (x, y) => rect(x, y, 34, 172, 188, 12, 6) },     // tray
  { color: [255, 122, 89], d: (x, y) => rect(x, y, 150, 160, 44, 12, 6) },      // marker
  { color: [255, 255, 255], d: (x, y) => Math.min(segment(x, y, 84, 184, 70, 218, 5), segment(x, y, 172, 184, 186, 218, 5)) }, // legs
];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    for (const { color, d } of layers) {
      const a = Math.max(0, Math.min(1, 0.5 - d((x + 0.5) / K, (y + 0.5) / K) * K));
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
