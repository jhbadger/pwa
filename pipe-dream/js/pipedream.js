// Pipe Dream: pure board/flow logic — a queue of pipe pieces you place
// ahead of the water, which starts flowing from a fixed source after a
// countdown and races through whatever's connected. No DOM here — keeps
// this testable from scripts/selftest.mjs without a browser.

export const ROWS = 9;
export const COLS = 6;

export function cellIndex(r, c) {
  return r * COLS + c;
}

export function coordsOf(i) {
  return { r: Math.floor(i / COLS), c: i % COLS };
}

export const DIR_DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Every placeable piece connects exactly two of the four sides — a straight
// run or a quarter-turn. That's the whole piece set, same as the classic
// game: no crossings, no branches, no dead-end caps.
export const PIECES = {
  NS: ['N', 'S'],
  EW: ['E', 'W'],
  NE: ['N', 'E'],
  NW: ['N', 'W'],
  SE: ['S', 'E'],
  SW: ['S', 'W'],
};

export const PIECE_TYPES = Object.keys(PIECES);

// The water tap: fixed near the top of the board, always pointing south
// into it. Not a placeable piece — it's part of the board from the start.
export const SOURCE_R = 0;
export const SOURCE_C = 2;
export const SOURCE_INDEX = cellIndex(SOURCE_R, SOURCE_C);
export const SOURCE_DIR = 'S';

export function createInitialBoard() {
  const board = new Array(ROWS * COLS).fill(null);
  board[SOURCE_INDEX] = { type: 'SOURCE' };
  return board;
}

export function randomPieceType(rng = Math.random) {
  return PIECE_TYPES[Math.floor(rng() * PIECE_TYPES.length)];
}

export function createQueue(length, rng = Math.random) {
  return Array.from({ length }, () => randomPieceType(rng));
}

export function canPlace(board, index) {
  return index >= 0 && index < board.length && board[index] === null;
}

// Returns a new board with `type` placed at `index`, or null if the cell
// isn't placeable (occupied, or the fixed source).
export function placePiece(board, index, type) {
  if (!canPlace(board, index)) return null;
  const next = board.slice();
  next[index] = { type };
  return next;
}

// Initial flow state: water is "at" the source, about to exit in its fixed
// direction. Advancing from here is exactly the same operation as every
// later step, so the source needs no special-casing anywhere else.
export function initialFlowState() {
  return { r: SOURCE_R, c: SOURCE_C, dir: SOURCE_DIR };
}

// Advances the flow by one cell. On success, returns the new flow state
// plus the index just entered (for scoring/rendering). On failure —
// running off the board, or into an empty or wrongly-oriented cell — the
// water has nowhere to go: that's the leak that ends the game, not an
// error to guard against upstream.
export function stepFlow(board, state) {
  const [dr, dc] = DIR_DELTA[state.dir];
  const nr = state.r + dr;
  const nc = state.c + dc;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return { leak: true };

  const i = cellIndex(nr, nc);
  const cell = board[i];
  if (!cell || cell.type === 'SOURCE') return { leak: true };

  const connectors = PIECES[cell.type];
  const incoming = OPPOSITE[state.dir];
  if (!connectors.includes(incoming)) return { leak: true };

  const outgoing = connectors.find((d) => d !== incoming);
  return { leak: false, index: i, state: { r: nr, c: nc, dir: outgoing } };
}
