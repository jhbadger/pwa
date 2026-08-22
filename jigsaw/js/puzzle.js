// Core jigsaw logic: grid sizing, edge (knob/slot) generation, piece silhouette
// rendering, and scatter/snap math. Pure and DOM-light (only touches canvas
// pixel buffers) so it can run in a worker later and be unit-tested directly —
// see scripts/selftest.mjs. Ported from the Oberon original at
// oberon-transpiler/examples/jigsaw.mod, which drives Raylib pixel-by-pixel;
// here a piece's silhouette is built the same way, into an ImageData buffer.

export const MAX_PIECES = 200;

// Picks nCols x nRows so nCols*nRows is as close to n as possible while
// matching the image's aspect ratio, capped at maxPieces.
export function computeGrid(n, imgW, imgH, maxPieces = MAX_PIECES) {
  const aspect = imgW / imgH;
  let best = Infinity;
  let nCols = 1;
  let nRows = 1;
  for (let c = 1; c <= 30; c++) {
    let r = Math.round(c / aspect);
    if (r < 1) r = 1;
    const diff = Math.abs(c * r - n);
    if (diff < best) {
      best = diff;
      nCols = c;
      nRows = r;
    }
  }
  while (nCols * nRows > maxPieces) {
    if (nCols >= nRows) nCols--; else nRows--;
    if (nCols < 1) nCols = 1;
    if (nRows < 1) nRows = 1;
  }
  return { nCols, nRows, nPieces: nCols * nRows };
}

export function pieceCol(p, nCols) { return p % nCols; }
export function pieceRow(p, nCols) { return Math.floor(p / nCols); }

// Each edge is -1 (slot/inward), 0 (flat, on the puzzle border) or +1
// (knob/outward). A piece's left edge is always the mirror of its
// left-neighbour's right edge, and top mirrors the neighbour above, so the
// two pieces interlock. Processing in row-major order guarantees that
// neighbour is already assigned by the time it's needed.
export function genEdges(nCols, nRows, rand = Math.random) {
  const nPieces = nCols * nRows;
  const edgeTop = new Int8Array(nPieces);
  const edgeRight = new Int8Array(nPieces);
  const edgeBot = new Int8Array(nPieces);
  const edgeLeft = new Int8Array(nPieces);
  for (let p = 0; p < nPieces; p++) {
    const col = pieceCol(p, nCols);
    const row = pieceRow(p, nCols);
    edgeLeft[p] = col === 0 ? 0 : -edgeRight[p - 1];
    edgeTop[p] = row === 0 ? 0 : -edgeBot[p - nCols];
    edgeRight[p] = col === nCols - 1 ? 0 : (rand() < 0.5 ? 1 : -1);
    edgeBot[p] = row === nRows - 1 ? 0 : (rand() < 0.5 ? 1 : -1);
  }
  return { edgeTop, edgeRight, edgeBot, edgeLeft };
}

// Fits the solved-image rectangle into the available canvas area (minus a
// margin), and derives per-piece display pixel dimensions.
export function initLayout(imgW, imgH, nCols, nRows, scrW, scrH, border) {
  const maxW = Math.max(1, scrW - 2 * border);
  const maxH = Math.max(1, scrH - 2 * border);
  const ratio = imgW / imgH;
  let dispW, dispH;
  if (maxW / maxH > ratio) {
    dispH = maxH;
    dispW = Math.floor(dispH * ratio);
  } else {
    dispW = maxW;
    dispH = Math.floor(dispW / ratio);
  }
  const dispX = Math.floor((scrW - dispW) / 2);
  const dispY = Math.floor((scrH - dispH) / 2);
  const dPW = Math.max(1, Math.floor(dispW / nCols));
  const dPH = Math.max(1, Math.floor(dispH / nRows));
  return { dispW, dispH, dispX, dispY, dPW, dPH };
}

export function targetX(p, nCols, dispX, dPW) { return dispX + pieceCol(p, nCols) * dPW; }
export function targetY(p, nCols, dispY, dPH) { return dispY + pieceRow(p, nCols) * dPH; }

// Point-in-shape test for a piece silhouette: the core dPW x dPH rectangle,
// plus circular knob bumps where an edge is +1, minus circular slot cutouts
// where an edge is -1. (px, py) are piece-local coordinates with (0,0) at
// the core rectangle's top-left.
function isInsidePiece(px, py, dPW, dPH, R2, centers, te, re, be, le) {
  const [tCX, tCY, bCX, bCY, lCX, lCY, rCX, rCY] = centers;
  const dT = (px - tCX) ** 2 + (py - tCY) ** 2;
  const dB = (px - bCX) ** 2 + (py - bCY) ** 2;
  const dL = (px - lCX) ** 2 + (py - lCY) ** 2;
  const dR = (px - rCX) ** 2 + (py - rCY) ** 2;
  if (px >= 0 && px < dPW && py >= 0 && py < dPH) {
    if ((te < 0 && dT < R2) || (be < 0 && dB < R2) || (le < 0 && dL < R2) || (re < 0 && dR < R2)) {
      return false;
    }
    return true;
  }
  return (te > 0 && dT < R2) || (be > 0 && dB < R2) || (le > 0 && dL < R2) || (re > 0 && dR < R2);
}

