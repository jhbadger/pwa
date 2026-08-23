// Peg Solitaire: pure board logic — the classic 33-hole English cross
// board, orthogonal jump moves, win/stuck detection. No DOM here — keeps
// this testable from scripts/selftest.mjs without a browser.

export const SIZE = 7;

// The English cross: every cell is part of the board except the four 2x2
// corners. A cell qualifies if it's in the middle three rows OR the middle
// three columns (the two 3-wide arms plus the 7-wide waist).
export function isValidCell(r, c) {
  const inMidCols = c >= 2 && c <= 4;
  const inMidRows = r >= 2 && r <= 4;
  return inMidCols || inMidRows;
}

export function cellIndex(r, c) {
  return r * SIZE + c;
}

export function coordsOf(i) {
  return { r: Math.floor(i / SIZE), c: i % SIZE };
}

// Each cell holds 'peg', 'empty', or null (not part of the board at all).
export function createBoard() {
  const board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (isValidCell(r, c)) board[cellIndex(r, c)] = 'peg';
    }
  }
  board[cellIndex(3, 3)] = 'empty'; // the traditional starting gap
  return board;
}

const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Legal moves are always a straight two-cell jump: peg, adjacent peg to
// hop over, empty landing cell — diagonals don't count, matching the
// physical board (holes are only connected along rows/columns).
export function movesFrom(board, r, c) {
  if (board[cellIndex(r, c)] !== 'peg') return [];
  const moves = [];
  for (const [dr, dc] of DIRECTIONS) {
    const mr = r + dr;
    const mc = c + dc;
    const tr = r + 2 * dr;
    const tc = c + 2 * dc;
    if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) continue;
    if (board[cellIndex(mr, mc)] !== 'peg') continue;
    if (board[cellIndex(tr, tc)] !== 'empty') continue;
    moves.push({ from: cellIndex(r, c), over: cellIndex(mr, mc), to: cellIndex(tr, tc) });
  }
  return moves;
}

export function allLegalMoves(board) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[cellIndex(r, c)] === 'peg') moves.push(...movesFrom(board, r, c));
    }
  }
  return moves;
}

export function applyMove(board, move) {
  const next = board.slice();
  next[move.from] = 'empty';
  next[move.over] = 'empty';
  next[move.to] = 'peg';
  return next;
}

export function pegCount(board) {
  return board.reduce((n, cell) => n + (cell === 'peg' ? 1 : 0), 0);
}

// The traditional goal is "down to one peg"; landing that last peg in the
// center hole is the harder "perfect" finish, distinguished by isCenterWin.
export function isSolved(board) {
  return pegCount(board) === 1;
}

export function isCenterWin(board) {
  return isSolved(board) && board[cellIndex(3, 3)] === 'peg';
}

export function isStuck(board) {
  return !isSolved(board) && allLegalMoves(board).length === 0;
}
