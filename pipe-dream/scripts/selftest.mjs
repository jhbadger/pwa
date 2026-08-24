// Quick correctness check for the board/flow logic — not shipped to the app, dev-only.
import {
  ROWS, COLS, cellIndex, coordsOf, PIECES, PIECE_TYPES, SOURCE_INDEX,
  createInitialBoard, randomPieceType, createQueue, canPlace, placePiece,
  initialFlowState, stepFlow,
} from '../js/pipedream.js';

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

check('cellIndex/coordsOf round-trip', coordsOf(cellIndex(5, 3)), { r: 5, c: 3 });

// ---------- board setup ----------
{
  const board = createInitialBoard();
  check('board has ROWS*COLS cells', board.length, ROWS * COLS);
  check('source cell is preset', board[SOURCE_INDEX].type, 'SOURCE');
  check('every other cell starts empty', board.filter((c) => c !== null).length, 1);
  check('cannot place on the source cell', canPlace(board, SOURCE_INDEX), false);
  check('can place on an empty cell', canPlace(board, cellIndex(3, 3)), true);
}

// ---------- placement ----------
{
  const board = createInitialBoard();
  const next = placePiece(board, cellIndex(1, 2), 'NS');
  check('placePiece fills the target cell', next[cellIndex(1, 2)], { type: 'NS' });
  check('placePiece does not mutate the original board', board[cellIndex(1, 2)], null);
  check('placing on an occupied cell fails', placePiece(next, cellIndex(1, 2), 'EW'), null);
  check('placing on the source fails', placePiece(board, SOURCE_INDEX, 'EW'), null);
}

// ---------- queue generation ----------
{
  const seq = [0.05, 0.99, 0.5];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const queue = createQueue(3, rng);
  check('createQueue produces the requested length', queue.length, 3);
  check('every queued piece is a known type', queue.every((t) => PIECE_TYPES.includes(t)), true);
  check('randomPieceType(0) is the first type', randomPieceType(() => 0), PIECE_TYPES[0]);
}

// ---------- flow: straight run down the source column ----------
{
  let board = createInitialBoard();
  board = placePiece(board, cellIndex(1, 2), 'NS');
  board = placePiece(board, cellIndex(2, 2), 'NS');

  let state = initialFlowState();
  let step = stepFlow(board, state);
  check('flows into the first placed pipe', step.leak, false);
  check('lands on (1,2)', coordsOf(step.index), { r: 1, c: 2 });
  check('a straight NS pipe keeps flowing south', step.state.dir, 'S');

  state = step.state;
  step = stepFlow(board, state);
  check('flows into the second pipe', step.leak, false);
  check('lands on (2,2)', coordsOf(step.index), { r: 2, c: 2 });

  step = stepFlow(board, step.state);
  check('running into an empty cell leaks', step.leak, true);
}

// ---------- flow: a curve actually redirects it ----------
{
  // Source flows south into (1,2); an SE-connecting curve there should turn
  // the flow east instead of continuing south.
  let board = createInitialBoard();
  board = placePiece(board, cellIndex(1, 2), 'SE');
  // Wait — the curve must accept the incoming direction. Water arrives
  // moving south, i.e. entering from the north side, so the piece needs an
  // 'N' connector, not 'S'. Use NE (connects N and E) instead.
  board = placePiece(createInitialBoard(), cellIndex(1, 2), 'NE');
  board = placePiece(board, cellIndex(1, 3), 'EW');

  const step1 = stepFlow(board, initialFlowState());
  check('NE curve accepts flow arriving from the north', step1.leak, false);
  check('NE curve redirects flow east', step1.state.dir, 'E');

  const step2 = stepFlow(board, step1.state);
  check('flow continues east into the EW straight', step2.leak, false);
  check('lands on (1,3)', coordsOf(step2.index), { r: 1, c: 3 });
  check('EW straight keeps the flow heading east', step2.state.dir, 'E');
}

// ---------- flow: wrong orientation still leaks ----------
{
  // An SW curve (connects south and west) does not have a north connector,
  // so flow arriving from the north cannot enter it.
  let board = createInitialBoard();
  board = placePiece(board, cellIndex(1, 2), 'SW');
  const step = stepFlow(board, initialFlowState());
  check('a curve without the needed connector leaks', step.leak, true);
}

// ---------- flow: running off the board edge leaks ----------
{
  // Build a straight run all the way to the bottom row, then let it try to
  // exit past the edge.
  let board = createInitialBoard();
  for (let r = 1; r < ROWS; r++) board = placePiece(board, cellIndex(r, 2), 'NS');
  let state = initialFlowState();
  let leaked = false;
  for (let i = 0; i < ROWS; i++) {
    const step = stepFlow(board, state);
    if (step.leak) { leaked = true; break; }
    state = step.state;
  }
  check('flow off the bottom edge eventually leaks', leaked, true);
}

// ---------- every piece type is a valid 2-connector shape ----------
for (const [type, connectors] of Object.entries(PIECES)) {
  check(`${type} has exactly 2 connectors`, connectors.length, 2);
  check(`${type} connectors are distinct`, connectors[0] !== connectors[1], true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
