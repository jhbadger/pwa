import {
  computeGrid, genEdges, initLayout, pieceCol, pieceRow, targetX, targetY,
  renderPieceCanvas, scatter, bringToFront, withinSnapRange,
} from './puzzle.js';
import { saveGame, loadGame, clearGame } from './storage.js';

const BUNDLED_IMAGES = [
  { label: 'Sunset Peaks', file: 'images/sunset-peaks.jpg', thumb: 'images/thumb-sunset-peaks.jpg' },
  { label: 'Coral Reef', file: 'images/coral-reef.jpg', thumb: 'images/thumb-coral-reef.jpg' },
  { label: 'Aurora Night', file: 'images/aurora-night.jpg', thumb: 'images/thumb-aurora-night.jpg' },
];

const setupScreen = document.getElementById('setupScreen');
const gameScreen = document.getElementById('gameScreen');
const toolbar = document.getElementById('toolbar');
const board = document.getElementById('board');
const boardCtx = board.getContext('2d');
const statusEl = document.getElementById('status');
const picker = document.getElementById('picker');
const photoInput = document.getElementById('photoInput');
const filebtnLabel = document.getElementById('filebtnLabel');
const fileLabelText = document.getElementById('fileLabelText');
const pieceSlider = document.getElementById('pieceSlider');
const pieceCountLabel = document.getElementById('pieceCountLabel');
const btnStart = document.getElementById('btnStart');
const btnResume = document.getElementById('btnResume');
const btnReshuffle = document.getElementById('btnReshuffle');
const btnHint = document.getElementById('btnHint');
const btnNewPuzzle = document.getElementById('btnNewPuzzle');
const winOverlay = document.getElementById('winOverlay');
const btnWinNew = document.getElementById('btnWinNew');
const toastEl = document.getElementById('toast');

let game = null; // see startNewGame() for shape
let selectedSource = null; // { kind: 'bundled'|'file', file, label }

// ---------- setup screen ----------

function renderPicker() {
  picker.innerHTML = '';
  for (const entry of BUNDLED_IMAGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-item';
    btn.setAttribute('role', 'listitem');
    btn.innerHTML = `<img src="${entry.thumb}" alt=""><span class="label">${entry.label}</span>`;
    btn.addEventListener('click', () => {
      selectedSource = { kind: 'bundled', file: entry.file, label: entry.label };
      photoInput.value = '';
      clearFileSelection();
      markPickerSelected(btn);
      btnStart.disabled = false;
    });
    picker.appendChild(btn);
  }
}

function markPickerSelected(el) {
  picker.querySelectorAll('.picker-item').forEach((item) => item.classList.toggle('selected', item === el));
}

function clearFileSelection() {
  filebtnLabel.classList.remove('selected');
  fileLabelText.textContent = 'Choose a photo or PDF…';
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;
  selectedSource = { kind: 'file', file, label: file.name };
  markPickerSelected(null);
  filebtnLabel.classList.add('selected');
  fileLabelText.textContent = `Selected: ${file.name}`;
  btnStart.disabled = false;
});

pieceSlider.addEventListener('input', () => {
  pieceCountLabel.textContent = pieceSlider.value;
});

btnStart.addEventListener('click', async () => {
  if (!selectedSource) return;
  btnStart.disabled = true;
  showGameScreen();
  statusEl.textContent = isPdfFile(selectedSource) ? 'Rendering PDF page…' : 'Preparing puzzle…';
  await nextFrame();
  try {
    const srcCanvas = await resolveSourceCanvas(selectedSource);
    statusEl.textContent = 'Preparing puzzle…';
    await nextFrame();
    await startNewGame(srcCanvas, Number(pieceSlider.value));
  } catch (err) {
    console.error(err);
    goToSetup(false);
    showToast('Could not load that file.');
  } finally {
    btnStart.disabled = false;
  }
});

// ---------- image / PDF loading helpers ----------

