// Quick correctness check for the chess engine — not shipped to the app, dev-only.
import {
  createInitialBoard, generateLegalMoves, applyMove, gameStatus, other, WHITE, BLACK, squareName,
} from '../js/chess.js';
import { chooseComputerMove } from '../js/ai.js';

function perft(board, color, depth) {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(board, color);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    nodes += perft(applyMove(board, m), other(color), depth - 1);
  }
  return nodes;
}

const board = createInitialBoard();
console.log('Initial legal moves for white:', generateLegalMoves(board, WHITE).length);
console.log('perft(1)=', perft(board, WHITE, 1));
console.log('perft(2)=', perft(board, WHITE, 2));
console.log('perft(3)=', perft(board, WHITE, 3));
console.log('perft(4)=', perft(board, WHITE, 4));

// Play a random-ish game using the AI for both sides and make sure it terminates cleanly.
let b = createInitialBoard();
let color = WHITE;
let ply = 0;
let status = gameStatus(b, color);
while (status === 'normal' || status === 'check') {
  const move = chooseComputerMove(b, color, 2);
  if (!move) { console.log('No move but status was', status, '— BUG'); break; }
  b = applyMove(b, move);
  console.log(ply, color, squareName(move.fr, move.fc), '->', squareName(move.tr, move.tc), move.capture ? 'x' : '', move.promotion ? '=Q' : '');
  color = other(color);
  status = gameStatus(b, color);
  ply++;
  if (ply > 200) { console.log('Ply limit hit, stopping.'); break; }
}
console.log('Final status for', color, ':', status);
