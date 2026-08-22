#!/usr/bin/env node
// Generates the bundled default puzzle images: low-poly triangle art, built
// as SVG then rasterized with rsvg-convert. Low-poly gives lots of small,
// distinctly-colored regions, which makes for a much more solvable jigsaw
// than a smooth photo gradient would (pieces from a flat sky are all
// identical). Seeded RNG so output is reproducible; rerun with:
//   node scripts/gen-images.mjs

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'images');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h, s, l) { return `hsl(${(h % 360 + 360) % 360},${s}%,${l}%)`; }

// Jittered-grid low-poly: each grid cell is split into two triangles by a
// random diagonal, with jittered corners so the grid isn't visible.
function lowPoly(seed, w, h, cols, rows, hueFn) {
  const rand = mulberry32(seed);
  const jitterX = w / cols * 0.4;
  const jitterY = h / rows * 0.4;
  const pt = (cx, cy) => [
    Math.max(0, Math.min(w, cx + (rand() - 0.5) * 2 * jitterX)),
    Math.max(0, Math.min(h, cy + (rand() - 0.5) * 2 * jitterY)),
  ];
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let c = 0; c <= cols; c++) {
      row.push(pt((c / cols) * w, (r / rows) * h));
    }
    grid.push(row);
  }
  const tris = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r][c], b = grid[r][c + 1], cc = grid[r + 1][c], d = grid[r + 1][c + 1];
      const cx = (c + 0.5) / cols, cy = (r + 0.5) / rows;
      if (rand() < 0.5) {
        tris.push([a, b, cc], [b, d, cc]);
      } else {
        tris.push([a, b, d], [a, d, cc]);
      }
      for (let i = 0; i < 2; i++) {
        const [h0, s0, l0] = hueFn(cx, cy, rand);
        tris[tris.length - 1 - i].color = hsl(h0, s0, l0);
      }
    }
  }
  let body = '';
  for (const t of tris) {
    // Stroke matches fill and overlaps slightly, closing the anti-aliasing
    // seams that appear between adjacent unstroked polygons (most visible
    // as dark slivers along the image's outer border).
    body += `<polygon points="${t.map((p) => p.join(',')).join(' ')}" fill="${t.color}" stroke="${t.color}" stroke-width="1.5" stroke-linejoin="round"/>\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="${w}" height="${h}" fill="${tris[0].color}"/>\n${body}</svg>\n`;
}

const W = 1200, H = 900;

const images = [
  {
    name: 'sunset-peaks',
    seed: 1001,
    hueFn: (x, y, rand) => {
      const h = 15 + y * 45 + (rand() - 0.5) * 14; // orange sky to violet ridges
      const s = 65 + (rand() - 0.5) * 15;
      const l = 78 - y * 45 + (rand() - 0.5) * 10;
      return [h, s, Math.max(12, Math.min(90, l))];
    },
  },
  {
    name: 'coral-reef',
    seed: 2002,
    hueFn: (x, y, rand) => {
      const h = 170 + Math.sin(x * 6 + y * 3) * 40 + (rand() - 0.5) * 20;
      const s = 55 + (rand() - 0.5) * 20;
      const l = 35 + (1 - y) * 35 + (rand() - 0.5) * 12;
      return [h, s, Math.max(10, Math.min(88, l))];
    },
  },
  {
    name: 'aurora-night',
    seed: 3003,
    hueFn: (x, y, rand) => {
      const band = Math.sin(x * 4 + y * 5) * 0.5 + 0.5;
      const h = 220 + band * 140 + (rand() - 0.5) * 16;
      const s = 60 + (rand() - 0.5) * 20;
      const l = 14 + band * 40 + (1 - y) * 10 + (rand() - 0.5) * 10;
      return [h, s, Math.max(6, Math.min(80, l))];
    },
  },
];

for (const img of images) {
  const svg = lowPoly(img.seed, W, H, 26, 20, img.hueFn);
  const svgPath = join(outDir, `${img.name}.svg`);
  const pngPath = join(outDir, `${img.name}.jpg`);
  writeFileSync(svgPath, svg);
  execFileSync('rsvg-convert', ['-w', String(W), '-h', String(H), '-o', pngPath.replace(/\.jpg$/, '.png'), svgPath]);
  execFileSync('magick', [pngPath.replace(/\.jpg$/, '.png'), '-quality', '87', pngPath]);
  execFileSync('rm', [pngPath.replace(/\.jpg$/, '.png')]);
  console.log(`generated images/${img.name}.jpg`);
}
