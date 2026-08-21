#!/usr/bin/env node
// Rasterizes the Keepsake brand mark into the app icon PNGs.
//
// Written by hand rather than pulling in a rasterizer: the mark is a
// five-vertex polygon on a flat field, with no gradients, curves or
// texture, so the whole job is a point-in-polygon fill plus a PNG
// container. That is a much smaller thing to own than a native image
// dependency, and it means the icons can be regenerated at any size
// later without one. Node's own zlib does the compression.
//
// Source: design handoff "Keepsake Icon System" (docs/design/
// keepsake-icon-system/). The mark is viewBox 0 0 38 48, path
// "M0 0h38v48L19 36.4 0 48z"; the app-icon section renders it 38 tall
// inside a 96 tile, in the ink colorway by default.
//
// Usage: node scripts/generate-app-icon.mjs
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const INK = [0x21, 0x1d, 0x18];
const PAPER = [0xf7, 0xf3, 0xec];

// Ink field, paper mark (developer decision, 2026-08-20). The handoff
// also specifies ember-on-paper and paper-on-ink colorways.
const FIELD = INK;
const MARK = PAPER;

// The mark's own coordinate space, straight from the path data.
const MARK_VIEWBOX = { width: 38, height: 48 };
const MARK_POLYGON = [
  [0, 0],
  [38, 0],
  [38, 48],
  [19, 36.4],
  [0, 48],
];

// 38 tall in a 96 tile. Width follows from the mark's own aspect rather
// than the handoff's rounded 30px, which squashes it by a third of a
// percent at that size.
const MARK_HEIGHT_RATIO = 38 / 96;

// 4x4 per pixel. The mark's only non-axis-aligned edges are the two
// forming the notch, so this is enough to keep them from stairstepping
// without making a 1024px render slow.
const SUPERSAMPLE = 4;

function isInside(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function renderIcon(size) {
  const markHeight = size * MARK_HEIGHT_RATIO;
  const markWidth = (markHeight * MARK_VIEWBOX.width) / MARK_VIEWBOX.height;
  const offsetX = (size - markWidth) / 2;
  const offsetY = (size - markHeight) / 2;

  // The polygon mapped from mark space into pixel space, once.
  const polygon = MARK_POLYGON.map(([x, y]) => [
    offsetX + (x / MARK_VIEWBOX.width) * markWidth,
    offsetY + (y / MARK_VIEWBOX.height) * markHeight,
  ]);

  const step = 1 / SUPERSAMPLE;
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;
  // One filter byte (0 = none) per scanline, then RGB triples. No alpha:
  // iOS rejects app icons that carry an alpha channel.
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(stride * size);

  for (let py = 0; py < size; py += 1) {
    const rowStart = py * stride;
    raw[rowStart] = 0;
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const y = py + (sy + 0.5) * step;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          if (isInside(polygon, px + (sx + 0.5) * step, y)) hits += 1;
        }
      }
      const coverage = hits / samplesPerPixel;
      const at = rowStart + 1 + px * 3;
      for (let c = 0; c < 3; c += 1) {
        raw[at + c] = Math.round(FIELD[c] + (MARK[c] - FIELD[c]) * coverage);
      }
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function toPng(raw, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
for (const [name, size] of [
  ['icon.png', 1024],
  ['favicon.png', 48],
]) {
  const target = join(assets, name);
  writeFileSync(target, toPng(renderIcon(size), size));
  console.log(`wrote ${name} (${size}x${size})`);
}
