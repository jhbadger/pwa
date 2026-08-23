// Mahjong Solitaire ("Shanghai") board and matching rules. Pure logic, no DOM —
// keeps this testable from scripts/selftest.mjs without a browser.
//
// Tiles are the standard 144-tile mahjong set (34 types × 4, + 8 unique bonus
// tiles) laid out in a 5-layer stepped pyramid. Board coordinates are integers
// on a "doubled" grid: same-layer neighbors are 2 apart, so a tile's footprint
// is the open interval (x-1, x+1) — this keeps every adjacency/overlap test
// exact-integer, no floating point.
//
// A tile is FREE (selectable) when nothing sits on top of it and at least one
// long (left/right) side has no same-layer neighbor — the standard Shanghai/
// Mahjong Solitaire rule.

// ---------- tile types ----------

const SUITS = [
  { key: 'wan', name: 'Characters', base: 0x1F007 }, // 1F007..1F00F = 1..9
  { key: 'bam', name: 'Bamboo', base: 0x1F010 },      // 1F010..1F018 = 1..9
  { key: 'dot', name: 'Circles', base: 0x1F019 },     // 1F019..1F021 = 1..9
];

const WINDS = [
  { key: 'we', name: 'East Wind', cp: 0x1F000 },
  { key: 'ws', name: 'South Wind', cp: 0x1F001 },
  { key: 'ww', name: 'West Wind', cp: 0x1F002 },
  { key: 'wn', name: 'North Wind', cp: 0x1F003 },
];

const DRAGONS = [
  { key: 'dr', name: 'Red Dragon', cp: 0x1F004 },
  { key: 'dg', name: 'Green Dragon', cp: 0x1F005 },
  { key: 'dw', name: 'White Dragon', cp: 0x1F006 },
];

const FLOWERS = [
  { key: 'f1', name: 'Plum', cp: 0x1F022 },
  { key: 'f2', name: 'Orchid', cp: 0x1F023 },
  { key: 'f3', name: 'Bamboo Flower', cp: 0x1F024 },
  { key: 'f4', name: 'Chrysanthemum', cp: 0x1F025 },
];

const SEASONS = [
  { key: 's1', name: 'Spring', cp: 0x1F026 },
  { key: 's2', name: 'Summer', cp: 0x1F027 },
  { key: 's3', name: 'Autumn', cp: 0x1F028 },
  { key: 's4', name: 'Winter', cp: 0x1F029 },
];

export const TILE_TYPES = [];
for (const suit of SUITS) {
  for (let n = 1; n <= 9; n++) {
    TILE_TYPES.push({
      id: `${suit.key}${n}`,
      glyph: String.fromCodePoint(suit.base + n - 1),
      category: 'standard',
      name: `${suit.name} ${n}`,
      count: 4,
    });
  }
}
for (const w of WINDS) {
  TILE_TYPES.push({ id: w.key, glyph: String.fromCodePoint(w.cp), category: 'standard', name: w.name, count: 4 });
}
for (const d of DRAGONS) {
  TILE_TYPES.push({ id: d.key, glyph: String.fromCodePoint(d.cp), category: 'standard', name: d.name, count: 4 });
}
for (const f of FLOWERS) {
  TILE_TYPES.push({ id: f.key, glyph: String.fromCodePoint(f.cp), category: 'flower', name: f.name, count: 1 });
}
for (const s of SEASONS) {
  TILE_TYPES.push({ id: s.key, glyph: String.fromCodePoint(s.cp), category: 'season', name: s.name, count: 1 });
}

export const TYPE_BY_ID = Object.fromEntries(TILE_TYPES.map((t) => [t.id, t]));

// ---------- board layout ----------

// Column/row counts per layer, widest (bottom) first. Every value is even and
// each layer is no wider/taller than the one below, so centering both axes on
// zero places every upper-layer slot exactly on top of a lower-layer slot —
// no fractional offsets, no alignment guesswork. Total slots must equal the
// deck size (144); scripts/selftest.mjs asserts this.
const LAYER_SPECS = [
  { cols: 6, rows: 14 },
  { cols: 4, rows: 8 },
  { cols: 4, rows: 4 },
  { cols: 2, rows: 4 },
  { cols: 2, rows: 2 },
];