function isPdfFile(selectedSource) {
  if (selectedSource.kind !== 'file') return false;
  const file = selectedSource.file;
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// Resolves any selected source — a bundled image, an uploaded photo, or an
// uploaded PDF — down to a single canvas holding the artwork at natural
// resolution, so the rest of the pipeline never needs to know which kind it
// started from.
async function resolveSourceCanvas(selectedSource) {
  if (isPdfFile(selectedSource)) {
    return renderRandomPdfPage(selectedSource.file);
  }
  const blob = selectedSource.kind === 'file'
    ? selectedSource.file
    : await fetch(selectedSource.file).then((r) => r.blob());
  const img = await blobToImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// pdf.js is only needed by the (optional) PDF path, so it's loaded on demand
// rather than on every launch — see the offline-first rule against putting
// anything on the critical path the installed app can't use. It's still in
// sw.js's PRECACHE list, so the dynamic import resolves from cache even the
// first time it's used offline.
const PDF_TARGET_MAX_DIM = 1600;
let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('./vendor/pdfjs/pdf.min.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return mod;
    });
  }
  return pdfjsLibPromise;
}

async function renderRandomPdfPage(blob) {
  const pdfjsLib = await loadPdfjs();
  const data = await blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pageNum = 1 + Math.floor(Math.random() * doc.numPages);
  const page = await doc.getPage(pageNum);

  const vp1 = page.getViewport({ scale: 1 });
  const scale = PDF_TARGET_MAX_DIM / Math.max(vp1.width, vp1.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  // PDF pages have no inherent background — fill white first, or margins
  // would sample as black once the jigsaw piece cutter reads raw RGB below.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20)));
}

// ---------- canvas sizing ----------

function resizeCanvasToDisplaySize() {
  const rect = board.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (board.width !== w || board.height !== h) {
    board.width = w;
    board.height = h;
    return true;
  }
  return false;
}

function computeBorder() {
  return Math.round(Math.min(board.width, board.height) * 0.045);
}

function toCanvasCoords(e) {
  const rect = board.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (board.width / rect.width),
    y: (e.clientY - rect.top) * (board.height / rect.height),
  };
}

// ---------- game lifecycle ----------

function buildPieceCanvases(srcCtx, imgW, imgH, nCols, nRows, pieceW, pieceH, dPW, dPH, edges) {
  const nPieces = nCols * nRows;
  const out = new Array(nPieces);
  for (let p = 0; p < nPieces; p++) {
    out[p] = renderPieceCanvas(srcCtx, imgW, imgH, {
      col: pieceCol(p, nCols),
      row: pieceRow(p, nCols),
      pieceW, pieceH, dPW, dPH,
      te: edges.edgeTop[p], re: edges.edgeRight[p], be: edges.edgeBot[p], le: edges.edgeLeft[p],
    });
  }
  return out;
}

function showGameScreen() {
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  toolbar.hidden = false;
  winOverlay.hidden = true;
}

// srcCanvas already holds the artwork at natural resolution — from a bundled
// or uploaded photo, or a rendered PDF page (see resolveSourceCanvas). The
// canvas is re-encoded to a JPEG blob for persistence rather than keeping
// whatever the original file was: a resumed game must show the exact pixels
// the player was assembling, and for a PDF that means the one page that got
// randomly picked, not a re-render that might land on a different page.
async function startNewGame(srcCanvas, nTarget) {
  const imgW = srcCanvas.width;
  const imgH = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d');
  const imageBlob = await new Promise((resolve) => srcCanvas.toBlob(resolve, 'image/jpeg', 0.9));

  const { nCols, nRows, nPieces } = computeGrid(nTarget, imgW, imgH);
  const pieceW = Math.max(1, Math.floor(imgW / nCols));
  const pieceH = Math.max(1, Math.floor(imgH / nRows));

  resizeCanvasToDisplaySize();
  const layout = initLayout(imgW, imgH, nCols, nRows, board.width, board.height, computeBorder());
  const edges = genEdges(nCols, nRows);
  const pieceCanvases = buildPieceCanvases(srcCtx, imgW, imgH, nCols, nRows, pieceW, pieceH, layout.dPW, layout.dPH, edges);
  const s = scatter(nPieces, layout.dPW, layout.dPH, board.width, board.height);

  game = {
    imgW, imgH, nCols, nRows, nPieces, pieceW, pieceH,
    ...layout,
    edges, pieceCanvases,
    pieceX: s.pieceX, pieceY: s.pieceY, placed: s.placed, drawOrder: s.drawOrder,
    solvedCount: 0, won: false, showGhost: false,
    nTarget, imageBlob, srcCanvas, srcCtx,
    dragging: false, dragPiece: -1, dragOffX: 0, dragOffY: 0,
  };

  updateStatus();
  scheduleDraw();
  syncSave();
}

