// Quick correctness check for the grid logic — not shipped to the app, dev-only.
import {
  DIFFICULTIES, createGrid, neighbors, computeAdjacents, placeMines,
  revealCell, chordReveal, toggleFlag, countFlags, checkWin, revealAllMines, cellIndex,
} from '../js/minesweeper.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof actual === 'object' && actual !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ---------- difficulties ----------
for (const [key, d] of Object.entries(DIFFICULTIES)) {
  check(`${key} mine count fits board`, d.mines < d.rows * d.cols, true);
}

// ---------- grid + neighbors ----------
const g9 = createGrid(3, 3);
check('createGrid size', g9.length, 9);
check('createGrid cells start hidden/unflagged/unmined', g9.every((c) => !c.mine && !c.revealed && !c.flagged && c.adjacent === 0), true);

check('corner neighbors (0,0) in 3x3', neighbors(0, 0, 3, 3).length, 3);
check('edge neighbors (0,1) in 3x3', neighbors(0, 1, 3, 3).length, 5);
check('center neighbors (1,1) in 3x3', neighbors(1, 1, 3, 3).length, 8);

// ---------- hand-built 3x3 board for deterministic flood-fill checks ----------
// Layout (M = mine):
//   M .  .
//   .  .  .
//   .  .  .
// Adjacency:
//   M  1  0
//   1  1  0
//   0  0  0
function board3x3WithCornerMine() {
  const grid = createGrid(3, 3);
  grid[cellIndex(0, 0, 3)].mine = true;
  computeAdjacents(grid, 3, 3);
  return grid;
}

{
  const grid = board3x3WithCornerMine();
  check('adjacent count next to mine', grid[cellIndex(0, 1, 3)].adjacent, 1);
  check('adjacent count diagonal to mine', grid[cellIndex(1, 1, 3)].adjacent, 1);
  check('adjacent count far from mine', grid[cellIndex(2, 2, 3)].adjacent, 0);
}

