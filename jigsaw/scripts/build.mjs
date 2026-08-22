#!/usr/bin/env node
// Stamps sw.js's CACHE_NAME with a hash of every precached file's contents (plus
// sw.js's own fetch/install/activate logic), so any real change — a script edit,
// an HTML tweak, a new icon — bumps the service worker version and triggers an update.
// Run this after editing any precached file, before deploying:
//   node scripts/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const swPath = join(root, 'sw.js');
const swSource = readFileSync(swPath, 'utf8');

const match = swSource.match(/const PRECACHE = (\[[\s\S]*?\]);/);
if (!match) {
  console.error('Could not find PRECACHE array in sw.js');
  process.exit(1);
}
const precache = JSON.parse(match[1].replace(/'/g, '"').replace(/,(\s*])/g, '$1'));

const hash = createHash('sha256');
// Hash sw.js's own logic (everything except the VERSION line) so a change to the
// fetch/cache strategy itself also counts as a new version.
hash.update(swSource.replace(/const VERSION = '[^']*';/, "const VERSION = '';"));

for (const entry of precache) {
  const rel = entry === './' ? 'index.html' : entry;
  const filePath = join(root, rel);
  hash.update(rel);
  hash.update(readFileSync(filePath));
}

const version = hash.digest('hex').slice(0, 12);
const updated = swSource.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
writeFileSync(swPath, updated);
console.log(`sw.js VERSION -> ${version}`);