async function resumeGame(saved) {
  const img = await blobToImage(saved.imageBlob);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = saved.imgW;
  srcCanvas.height = saved.imgH;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);

  showGameScreen();
  statusEl.textContent = 'Preparing puzzle…';
  await nextFrame();

  resizeCanvasToDisplaySize();
  const layout = initLayout(saved.imgW, saved.imgH, saved.nCols, saved.nRows, board.width, board.height, computeBorder());
  const edges = {
    edgeTop: saved.edgeTop, edgeRight: saved.edgeRight, edgeBot: saved.edgeBot, edgeLeft: saved.edgeLeft,
  };
  const pieceCanvases = buildPieceCanvases(
    srcCtx, saved.imgW, saved.imgH, saved.nCols, saved.nRows, saved.pieceW, saved.pieceH,
    layout.dPW, layout.dPH, edges,
  );

  const nPieces = saved.nPieces;
  const pieceX = new Float64Array(nPieces);
  const pieceY = new Float64Array(nPieces);
  for (let p = 0; p < nPieces; p++) {
    if (saved.placed[p]) {
      pieceX[p] = targetX(p, saved.nCols, layout.dispX, layout.dPW);
      pieceY[p] = targetY(p, saved.nCols, layout.dispY, layout.dPH);
    } else {
      pieceX[p] = saved.pieceXFrac[p] * board.width;
      pieceY[p] = saved.pieceYFrac[p] * board.height;
    }
  }

  game = {
    imgW: saved.imgW, imgH: saved.imgH, nCols: saved.nCols, nRows: saved.nRows, nPieces,
    pieceW: saved.pieceW, pieceH: saved.pieceH,
    ...layout,
    edges, pieceCanvases, pieceX, pieceY,
    placed: saved.placed.slice(), drawOrder: saved.drawOrder.slice(),
    solvedCount: saved.solvedCount, won: saved.won, showGhost: saved.showGhost,
    nTarget: saved.nTarget, imageBlob: saved.imageBlob, srcCanvas, srcCtx,
    dragging: false, dragPiece: -1, dragOffX: 0, dragOffY: 0,
  };

  btnHint.setAttribute('aria-pressed', String(game.showGhost));
  updateStatus();
  scheduleDraw();
  if (game.won) winOverlay.hidden = false;
}

function updateStatus() {
  statusEl.textContent = `Pieces: ${game.solvedCount} / ${game.nPieces}`;
  statusEl.classList.toggle('won', game.won);
}

function persist() {
  if (!game) return;
  const nPieces = game.nPieces;
  const pieceXFrac = new Array(nPieces);
  const pieceYFrac = new Array(nPieces);
  for (let p = 0; p < nPieces; p++) {
    pieceXFrac[p] = game.pieceX[p] / board.width;
    pieceYFrac[p] = game.pieceY[p] / board.height;
  }
  saveGame({
    imageBlob: game.imageBlob,
    imgW: game.imgW, imgH: game.imgH,
    nCols: game.nCols, nRows: game.nRows, nPieces,
    pieceW: game.pieceW, pieceH: game.pieceH,
    edgeTop: Array.from(game.edges.edgeTop),
    edgeRight: Array.from(game.edges.edgeRight),
    edgeBot: Array.from(game.edges.edgeBot),
    edgeLeft: Array.from(game.edges.edgeLeft),
    pieceXFrac, pieceYFrac,
    placed: game.placed.slice(),
    drawOrder: game.drawOrder.slice(),
    solvedCount: game.solvedCount, won: game.won, showGhost: game.showGhost,
    nTarget: game.nTarget,
  }).catch(() => {});
}

// A won puzzle has nothing left to resume, so drop the save instead of
// re-persisting it — otherwise the completed state would keep offering
// itself as "Resume saved puzzle" on next launch.
function syncSave() {
  if (!game) return;
  if (game.won) clearGame().catch(() => {});
  else persist();
}

// ---------- drawing ----------