export function buildLayout() {
  const positions = [];
  LAYER_SPECS.forEach((spec, layer) => {
    for (let row = 0; row < spec.rows; row++) {
      const y = 2 * row - (spec.rows - 1);
      for (let col = 0; col < spec.cols; col++) {
        const x = 2 * col - (spec.cols - 1);
        positions.push({ layer, x, y });
      }
    }
  });
  return positions;
}

export const LAYER_COUNT = LAYER_SPECS.length;

// ---------- deck ----------

export function buildDeck() {
  const deck = [];
  for (const t of TILE_TYPES) {
    for (let i = 0; i < t.count; i++) deck.push(t.id);
  }
  return deck;
}

// Fisher-Yates. rng defaults to Math.random but is injectable for tests.
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- dealing ----------

export function buildIndex(tiles) {
  const map = new Map();
  for (const t of tiles) map.set(`${t.layer}|${t.x}|${t.y}`, t);
  return map;
}

export function dealNewGame(rng = Math.random) {
  const positions = buildLayout();
  const deck = shuffle(buildDeck(), rng);
  const tiles = positions.map((pos, i) => ({
    id: i, layer: pos.layer, x: pos.x, y: pos.y, typeId: deck[i], removed: false,
  }));
  return { tiles, index: buildIndex(tiles) };
}

// ---------- free-tile rules ----------

function liveTileAt(index, layer, x, y) {
  const t = index.get(`${layer}|${x}|${y}`);
  return t && !t.removed ? t : null;
}

export function isCapped(index, tile) {
  for (let layer = tile.layer + 1; layer < LAYER_COUNT; layer++) {
    if (liveTileAt(index, layer, tile.x, tile.y)) return true;
  }
  return false;
}

export function isLeftOpen(index, tile) {
  return !liveTileAt(index, tile.layer, tile.x - 2, tile.y);
}

export function isRightOpen(index, tile) {
  return !liveTileAt(index, tile.layer, tile.x + 2, tile.y);
}

export function isFree(index, tile) {
  if (tile.removed) return false;
  if (isCapped(index, tile)) return false;
  return isLeftOpen(index, tile) || isRightOpen(index, tile);
}

// ---------- matching ----------

export function canMatch(a, b) {
  if (a.id === b.id || a.removed || b.removed) return false;
  if (a.typeId === b.typeId) return true;
  const catA = TYPE_BY_ID[a.typeId].category;
  const catB = TYPE_BY_ID[b.typeId].category;
  return (catA === 'flower' && catB === 'flower') || (catA === 'season' && catB === 'season');
}

export function findFreeTiles(tiles, index) {
  return tiles.filter((t) => isFree(index, t));
}

export function findValidPair(tiles, index) {
  const free = findFreeTiles(tiles, index);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (canMatch(free[i], free[j])) return [free[i], free[j]];
    }
  }
  return null;
}

export function hasAnyMove(tiles, index) {
  return findValidPair(tiles, index) !== null;
}

// Redistributes tile types among still-in-play tiles (positions untouched) and
// retries until a valid move exists. With exactly two tiles left this can't
// possibly help — two unlike tiles stay unlike no matter how you shuffle two
// slots — so it gives up immediately and lets the caller report a dead end.
export function reshuffleRemaining(tiles, index, rng = Math.random) {
  const remaining = tiles.filter((t) => !t.removed);
  if (remaining.length <= 2) return hasAnyMove(tiles, index);
  const typeIds = remaining.map((t) => t.typeId);
  for (let attempt = 0; attempt < 300; attempt++) {
    shuffle(typeIds, rng);
    remaining.forEach((t, i) => { t.typeId = typeIds[i]; });
    if (hasAnyMove(tiles, index)) return true;
  }
  return hasAnyMove(tiles, index);
}
