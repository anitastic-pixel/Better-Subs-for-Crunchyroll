// tools/generate-icons.mjs
//
// Generates the extension icons (16 / 48 / 128) as PNGs straight from code —
// no design tool or browser required. Run:  node tools/generate-icons.mjs
//
// Design: a deep-navy rounded square (brand background, matching the popup)
// with two rounded orange "subtitle line" bars (brand accent #ff6b35). The
// canvas is rendered at 4x and box-downsampled with premultiplied alpha for
// smooth, anti-aliased edges. Output overwrites extension/icons/icon{16,48,128}.png.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');

const NAVY_TOP = [26, 26, 46];    // #1a1a2e
const NAVY_BOT = [22, 33, 62];    // #16213e
const ORANGE   = [255, 107, 53];  // #ff6b35
const SUPER    = 4;               // supersample factor

// ── rounded-rect hit test (point inside rect [x0,y0,w,h] with corner radius r)
function insideRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const rx0 = x0 + r, rx1 = x0 + w - r, ry0 = y0 + r, ry1 = y0 + h - r;
  const cornerX = x < rx0 || x > rx1;
  const cornerY = y < ry0 || y > ry1;
  if (cornerX && cornerY) {
    const cx = x < rx0 ? rx0 : rx1;
    const cy = y < ry0 ? ry0 : ry1;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function renderIcon(size) {
  const R = size * SUPER;
  const sup = new Uint8ClampedArray(R * R * 4);

  const bgRadius = 0.22 * R;
  const pad  = 0.20 * R;
  const barH = 0.13 * R;
  const gap  = 0.10 * R;
  const botY = 0.57 * R, topY = botY - gap - barH;
  const botX = pad, botW = R - 2 * pad;
  const topW = botW * 0.62, topX = (R - topW) / 2;
  const barR = barH / 2;

  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const px = x + 0.5, py = y + 0.5;
      let r = 0, g = 0, b = 0, a = 0;
      if (insideRoundRect(px, py, 0, 0, R, R, bgRadius)) {
        const t = py / R;
        r = NAVY_TOP[0] + (NAVY_BOT[0] - NAVY_TOP[0]) * t;
        g = NAVY_TOP[1] + (NAVY_BOT[1] - NAVY_TOP[1]) * t;
        b = NAVY_TOP[2] + (NAVY_BOT[2] - NAVY_TOP[2]) * t;
        a = 255;
        if (insideRoundRect(px, py, botX, botY, botW, barH, barR) ||
            insideRoundRect(px, py, topX, topY, topW, barH, barR)) {
          [r, g, b] = ORANGE;
        }
      }
      const i = (y * R + x) * 4;
      sup[i] = r; sup[i + 1] = g; sup[i + 2] = b; sup[i + 3] = a;
    }
  }

  // Downsample SUPERxSUPER → 1, premultiplying by alpha so edges blend cleanly.
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SUPER; dy++) {
        for (let dx = 0; dx < SUPER; dx++) {
          const i = ((y * SUPER + dy) * R + (x * SUPER + dx)) * 4;
          const al = sup[i + 3];
          r += sup[i] * al; g += sup[i + 1] * al; b += sup[i + 2] * al; a += al;
        }
      }
      const oi = (y * size + x) * 4;
      if (a > 0) { out[oi] = Math.round(r / a); out[oi + 1] = Math.round(g / a); out[oi + 2] = Math.round(b / a); }
      out[oi + 3] = Math.round(a / (SUPER * SUPER));
    }
  }
  return out;
}

// ── minimal PNG encoder (RGBA, 8-bit) ───────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;  // 8-bit, RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x];
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(ICONS_DIR, `icon${size}.png`), encodePNG(size, renderIcon(size)));
  console.log(`wrote extension/icons/icon${size}.png`);
}