let drawScheduled = false;
function scheduleDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => { drawScheduled = false; draw(); });
}

function draw() {
  if (!game) return;
  const ctx = boardCtx;
  ctx.save();
  ctx.clearRect(0, 0, board.width, board.height);
  ctx.fillStyle = '#0d1b1f';
  ctx.fillRect(0, 0, board.width, board.height);

  if (game.showGhost) {
    ctx.globalAlpha = 0.2;
    ctx.drawImage(game.srcCanvas, 0, 0, game.imgW, game.imgH, game.dispX, game.dispY, game.dispW, game.dispH);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = 'rgba(238,244,242,0.12)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= game.nCols; c++) {
    ctx.beginPath();
    ctx.moveTo(game.dispX + c * game.dPW, game.dispY);
    ctx.lineTo(game.dispX + c * game.dPW, game.dispY + game.dispH);
    ctx.stroke();
  }
  for (let r = 0; r <= game.nRows; r++) {
    ctx.beginPath();
    ctx.moveTo(game.dispX, game.dispY + r * game.dPH);
    ctx.lineTo(game.dispX + game.dispW, game.dispY + r * game.dPH);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(238,244,242,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(game.dispX - 1, game.dispY - 1, game.dispW + 2, game.dispH + 2);

  for (let p = 0; p < game.nPieces; p++) {
    if (game.placed[p]) drawPiece(p, false);
  }

  const draggedIdx = game.dragging ? game.dragPiece : -1;
  for (const p of game.drawOrder) {
    if (!game.placed[p] && p !== draggedIdx) drawPiece(p, false);
  }
  if (game.dragging) drawPiece(draggedIdx, true);

  ctx.restore();
}

function drawPiece(p, lifted) {
  const ctx = boardCtx;
  const { canvas: pc, knobPad } = game.pieceCanvases[p];
  const dx = Math.round(game.pieceX[p]) - knobPad;
  const dy = Math.round(game.pieceY[p]) - knobPad;
  ctx.save();
  if (lifted) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 10;
    ctx.globalAlpha = 0.92;
  } else if (!game.placed[p]) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
  }
  ctx.drawImage(pc, dx, dy);
  ctx.restore();
}

// ---------- pointer input ----------

function hitTestFree(x, y) {
  for (let i = game.drawOrder.length - 1; i >= 0; i--) {
    const p = game.drawOrder[i];
    if (game.placed[p]) continue;
    const px = game.pieceX[p];
    const py = game.pieceY[p];
    if (x >= px && x < px + game.dPW && y >= py && y < py + game.dPH) return { p, i };
  }
  return null;
}

board.addEventListener('pointerdown', (e) => {
  if (!game || game.won) return;
  const { x, y } = toCanvasCoords(e);
  const hit = hitTestFree(x, y);
  if (!hit) return;
  bringToFront(game.drawOrder, hit.i);
  game.dragging = true;
  game.dragPiece = hit.p;
  game.dragOffX = x - game.pieceX[hit.p];
  game.dragOffY = y - game.pieceY[hit.p];
  try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  scheduleDraw();
});

board.addEventListener('pointermove', (e) => {
  if (!game || !game.dragging) return;
  const { x, y } = toCanvasCoords(e);
  game.pieceX[game.dragPiece] = x - game.dragOffX;
  game.pieceY[game.dragPiece] = y - game.dragOffY;
  scheduleDraw();
});

function endDrag() {
  if (!game || !game.dragging) return;
  const p = game.dragPiece;
  const tx = targetX(p, game.nCols, game.dispX, game.dPW);
  const ty = targetY(p, game.nCols, game.dispY, game.dPH);
  if (withinSnapRange(game.pieceX[p], game.pieceY[p], tx, ty, game.dPW, game.dPH)) {
    game.pieceX[p] = tx;
    game.pieceY[p] = ty;
    game.placed[p] = true;
    game.solvedCount++;
    if (game.solvedCount === game.nPieces) {
      game.won = true;
      winOverlay.hidden = false;
    }
  }
  game.dragging = false;
  game.dragPiece = -1;
  updateStatus();
  scheduleDraw();
  syncSave();
}

board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);

// ---------- toolbar ----------

