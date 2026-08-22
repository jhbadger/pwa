// Correctness check for the jigsaw grid/edge/layout math ported from the Oberon
// original — not shipped to the app, dev-only. Piece-silhouette rendering
// (renderPieceCanvas) needs a real canvas so it isn't covered here; everything
// that decides grid shape, interlocking, and snap behavior is.
import {
  computeGrid, genEdges, initLayout, pieceCol, pieceRow, targetX, targetY,
  scatter, bringToFront, withinSnapRange,
} from '../js/puzzle.js';

let failed = false;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failed = true;
}

// A square image split ~evenly should land on a square-ish grid.
{
  const { nCols, nRows, nPieces } = computeGrid(20, 1000, 1000);
  check('computeGrid square image', nCols === nRows, true);
  check('computeGrid piece count is cols*rows', nPieces, nCols * nRows);
}

// A 4:3 image should produce a wider-than-tall grid.
{
  const { nCols, nRows } = computeGrid(24, 1200, 900);
  check('computeGrid respects aspect ratio', nCols > nRows, true);
}

// Grid never exceeds the hard cap even if asked for more pieces than fit.
{
  const { nPieces } = computeGrid(1000, 1000, 1000, 200);
  check('computeGrid caps at maxPieces', nPieces <= 200, true);
}

// Edge interlocking: a piece's right edge must be the exact mirror of its
// right-neighbour's left edge, and its bottom edge the mirror of the piece
// below's top edge — otherwise adjacent pieces wouldn't fit together.
{
  const nCols = 5, nRows = 4;
  const { edgeTop, edgeRight, edgeBot, edgeLeft } = genEdges(nCols, nRows, () => 0.9);
  let mirrorOk = true;
  for (let p = 0; p < nCols * nRows; p++) {
    const col = pieceCol(p, nCols);
    const row = pieceRow(p, nCols);
    if (col < nCols - 1 && edgeRight[p] !== -edgeLeft[p + 1]) mirrorOk = false;
    if (row < nRows - 1 && edgeBot[p] !== -edgeTop[p + nCols]) mirrorOk = false;
  }
  check('genEdges neighbours mirror', mirrorOk, true);

  let borderFlat = true;
  for (let p = 0; p < nCols * nRows; p++) {
    const col = pieceCol(p, nCols);
    const row = pieceRow(p, nCols);
    if (col === 0 && edgeLeft[p] !== 0) borderFlat = false;
    if (col === nCols - 1 && edgeRight[p] !== 0) borderFlat = false;
    if (row === 0 && edgeTop[p] !== 0) borderFlat = false;
    if (row === nRows - 1 && edgeBot[p] !== 0) borderFlat = false;
  }
  check('genEdges outer border is flat', borderFlat, true);
}

// initLayout: a wide screen with a tall image should letterbox to the
// image's own aspect ratio, not stretch to fill the screen.
{
  const layout = initLayout(1000, 2000, 5, 10, 1600, 1000, 40);
  const ratioImg = 1000 / 2000;
  const ratioDisp = layout.dispW / layout.dispH;
  check('initLayout preserves aspect ratio', Math.abs(ratioImg - ratioDisp) < 0.01, true);
  check('initLayout centers horizontally', layout.dispX > 0, true);
}

// targetX/targetY should place piece 0 at the grid's top-left corner and the
// last piece at its bottom-right cell.
{
  const nCols = 4, nRows = 3;
  const dispX = 50, dispY = 20, dPW = 30, dPH = 25;
  check('targetX piece 0', targetX(0, nCols, dispX, dPW), dispX);
  check('targetY piece 0', targetY(0, nCols, dispY, dPH), dispY);
  const last = nCols * nRows - 1;
  check('targetX last piece', targetX(last, nCols, dispX, dPW), dispX + (nCols - 1) * dPW);
  check('targetY last piece', targetY(last, nCols, dispY, dPH), dispY + (nRows - 1) * dPH);
}

// scatter() must place every piece within the canvas bounds and produce a
// draw order that's a permutation of every piece index exactly once.
{
  const n = 12;
  const { pieceX, pieceY, placed, drawOrder } = scatter(n, 50, 40, 500, 400, () => 0.5);
  let inBounds = true;
  for (let i = 0; i < n; i++) {
    if (pieceX[i] < 0 || pieceX[i] > 500 || pieceY[i] < 0 || pieceY[i] > 400) inBounds = false;
  }
  check('scatter keeps pieces in bounds', inBounds, true);
  check('scatter starts nothing placed', placed.every((v) => v === false), true);
  check('scatter draw order is a permutation', [...drawOrder].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
}

// bringToFront moves the piece at index k to the end (frontmost) without
// dropping or duplicating any entry.
{
  const order = [0, 1, 2, 3, 4];
  bringToFront(order, 1);
  check('bringToFront moves to end', order[order.length - 1], 1);
  check('bringToFront preserves all entries', [...order].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
}

// withinSnapRange: within a third of the piece size snaps, a full piece away
// does not.
{
  check('withinSnapRange close enough', withinSnapRange(100, 100, 105, 102, 60, 60), true);
  check('withinSnapRange too far', withinSnapRange(100, 100, 200, 200, 60, 60), false);
}

if (failed) {
  console.error('\nSome checks failed.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
