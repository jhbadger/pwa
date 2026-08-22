// Gardner's Minichess engine — 5x5 board, files a-e (0-4), ranks 1-5 (0-4).
// Row 0 = rank 1 (white back rank, bottom of screen), row 4 = rank 5 (black back rank, top).
// Back rank order (both colors, files a-e): Rook, Knight, Bishop, Queen, King —
// so the queens face each other on the d-file and the kings face each other on the e-file.
// Rules: no castling, no en passant, pawns move one square only (no double push),
// pawns auto-promote to queen on reaching the far rank.

export const SIZE = 5;
export const WHITE = 'w';
export const BLACK = 'b';

const BACK_RANK = ['R', 'N', 'B', 'Q', 'K'];

export function createInitialBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let c = 0; c < SIZE; c++) {
    board[0][c] = { type: BACK_RANK[c], color: WHITE };
    board[1][c] = { type: 'P', color: WHITE };
    board[3][c] = { type: 'P', color: BLACK };
    board[4][c] = { type: BACK_RANK[c], color: BLACK };
  }
  return board;
}

export function cloneBoard(board) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)));
}

export function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function other(color) {
  return color === WHITE ? BLACK : WHITE;
}

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);
const KNIGHT_DIRS = [
  [1, 2], [2, 1], [-1, 2], [-2, 1],
  [1, -2], [2, -1], [-1, -2], [-2, -1],
];

// Pseudo-legal moves for the piece at (r,c); does not check for leaving own king in check.
function pseudoMovesFor(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  const add = (tr, tc, extra) => {
    if (!inBounds(tr, tc)) return;
    const target = board[tr][tc];
    if (target && target.color === piece.color) return;
    moves.push({ fr: r, fc: c, tr, tc, capture: !!target, ...extra });
  };

  if (piece.type === 'P') {
    const dir = piece.color === WHITE ? 1 : -1;
    const startFwd = r + dir;
    if (inBounds(startFwd, c) && !board[startFwd][c]) {
      add(startFwd, c, {});
    }
    for (const dc of [-1, 1]) {
      const tr = r + dir;
      const tc = c + dc;
      if (inBounds(tr, tc) && board[tr][tc] && board[tr][tc].color !== piece.color) {
        add(tr, tc, {});
      }
    }
  } else if (piece.type === 'N') {
    for (const [dr, dc] of KNIGHT_DIRS) add(r + dr, c + dc, {});
  } else if (piece.type === 'K') {
    for (const [dr, dc] of KING_DIRS) add(r + dr, c + dc, {});
  } else {
    const dirs = piece.type === 'R' ? ROOK_DIRS : piece.type === 'B' ? BISHOP_DIRS : KING_DIRS;
    for (const [dr, dc] of dirs) {
      let tr = r + dr;
      let tc = c + dc;
      while (inBounds(tr, tc)) {
        const target = board[tr][tc];
        if (target && target.color === piece.color) break;
        moves.push({ fr: r, fc: c, tr, tc, capture: !!target });
        if (target) break;
        tr += dr;
        tc += dc;
      }
    }
  }

  // Mark promotions (pawn reaching far rank), auto-queen.
  if (piece.type === 'P') {
    const farRank = piece.color === WHITE ? SIZE - 1 : 0;
    for (const m of moves) {
      if (m.tr === farRank) m.promotion = 'Q';
    }
  }
  return moves;
}

export function findKing(board, color) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.type === 'K' && p.color === color) return { r, c };
    }
  }
  return null;
}

// True if square (r,c) is attacked by any piece of `byColor`.
export function isAttacked(board, r, c, byColor) {
  for (const [dr, dc] of KNIGHT_DIRS) {
    const p = inBounds(r + dr, c + dc) ? board[r + dr][c + dc] : null;
    if (p && p.color === byColor && p.type === 'N') return true;
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let tr = r + dr, tc = c + dc;
    while (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p.color === byColor && (p.type === 'R' || p.type === 'Q')) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let tr = r + dr, tc = c + dc;
    while (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p.color === byColor && (p.type === 'B' || p.type === 'Q')) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  for (const [dr, dc] of KING_DIRS) {
    const p = inBounds(r + dr, c + dc) ? board[r + dr][c + dc] : null;
    if (p && p.color === byColor && p.type === 'K') return true;
  }
  // Pawn attackers: a pawn of byColor attacks diagonally "forward" from its own perspective,
  // so to attack (r,c) it sits at (r - dir, c ± 1) where dir is that pawn's forward direction.
  const dir = byColor === WHITE ? 1 : -1;
  for (const dc of [-1, 1]) {
    const pr = r - dir, pc = c - dc;
    if (inBounds(pr, pc)) {
      const p = board[pr][pc];
      if (p && p.color === byColor && p.type === 'P') return true;
    }
  }
  return false;
}

export function inCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.r, k.c, other(color));
}

export function applyMove(board, move) {
  const next = cloneBoard(board);
  const piece = next[move.fr][move.fc];
  next[move.fr][move.fc] = null;
  next[move.tr][move.tc] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  return next;
}

// All fully legal moves for `color` (pseudo-legal minus those leaving own king in check).
export function generateLegalMoves(board, color) {
  const legal = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      for (const m of pseudoMovesFor(board, r, c)) {
        const next = applyMove(board, m);
        if (!inCheck(next, color)) legal.push(m);
      }
    }
  }
  return legal;
}

export function gameStatus(board, colorToMove) {
  const check = inCheck(board, colorToMove);
  const moves = generateLegalMoves(board, colorToMove);
  if (moves.length === 0) {
    return check ? 'checkmate' : 'stalemate';
  }
  return check ? 'check' : 'normal';
}

export const PIECE_VALUES = { P: 10, N: 30, B: 31, R: 50, Q: 90, K: 999 };

export function squareName(r, c) {
  return String.fromCharCode(97 + c) + (r + 1);
}