btnReshuffle.addEventListener('click', () => {
  if (!game) return;
  const s = scatter(game.nPieces, game.dPW, game.dPH, board.width, board.height);
  game.pieceX = s.pieceX;
  game.pieceY = s.pieceY;
  game.placed = s.placed;
  game.drawOrder = s.drawOrder;
  game.solvedCount = 0;
  game.won = false;
  game.dragging = false;
  winOverlay.hidden = true;
  updateStatus();
  scheduleDraw();
  syncSave();
});

btnHint.addEventListener('click', () => {
  if (!game) return;
  game.showGhost = !game.showGhost;
  btnHint.setAttribute('aria-pressed', String(game.showGhost));
  scheduleDraw();
  syncSave();
});

function goToSetup(confirmFirst) {
  if (confirmFirst && game && !game.won && game.solvedCount > 0) {
    if (!window.confirm('Discard this puzzle and start a new one?')) return;
  }
  game = null;
  winOverlay.hidden = true;
  gameScreen.hidden = true;
  toolbar.hidden = true;
  setupScreen.hidden = false;
  statusEl.textContent = '';
  statusEl.classList.remove('won');
  refreshResumeButton();
}

btnNewPuzzle.addEventListener('click', () => goToSetup(true));
btnWinNew.addEventListener('click', () => goToSetup(false));

// ---------- resize / orientation ----------

let resizeTimer = null;
function scheduleRelayout() {
  if (!game) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 200);
}
window.addEventListener('resize', scheduleRelayout);
window.addEventListener('orientationchange', scheduleRelayout);

function relayout() {
  if (!game) return;
  const oldW = board.width;
  const oldH = board.height;
  const changed = resizeCanvasToDisplaySize();
  if (!changed) return;

  const layout = initLayout(game.imgW, game.imgH, game.nCols, game.nRows, board.width, board.height, computeBorder());
  const scaleX = board.width / oldW;
  const scaleY = board.height / oldH;
  for (let p = 0; p < game.nPieces; p++) {
    if (game.placed[p]) {
      game.pieceX[p] = targetX(p, game.nCols, layout.dispX, layout.dPW);
      game.pieceY[p] = targetY(p, game.nCols, layout.dispY, layout.dPH);
    } else {
      game.pieceX[p] *= scaleX;
      game.pieceY[p] *= scaleY;
    }
  }
  Object.assign(game, layout);
  game.pieceCanvases = buildPieceCanvases(
    game.srcCtx, game.imgW, game.imgH, game.nCols, game.nRows, game.pieceW, game.pieceH,
    game.dPW, game.dPH, game.edges,
  );
  scheduleDraw();
  syncSave();
}

// ---------- iOS "Copy/Look Up" callout suppression ----------

document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button, input, label, a')) return;
  e.preventDefault();
}, { passive: false });

// ---------- service worker: install-once cache, background updates ----------

if ('serviceWorker' in navigator) {
  let priorControllerURL = navigator.serviceWorker.controller
    && navigator.serviceWorker.controller.scriptURL;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const newURL = navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.scriptURL;
    if (priorControllerURL && newURL === priorControllerURL) {
      showToast('Updated — tap to refresh', () => window.location.reload());
    }
    priorControllerURL = newURL;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((reg) => {
      const update = () => reg.update();
      setInterval(update, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) update();
      });
    });
  });
}

function showToast(text, onTap) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.onclick = () => {
    toastEl.hidden = true;
    if (onTap) onTap();
  };
}

// ---------- iOS "add to home screen" hint (no programmatic install API on iOS) ----------

(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = document.documentElement.classList.contains('standalone');
  const dismissed = localStorage.getItem('jig_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('jig_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

// Re-checks IndexedDB rather than trusting whatever boot() saw first: a
// completed or overwritten save must stop being offered the moment the
// player is back at the setup screen, not just on the next cold launch.
async function refreshResumeButton() {
  const saved = await loadGame().catch(() => null);
  if (saved) {
    btnResume.hidden = false;
    btnResume.textContent = `Resume saved puzzle (${saved.solvedCount}/${saved.nPieces})`;
    btnResume.onclick = () => resumeGame(saved);
  } else {
    btnResume.hidden = true;
    btnResume.onclick = null;
  }
}

async function boot() {
  renderPicker();
  await refreshResumeButton();
}

boot();
