// Simple alpha-beta minimax opponent for minichess.
import { applyMove, generateLegalMoves, inCheck, other, PIECE_VALUES } from './chess.js';

// Small center-control bonus so the engine doesn't shuffle aimlessly when material is even.
const CENTER = [
  [0, 1, 1, 1, 0],
  [1, 2, 2, 2, 1],
  [1, 2, 3, 2, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

function evaluate(board, forColor) {
  let score = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board.length; c++) {
      const p = board[r][c];
      if (!p) continue;
      const value = PIECE_VALUES[p.type] + CENTER[r][c];
      score += p.color === forColor ? value : -value;
    }
  }
  return score;
}

function orderMoves(moves) {
  // Captures/promotions first — cheap move ordering that helps alpha-beta cut earlier.
  return moves.slice().sort((a, b) => {
    const av = (a.capture ? 1 : 0) + (a.promotion ? 1 : 0);
    const bv = (b.capture ? 1 : 0) + (b.promotion ? 1 : 0);
    return bv - av;
  });
}

// Negamax with alpha-beta pruning. `color` is the side to move at this node;
// scores are always returned from `color`'s point of view, then negated by the caller.
function search(board, color, depth, alpha, beta) {
  const moves = generateLegalMoves(board, color);
  if (moves.length === 0) {
    // No legal moves: checkmate (very bad for `color`) or stalemate (draw).
    return inCheck(board, color) ? -100000 - depth : 0;
  }
  if (depth === 0) {
    return evaluate(board, color);
  }

  let best = -Infinity;
  for (const move of orderMoves(moves)) {
    const next = applyMove(board, move);
    const score = -search(next, other(color), depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

export function chooseComputerMove(board, color, depth) {
  const moves = generateLegalMoves(board, color);
  if (moves.length === 0) return null;

  let best = [];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of orderMoves(moves)) {
    const next = applyMove(board, move);
    const score = -search(next, other(color), depth - 1, -beta, -alpha);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
    if (score > alpha) alpha = score;
  }

  // Pick randomly among equally-good top moves so the AI isn't fully deterministic.
  return best[Math.floor(Math.random() * best.length)];
}
