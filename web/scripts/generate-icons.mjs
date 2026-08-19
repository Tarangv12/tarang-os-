/**
 * Generates the PWA icons as real PNG files with zero dependencies.
 *
 * A tiny PNG encoder (zlib + CRC32) is all that's needed, which keeps the
 * project installable offline and free of image-library supply-chain risk.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing ---------------------------------------------------------------

const FROM = [99, 102, 241]; // indigo-500
const TO = [124, 58, 237]; // violet-600

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Signed distance to a rounded rectangle — gives clean anti-aliased corners. */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

function coverage(sdf, softness = 0.75) {
  return Math.max(0, Math.min(1, 0.5 - sdf / (2 * softness)));
}

function blend(target, offset, rgb, alpha) {
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  target[offset] = Math.round(rgb[0] * alpha + target[offset] * inv);
  target[offset + 1] = Math.round(rgb[1] * alpha + target[offset + 1] * inv);
  target[offset + 2] = Math.round(rgb[2] * alpha + target[offset + 2] * inv);
  target[offset + 3] = Math.max(target[offset + 3], Math.round(255 * alpha));
}

/**
 * The TarangOS mark: a "T" formed by a horizontal bar and a vertical stem,
 * wrapped in a three-quarter progress ring — tasks plus progress in one glyph.
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const pad = maskable ? size * 0.14 : size * 0.055;
  const cx = size / 2;
  const cy = size / 2;
  const halfW = size / 2 - pad;
  const radius = maskable ? halfW : size * 0.235;

  // Background plate with a diagonal gradient.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sdf = roundedRectSdf(x + 0.5, y + 0.5, cx, cy, halfW, halfW, radius);
      const alpha = coverage(sdf, 1);
      if (alpha <= 0) continue;
      const t = (x / size) * 0.55 + (y / size) * 0.45;
      const rgb = mix(FROM, TO, Math.min(1, t));
      const offset = (y * size + x) * 4;
      blend(rgba, offset, rgb, alpha);
    }
  }

  const white = [255, 255, 255];
  const ringOuter = size * 0.325;
  const ringWidth = size * 0.052;
  const barHalfW = size * 0.135;
  const barHalfH = size * 0.032;
  const barY = cy - size * 0.115;
  const stemHalfW = size * 0.032;
  const stemTop = barY;
  const stemBottom = cy + size * 0.17;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const offset = (y * size + x) * 4;
      if (rgba[offset + 3] === 0) continue;

      // Progress ring with a gap at the top-right (a task still in flight).
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ringSdf = Math.abs(dist - ringOuter) - ringWidth / 2;
      let angle = Math.atan2(dy, dx); // -PI..PI, 0 = east
      if (angle < 0) angle += Math.PI * 2;
      const inGap = angle > Math.PI * 1.62 && angle < Math.PI * 1.98;
      if (!inGap) blend(rgba, offset, white, coverage(ringSdf, 0.8) * 0.92);

      // The "T".
      const barSdf = roundedRectSdf(px, py, cx, barY, barHalfW, barHalfH, barHalfH);
      const stemSdf = roundedRectSdf(
        px,
        py,
        cx,
        (stemTop + stemBottom) / 2,
        stemHalfW,
        (stemBottom - stemTop) / 2,
        stemHalfW,
      );
      blend(rgba, offset, white, coverage(Math.min(barSdf, stemSdf), 0.75));
    }
  }

  return encodePng(size, size, rgba);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-180.png', 180, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const png = drawIcon(size, options);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log(`\nIcons written to ${OUT_DIR}`);
