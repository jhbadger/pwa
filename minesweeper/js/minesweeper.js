// Minesweeper: pure grid logic — generation, first-click-safe mine
// placement, flood-fill reveal, flagging, chording, and win detection.
// No DOM here — keeps this testable from scripts/selftest.mjs without a
// browser.

export const DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mines: 10, label: 'Beginner' },
  intermediate: { rows: 16, cols: 16, mines: 40, label: 'Intermediate' },
  expert: { rows: 16, cols: 30, mines: 99, label: 'Expert' },
};

export function cellIndex(r, c, cols) {
  return r * cols + c;
}

export function createGrid(rows, cols) {
  return Array.from({ length: rows * cols }, () => ({
    mine: false, revealed: false, flagged: false, adjacent: 0,
  }));
}

export function neighbors(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
    }
  }
  return out;
}

// Fills in each non-mine cell's adjacent-mine count. Exported separately
// from placeMines so tests can hand-construct a mine layout (no RNG) and
// still get correct adjacency for exercising revealCell/chordReveal.
export function computeAdjacents(grid, rows, cols) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[cellIndex(r, c, cols)];
      if (cell.mine) continue;
      cell.adjacent = neighbors(r, c, rows, cols)
        .filter(([nr, nc]) => grid[cellIndex(nr, nc, cols)].mine).length;
    }
  }
}

// Places `mineCount` mines, never on (safeR, safeC) or its neighbors, so the
// very first reveal of a game can never be a mine — and usually opens up a
// clear area, matching how every modern Minesweeper implementation treats
// the first click.
export function placeMines(grid, rows, cols, mineCount, safeR, safeC, rng = Math.random) {
  const excluded = new Set([
    cellIndex(safeR, safeC, cols),
    ...neighbors(safeR, safeC, rows, cols).map(([r, c]) => cellIndex(r, c, cols)),
  ]);
  const candidates = [];
  for (let i = 0; i < grid.length; i++) if (!excluded.has(i)) candidates.push(i);

  // Fisher-Yates.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const count = Math.min(mineCount, candidates.length);
  for (let i = 0; i < count; i++) grid[candidates[i]].mine = true;

  computeAdjacents(grid, rows, cols);
}

// Reveals (r,c). If it lands on a 0-adjacent cell, flood-fills outward
// through other 0-adjacent cells, revealing their bordering numbered cells
// too (the classic "open area" cascade) without crossing past them. Flagged
// cells are never revealed by the flood — they have to be unflagged first.
// Returns { hitMine, revealed: [index, ...] }.
export function revealCell(grid, rows, cols, r, c) {
  const start = cellIndex(r, c, cols);
  const startCell = grid[start];
  if (startCell.revealed || startCell.flagged) return { hitMine: false, revealed: [] };

  if (startCell.mine) {
    startCell.revealed = true;
    return { hitMine: true, revealed: [start] };
  }

  const revealed = [];
  const seen = new Set();
  const stack = [[r, c]];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    const i = cellIndex(cr, cc, cols);
    if (seen.has(i)) continue;
    seen.add(i);
    const cur = grid[i];
    if (cur.revealed || cur.flagged || cur.mine) continue;
    cur.revealed = true;
    revealed.push(i);
    if (cur.adjacent === 0) {
      for (const [nr, nc] of neighbors(cr, cc, rows, cols)) stack.push([nr, nc]);
    }
  }
  return { hitMine: false, revealed };
}

// "Chording": tapping an already-revealed numbered cell whose adjacent-flag
// count matches its number reveals all of its remaining unflagged
// neighbors at once. A wrong flag makes this exactly as dangerous as
// clicking blind — that's standard Minesweeper behavior, not a bug.
export function chordReveal(grid, rows, cols, r, c) {
  const cell = grid[cellIndex(r, c, cols)];
  if (!cell.revealed || cell.mine || cell.adjacent === 0) return { hitMine: false, revealed: [] };

  const nbs = neighbors(r, c, rows, cols);
  const flagCount = nbs.filter(([nr, nc]) => grid[cellIndex(nr, nc, cols)].flagged).length;
  if (flagCount !== cell.adjacent) return { hitMine: false, revealed: [] };

  let hitMine = false;
  const revealed = [];
  for (const [nr, nc] of nbs) {
    const n = grid[cellIndex(nr, nc, cols)];
    if (n.revealed || n.flagged) continue;
    const res = revealCell(grid, rows, cols, nr, nc);
    revealed.push(...res.revealed);
    if (res.hitMine) hitMine = true;
  }
  return { hitMine, revealed };
}

// Returns the new flagged state, or null if the cell can't be flagged
// (already revealed).
export function toggleFlag(grid, r, c, cols) {
  const cell = grid[cellIndex(r, c, cols)];
  if (cell.revealed) return null;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}

export function countFlags(grid) {
  return grid.reduce((n, cell) => n + (cell.flagged ? 1 : 0), 0);
}

// Win condition is "every non-mine cell revealed" — flagging every mine is
// not required, matching standard Minesweeper rules.
export function checkWin(grid) {
  return grid.every((cell) => cell.mine || cell.revealed);
}

export function revealAllMines(grid) {
  for (const cell of grid) if (cell.mine) cell.revealed = true;
}
