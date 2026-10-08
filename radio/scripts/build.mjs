#!/usr/bin/env node
// Generate icons then stamp sw.js with a hash of all precached files.
// Run after editing any precached file: node scripts/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash }                  from 'node:crypto';
import { spawnSync }                   from 'node:child_process';
import { fileURLToPath }               from 'node:url';
import { dirname, join }               from 'node:path';

const root   = dirname(dirname(fileURLToPath(import.meta.url)));
const swPath = join(root, 'sw.js');

// Generate icons via Python (no npm deps needed)
console.log('Generating icons…');
const py = spawnSync('python3', ['scripts/gen-icons.py'], { cwd: root, stdio: 'inherit' });
if (py.status !== 0) {
  console.error('Icon generation failed. Make sure python3 is available.');
  process.exit(1);
}

// Hash all precached files + sw.js logic to get a stable VERSION string
const swSource = readFileSync(swPath, 'utf8');
const match    = swSource.match(/const PRECACHE = (\[[\s\S]*?\]);/);
if (!match) { console.error('Cannot find PRECACHE in sw.js'); process.exit(1); }

const precache = JSON.parse(match[1].replace(/'/g, '"').replace(/,(\s*])/g, '$1'));
const hash     = createHash('sha256');
hash.update(swSource.replace(/const VERSION = '[^']*';/, "const VERSION = '';"));

for (const entry of precache) {
  const rel = entry === './' ? 'index.html' : entry;
  hash.update(rel);
  hash.update(readFileSync(join(root, rel)));
}

const version = hash.digest('hex').slice(0, 12);
const updated = swSource.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
writeFileSync(swPath, updated);
console.log(`sw.js VERSION → ${version}`);