export function knobPadFor(dPW, dPH) {
  const R = Math.min(dPW, dPH) * 0.18;
  return Math.floor(R * 1.7) + 2;
}

// Renders one piece's silhouette (with a source-image texture and a darkened
// 1px outline) into a fresh canvas. srcCtx must already have the full solved
// image drawn onto it at its natural (imgW x imgH) resolution.
export function renderPieceCanvas(srcCtx, srcW, srcH, opts) {
  const { col, row, pieceW, pieceH, dPW, dPH, te, re, be, le } = opts;
  const R = Math.min(dPW, dPH) * 0.18;
  const R2 = R * R;
  const knobPad = knobPadFor(dPW, dPH);
  const tw = dPW + 2 * knobPad;
  const th = dPH + 2 * knobPad;

  const centers = [
    dPW * 0.5, -R * 0.5,        // top
    dPW * 0.5, dPH + R * 0.5,   // bottom
    -R * 0.5, dPH * 0.5,        // left
    dPW + R * 0.5, dPH * 0.5,   // right
  ];

  const srcImg = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const out = new ImageData(tw, th);
  const outData = out.data;

  for (let oy = 0; oy < th; oy++) {
    const py = oy - knobPad;
    for (let ox = 0; ox < tw; ox++) {
      const px = ox - knobPad;
      const inside = isInsidePiece(px, py, dPW, dPH, R2, centers, te, re, be, le);
      if (!inside) continue;

      let srcX = col * pieceW + Math.floor((px * pieceW) / dPW);
      let srcY = row * pieceH + Math.floor((py * pieceH) / dPH);
      if (srcX < 0) srcX = 0; else if (srcX >= srcW) srcX = srcW - 1;
      if (srcY < 0) srcY = 0; else if (srcY >= srcH) srcY = srcH - 1;
      const si = (srcY * srcW + srcX) * 4;
      let r = srcImg[si];
      let g = srcImg[si + 1];
      let b = srcImg[si + 2];

      const isEdge = !isInsidePiece(px - 1, py, dPW, dPH, R2, centers, te, re, be, le)
        || !isInsidePiece(px + 1, py, dPW, dPH, R2, centers, te, re, be, le)
        || !isInsidePiece(px, py - 1, dPW, dPH, R2, centers, te, re, be, le)
        || !isInsidePiece(px, py + 1, dPW, dPH, R2, centers, te, re, be, le);
      if (isEdge) {
        r = Math.round(r * 0.55);
        g = Math.round(g * 0.55);
        b = Math.round(b * 0.55);
      }

      const oi = (oy * tw + ox) * 4;
      outData[oi] = r;
      outData[oi + 1] = g;
      outData[oi + 2] = b;
      outData[oi + 3] = 255;
    }
  }

  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(tw, th)
    : Object.assign(document.createElement('canvas'), { width: tw, height: th });
  const ctx = canvas.getContext('2d');
  ctx.putImageData(out, 0, 0);
  return { canvas, knobPad };
}

// Scatters all pieces to random positions within the canvas and returns a
// fresh back-to-front draw order (index nPieces-1 is frontmost).
export function scatter(nPieces, dPW, dPH, scrW, scrH, rand = Math.random) {
  const pieceX = new Float64Array(nPieces);
  const pieceY = new Float64Array(nPieces);
  const placed = new Array(nPieces).fill(false);
  const drawOrder = Array.from({ length: nPieces }, (_, i) => i);
  const maxX = Math.max(1, scrW - dPW);
  const maxY = Math.max(1, scrH - dPH);
  for (let i = 0; i < nPieces; i++) {
    pieceX[i] = rand() * maxX;
    pieceY[i] = rand() * maxY;
  }
  for (let i = nPieces - 1; i >= 1; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = drawOrder[i];
    drawOrder[i] = drawOrder[j];
    drawOrder[j] = tmp;
  }
  return { pieceX, pieceY, placed, drawOrder };
}

// Moves drawOrder[k] to the front (end of the array) of the draw order.
export function bringToFront(drawOrder, k) {
  const val = drawOrder[k];
  drawOrder.splice(k, 1);
  drawOrder.push(val);
}

// True if a dropped piece at (pieceX, pieceY) is close enough to its target
// slot to snap into place.
export function withinSnapRange(pieceX, pieceY, tx, ty, dPW, dPH) {
  const dx = Math.abs(pieceX - tx);
  const dy = Math.abs(pieceY - ty);
  return dx < dPW / 3 && dy < dPH / 3;
}
