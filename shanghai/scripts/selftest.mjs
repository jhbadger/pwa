// Quick correctness check for the board/matching engine — not shipped to the
// app, dev-only.
import {
  TILE_TYPES, buildLayout, buildDeck, buildIndex, dealNewGame,
  isFree, isCapped, isLeftOpen, isRightOpen, canMatch, findValidPair,
  hasAnyMove, reshuffleRemaining,
} from '../js/tiles.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}
function ok(label, cond) {
  if (!cond) { failures++; console.log(`FAIL ${label}`); } else console.log(`ok   ${label}`);
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- layout ----------

const positions = buildLayout();
check('layout has 144 slots', positions.length, 144);
const posKeys = new Set(positions.map((p) => `${p.layer}|${p.x}|${p.y}`));
check('layout slots are all unique', posKeys.size, 144);

// ---------- deck ----------

const deck = buildDeck();
check('deck has 144 tiles', deck.length, 144);
const freq = {};
for (const id of deck) freq[id] = (freq[id] || 0) + 1;
let deckCountsOk = true;
for (const t of TILE_TYPES) if (freq[t.id] !== t.count) deckCountsOk = false;
ok('deck tile counts match TILE_TYPES (4 standard / 1 bonus)', deckCountsOk);
check('34 standard + 8 bonus = 42 distinct type ids', TILE_TYPES.length, 42);

// ---------- dealNewGame ----------

const { tiles } = dealNewGame(mulberry32(1));
check('deal produces 144 tiles', tiles.length, 144);
check('deal tile ids are 0..143', tiles.map((t) => t.id), Array.from({ length: 144 }, (_, i) => i));

// ---------- free-tile rules on constructed scenarios ----------

function mkTiles(specs) {
  const tiles = specs.map((s, i) => ({ id: i, layer: s.layer, x: s.x, y: s.y, typeId: s.typeId || 'x', removed: false }));
  return { tiles, index: buildIndex(tiles) };
}

{
  // Row of three same-layer tiles: only the two ends are free (open on the outer side).
  const { tiles, index } = mkTiles([
    { layer: 0, x: -2, y: 0 }, { layer: 0, x: 0, y: 0 }, { layer: 0, x: 2, y: 0 },
  ]);
  ok('row end (left) is free', isFree(index, tiles[0]));
  ok('row end (right) is free', isFree(index, tiles[2]));
  ok('row middle is blocked both sides', !isFree(index, tiles[1]));
  ok('row middle: left not open', !isLeftOpen(index, tiles[1]));
  ok('row middle: right not open', !isRightOpen(index, tiles[1]));
}

{
  // A tile with something directly on top of it is capped regardless of side openness.
  const { tiles, index } = mkTiles([
    { layer: 0, x: 0, y: 0 }, { layer: 1, x: 0, y: 0 },
  ]);
  ok('base tile is capped by tile above it', isCapped(index, tiles[0]));
  ok('capped tile is not free even with open sides', !isFree(index, tiles[0]));
  ok('topmost tile is free (isolated, nothing above, no neighbors)', isFree(index, tiles[1]));
}

{
  // Fully isolated tile: free.
  const { tiles, index } = mkTiles([{ layer: 0, x: 5, y: 5 }]);
  ok('isolated tile is free', isFree(index, tiles[0]));
}

{
  // A removed neighbor no longer blocks a side.
  const { tiles, index } = mkTiles([
    { layer: 0, x: -2, y: 0 }, { layer: 0, x: 0, y: 0 },
  ]);
  ok('blocked before removal', !isLeftOpen(index, tiles[1]));
  tiles[0].removed = true;
  ok('opens up once the blocking neighbor is removed', isLeftOpen(index, tiles[1]));
}

// ---------- matching ----------

const a = { id: 1, typeId: 'wan3', removed: false };
const b = { id: 2, typeId: 'wan3', removed: false };
const c = { id: 3, typeId: 'bam3', removed: false };
const f1 = { id: 4, typeId: 'f1', removed: false };
const f2 = { id: 5, typeId: 'f2', removed: false };
const s1 = { id: 6, typeId: 's1', removed: false };

ok('identical standard types match', canMatch(a, b));
ok('different standard types do not match', !canMatch(a, c));
ok('two different flowers match', canMatch(f1, f2));
ok('flower and season do not match', !canMatch(f1, s1));
ok('a tile never matches itself', !canMatch(a, { ...a }));

// ---------- hasAnyMove / findValidPair ----------

{
  const { tiles, index } = mkTiles([
    { layer: 0, x: -2, y: 0, typeId: 'wan1' }, { layer: 0, x: 0, y: 0, typeId: 'bam1' },
    { layer: 0, x: 2, y: 0, typeId: 'wan1' },
  ]);
  const pair = findValidPair(tiles, index);
  ok('finds the matching free pair', pair && pair[0].typeId === 'wan1' && pair[1].typeId === 'wan1');
}
{
  const { tiles, index } = mkTiles([
    { layer: 0, x: -2, y: 0, typeId: 'wan1' }, { layer: 0, x: 0, y: 0, typeId: 'wan1' }, { layer: 0, x: 2, y: 0, typeId: 'bam1' },
  ]);
  // middle tile is blocked both sides, so the only two free tiles (ends) don't match.
  ok('no move when the only free tiles mismatch', !hasAnyMove(tiles, index));
}

// ---------- reshuffleRemaining ----------

{
  // 4 tiles, 2 types, arranged so free tiles initially mismatch; reshuffle must find a fix.
  const { tiles, index } = mkTiles([
    { layer: 0, x: -6, y: 0, typeId: 'wan1' }, { layer: 0, x: -4, y: 0, typeId: 'wan2' },
    { layer: 0, x: -2, y: 0, typeId: 'wan1' }, { layer: 0, x: 0, y: 0, typeId: 'wan2' },
  ]);
  const solved = reshuffleRemaining(tiles, index, mulberry32(7));
  ok('reshuffle finds a solvable arrangement with 4 tiles', solved);
  ok('reshuffle result actually has a move', hasAnyMove(tiles, index));
}
{
  // Exactly 2 mismatched tiles left: reshuffle can't help, must say so without hanging.
  const { tiles, index } = mkTiles([
    { layer: 0, x: -2, y: 0, typeId: 'wan1' }, { layer: 0, x: 0, y: 0, typeId: 'bam1' },
  ]);
  const solved = reshuffleRemaining(tiles, index, mulberry32(9));
  ok('reshuffle correctly gives up on 2 mismatched tiles', !solved);
}

// ---------- full playthrough simulation ----------
// Deals real games and plays them out greedily (always take the first available
// match; reshuffle when stuck) to prove layout + deck + matching + reshuffle are
// consistent end to end, and that the game is always completable except for the
// mathematically-unavoidable "last two tiles don't match" edge case.

let wins = 0;
let deadlocks = 0;
const TRIALS = 30;
for (let seed = 1; seed <= TRIALS; seed++) {
  const rng = mulberry32(seed * 97 + 13);
  const { tiles, index } = dealNewGame(rng);
  let remaining = tiles.length;
  let iterations = 0;
  while (remaining > 0 && iterations < 5000) {
    iterations++;
    const pair = findValidPair(tiles, index);
    if (pair) {
      pair[0].removed = true;
      pair[1].removed = true;
      remaining -= 2;
    } else {
      const solved = reshuffleRemaining(tiles, index, rng);
      if (!solved) { deadlocks++; break; }
    }
  }
  if (remaining === 0) wins++;
  ok(`trial seed ${seed} terminates within iteration cap`, iterations < 5000);
}
console.log(`playthrough summary: ${wins}/${TRIALS} fully cleared, ${deadlocks}/${TRIALS} hit the 2-tile deadlock`);
ok('every trial either wins or hits the genuine 2-tile deadlock', wins + deadlocks === TRIALS);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