{
  // Revealing the far corner (0-adjacent) should cascade through every
  // 0-adjacent cell and stop at the numbered cells bordering the mine,
  // without ever touching the mine itself.
  const grid = board3x3WithCornerMine();
  const { hitMine, revealed } = revealCell(grid, 3, 3, 2, 2);
  check('cascade does not hit mine', hitMine, false);
  check('cascade reveals every non-mine cell', revealed.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  check('mine itself stays hidden after cascade', grid[cellIndex(0, 0, 3)].revealed, false);
}

{
  // Revealing the mine directly loses immediately, no cascade.
  const grid = board3x3WithCornerMine();
  const { hitMine, revealed } = revealCell(grid, 3, 3, 0, 0);
  check('direct mine reveal loses', hitMine, true);
  check('direct mine reveal touches only the mine', revealed, [cellIndex(0, 0, 3)]);
}

{
  // A flagged cell can't be revealed by a direct tap or by a flood fill
  // sweeping past it.
  const grid = board3x3WithCornerMine();
  toggleFlag(grid, 0, 1, 3);
  const { revealed } = revealCell(grid, 3, 3, 2, 2);
  check('flagged cell excluded from cascade', revealed.includes(cellIndex(0, 1, 3)), false);
  const direct = revealCell(grid, 3, 3, 0, 1);
  check('direct reveal of flagged cell is a no-op', direct.revealed.length, 0);
}

// ---------- flagging ----------
{
  const grid = createGrid(2, 2);
  check('flag an unrevealed cell', toggleFlag(grid, 0, 0, 2), true);
  check('unflag it again', toggleFlag(grid, 0, 0, 2), false);
  check('count flags', (() => { toggleFlag(grid, 0, 0, 2); toggleFlag(grid, 1, 1, 2); return countFlags(grid); })(), 2);
  grid[cellIndex(0, 1, 2)].revealed = true;
  check('cannot flag a revealed cell', toggleFlag(grid, 0, 1, 2), null);
}

// ---------- chording ----------
{
  // 3x3, mine at (0,0). Reveal (0,1) directly (adjacent=1), flag (0,0),
  // then chord on (0,1) should reveal its only remaining hidden neighbor,
  // (1,1) — without touching the flagged mine.
  const grid = board3x3WithCornerMine();
  revealCell(grid, 3, 3, 0, 1); // adjacent=1, does not cascade
  toggleFlag(grid, 0, 0, 3);
  const { hitMine, revealed } = chordReveal(grid, 3, 3, 0, 1);
  check('chord with correct flags does not hit mine', hitMine, false);
  check('chord reveals remaining hidden neighbor', revealed.includes(cellIndex(1, 1, 3)), true);
  check('chord leaves the flagged mine hidden', grid[cellIndex(0, 0, 3)].revealed, false);
}

{
  // Chording with the WRONG cell flagged is exactly as dangerous as a blind
  // click — this is standard Minesweeper behavior, not a bug.
  const grid = board3x3WithCornerMine();
  revealCell(grid, 3, 3, 0, 1);
  toggleFlag(grid, 1, 1, 3); // flag a safe cell instead of the real mine
  const { hitMine } = chordReveal(grid, 3, 3, 0, 1);
  check('chord with wrong flag can hit the mine', hitMine, true);
}

{
  // Chording on a cell whose flag count doesn't match its number does nothing.
  const grid = board3x3WithCornerMine();
  revealCell(grid, 3, 3, 0, 1); // adjacent=1, no flags placed
  const { revealed } = chordReveal(grid, 3, 3, 0, 1);
  check('chord with insufficient flags is a no-op', revealed.length, 0);
}

// ---------- win detection ----------
{
  const grid = board3x3WithCornerMine();
  check('not won at start', checkWin(grid), false);
  revealCell(grid, 3, 3, 2, 2); // reveals all 8 non-mine cells via cascade
  check('won once every non-mine cell is revealed', checkWin(grid), true);
}

{
  const grid = board3x3WithCornerMine();
  revealAllMines(grid);
  check('revealAllMines reveals the mine', grid[cellIndex(0, 0, 3)].revealed, true);
}

// ---------- placeMines: first-click safety + correct count, seeded RNG ----------
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

for (let trial = 0; trial < 20; trial++) {
  const { rows, cols, mines } = DIFFICULTIES.beginner;
  const grid = createGrid(rows, cols);
  const safeR = 4;
  const safeC = 4;
  placeMines(grid, rows, cols, mines, safeR, safeC, seededRng(trial + 1));

  const mineCount = grid.filter((c) => c.mine).length;
  if (mineCount !== mines) {
    failures++;
    console.log(`FAIL placeMines trial ${trial}: mine count ${mineCount} != ${mines}`);
  }
  const safeZone = [[safeR, safeC], ...neighbors(safeR, safeC, rows, cols)];
  const safeZoneClear = safeZone.every(([r, c]) => !grid[cellIndex(r, c, cols)].mine);
  if (!safeZoneClear) {
    failures++;
    console.log(`FAIL placeMines trial ${trial}: mine placed in first-click safe zone`);
  }
}
console.log('ok   20 placeMines trials: correct mine count and first-click safe zone clear');

// Adjacency sums are internally consistent: every mine's neighbors' adjacent
// counts add up to at least 1 contribution from that mine (spot check via
// full recompute equivalence).
{
  const { rows, cols, mines } = DIFFICULTIES.intermediate;
  const grid = createGrid(rows, cols);
  placeMines(grid, rows, cols, mines, 8, 8, seededRng(99));
  const before = grid.map((c) => c.adjacent);
  computeAdjacents(grid, rows, cols);
  const after = grid.map((c) => c.adjacent);
  check('computeAdjacents is idempotent', JSON.stringify(before), JSON.stringify(after));
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
