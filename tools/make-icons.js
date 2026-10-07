/*
 * Generates the extension icons (a small bar chart) as PNGs, so the repo does
 * not need a binary design asset or an image toolchain to rebuild them.
 *
 *   node tools/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // supersampling factor, for cheap antialiasing
const BG = [0x30, 0x2e, 0x2b];
const BARS = [
  { x: 0.18, h: 0.32, color: [0x4f, 0x6b, 0x33] },
  { x: 0.42, h: 0.52, color: [0x7f, 0xa6, 0x50] },
  { x: 0.66, h: 0.74, color: [0xf0, 0xc5, 0x41] }
];
const BAR_W = 0.16;
const PAD_BOTTOM = 0.17;
const RADIUS = 0.22;

function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideBar(x, y, size, bar) {
  const left = bar.x * size;
  const right = (bar.x + BAR_W) * size;
  const bottom = size * (1 - PAD_BOTTOM);
  const top = bottom - bar.h * size;
  const radius = (right - left) / 2;
  if (x < left || x > right || y > bottom || y < top) return false;
  // Round the top of each bar.
  if (y > top + radius) return true;
  const cx = (left + right) / 2;
  const dx = x - cx;
  const dy = y - (top + radius);
  return dx * dx + dy * dy <= radius * radius;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = RADIUS * size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      const colorSum = [0, 0, 0];
      let colorHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!insideRoundedRect(x, y, size, radius)) continue;
          bgHits++;
          for (const bar of BARS) {
            if (insideBar(x, y, size, bar)) {
              colorSum[0] += bar.color[0];
              colorSum[1] += bar.color[1];
              colorSum[2] += bar.color[2];
              colorHits++;
              break;
            }
          }
        }
      }
      const samples = SS * SS;
      const alpha = Math.round((bgHits / samples) * 255);
      let rgb = BG;
      if (colorHits) {
        const mix = colorHits / bgHits;
        const avg = colorSum.map((c) => c / colorHits);
        rgb = avg.map((c, i) => Math.round(c * mix + BG[i] * (1 - mix)));
      }
      const at = (py * size + px) * 4;
      pixels[at] = rgb[0];
      pixels[at + 1] = rgb[1];
      pixels[at + 2] = rgb[2];
      pixels[at + 3] = alpha;
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toPng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, toPng(size, render(size)));
  console.log('wrote', path.relative(path.join(__dirname, '..'), file));
}
