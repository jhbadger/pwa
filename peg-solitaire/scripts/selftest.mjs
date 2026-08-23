// Quick correctness check for the board logic — not shipped to the app, dev-only.
import {
  SIZE, isValidCell, cellIndex, coordsOf, createBoard, movesFrom, allLegalMoves,
  applyMove, pegCount, isSolved, isCenterWin, isStuck,
} from '../js/pegsolitaire.js';

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

// ---------- board shape ----------
let validCount = 0;
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    if (isValidCell(r, c)) validCount++;
  }
}
check('English cross has 33 holes', validCount, 33);
check('corner is not part of the board', isValidCell(0, 0), false);
check('center is part of the board', isValidCell(3, 3), true);
check('arm cell is part of the board', isValidCell(0, 3), true);
check('waist cell is part of the board', isValidCell(3, 0), true);

check('cellIndex/coordsOf round-trip', coordsOf(cellIndex(4, 2)), { r: 4, c: 2 });

// ---------- initial board ----------
{
  const board = createBoard();
  check('initial peg count is 32', pegCount(board), 32);
  check('center starts empty', board[cellIndex(3, 3)], 'empty');
  check('a corner cell is null (not on the board)', board[cellIndex(0, 0)], null);
  check('not solved at the start', isSolved(board), false);
  check('not stuck at the start', isStuck(board), false);

  // Only the four pegs orthogonally two away from the center can open it.
  const moves = allLegalMoves(board);
  check('exactly 4 legal opening moves', moves.length, 4);
  const opensCenter = moves.every((m) => m.to === cellIndex(3, 3));
  check('every opening move lands in the center', opensCenter, true);
}

// ---------- movesFrom / applyMove ----------
{
  const board = createBoard();
  const moves = movesFrom(board, 1, 3); // peg two above center
  check('movesFrom the cell above center finds one move', moves.length, 1);
  check('that move jumps over (2,3) into the center', moves[0], { from: cellIndex(1, 3), over: cellIndex(2, 3), to: cellIndex(3, 3) });

  const next = applyMove(board, moves[0]);
  check('applyMove empties the origin', next[cellIndex(1, 3)], 'empty');
  check('applyMove empties the jumped peg', next[cellIndex(2, 3)], 'empty');
  check('applyMove fills the landing cell', next[cellIndex(3, 3)], 'peg');
  check('applyMove does not mutate the original board', board[cellIndex(3, 3)], 'empty');
  check('peg count drops by one after a move', pegCount(next), 31);
}

{
  // Off-board and out-of-range jumps must not be offered.
  const board = createBoard();
  check('no moves from an off-board cell', movesFrom(board, 0, 0), []);
  const edgeMoves = movesFrom(board, 0, 3); // top edge of the board, can't jump further up
  check('edge peg has no move that goes off the board', edgeMoves.every((m) => m.to >= 0), true);
}

// ---------- win / stuck detection on hand-built boards ----------
{
  // A single peg left, off-center: solved, but not the "perfect" center finish.
  const board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isValidCell(r, c)) board[cellIndex(r, c)] = 'empty';
  board[cellIndex(3, 1)] = 'peg';
  check('one peg left counts as solved', isSolved(board), true);
  check('one peg left off-center is not the perfect finish', isCenterWin(board), false);
  check('a solved board is never reported stuck', isStuck(board), false);
}

{
  // The perfect finish: the last peg is in the center.
  const board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isValidCell(r, c)) board[cellIndex(r, c)] = 'empty';
  board[cellIndex(3, 3)] = 'peg';
  check('center-only board is the perfect finish', isCenterWin(board), true);
}

{
  // Two pegs, far apart with no shared jump line: no legal moves, not solved.
  const board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isValidCell(r, c)) board[cellIndex(r, c)] = 'empty';
  board[cellIndex(0, 3)] = 'peg';
  board[cellIndex(6, 3)] = 'peg';
  check('two pegs 6 apart have no legal jump', allLegalMoves(board).length, 0);
  check('two pegs with no jump is stuck, not solved', isStuck(board), true);
  check('two pegs is not solved', isSolved(board), false);
}

{
  // Two adjacent pegs on an otherwise-empty row: either one can jump over
  // the other, since both landing cells are clear — two legal moves, not one.
  const board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isValidCell(r, c)) board[cellIndex(r, c)] = 'empty';
  board[cellIndex(3, 2)] = 'peg';
  board[cellIndex(3, 3)] = 'peg';
  check('adjacent pegs with clear landings both have a jump', allLegalMoves(board).length, 2);
  check('that board is not stuck', isStuck(board), false);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
