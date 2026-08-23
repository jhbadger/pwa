import {
  DIFFICULTIES, createGrid, cellIndex, placeMines, revealCell, chordReveal,
  toggleFlag, countFlags, checkWin, revealAllMines,
} from './minesweeper.js';
import { FLAG_SVG, WRONG_FLAG_SVG, MINE_SVG } from './icons.js';
import { playReveal, playCascade, playFlag, playUnflag, playChord, playExplosion, playWin } from './sound.js';

const statusEl = document.getElementById('status');
const difficultyRowEl = document.getElementById('difficultyRow');
const boardWrapEl = document.getElementById('boardWrap');
const boardEl = document.getElementById('board');
const statsEl = document.getElementById('stats');
const btnNewGame = document.getElementById('btnNewGame');
const toastEl = document.getElementById('toast');

const state = {
  difficulty: 'beginner',
  rows: 0,
  cols: 0,
  mines: 0,
  grid: [],
  phase: 'ready', // 'ready' | 'playing' | 'won' | 'lost'
  flagsUsed: 0,
  elapsed: 0,
  startTime: 0,
  minesPlaced: false,
  explodedIndex: null,
};

let cellEls = [];
let timerInterval = null;

function coordsOf(index) {
  return { r: Math.floor(index / state.cols), c: index % state.cols };
}

function cellIconHTML(kind) {
  const body = kind === 'flag' ? FLAG_SVG : kind === 'wrongFlag' ? WRONG_FLAG_SVG : MINE_SVG;
  return `<svg class="cell-icon" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}

// ---------- board sizing ----------
//
// Cell size is computed in JS, not CSS, because the grid's row/column count
// varies by difficulty (9x9 up to 30x16) — a plain aspect-ratio/cqw
// approach can't size a non-square grid to fit whatever space is left after
// the header/stats/toolbar. When even the minimum cell size doesn't fit
// (Expert on a narrow phone), the board-wrap's overflow:auto lets it scroll
// instead of squeezing cells into illegible slivers.
const MIN_CELL = 18;
const MAX_CELL = 42;

const BASE_PAD = 10; // .board-wrap's CSS padding, each side

function resizeBoard() {
  const frame = 8; // .board's 4px border on each side
  const availW = boardWrapEl.clientWidth - BASE_PAD * 2 - frame;
  const availH = boardWrapEl.clientHeight - BASE_PAD * 2 - frame;
  const raw = Math.floor(Math.min(availW / state.cols, availH / state.rows));
  const cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, raw));
  boardEl.style.setProperty('--cell-size', `${cellSize}px`);
  boardEl.style.gridTemplateColumns = `repeat(${state.cols}, ${cellSize}px)`;
  boardEl.style.gridTemplateRows = `repeat(${state.rows}, ${cellSize}px)`;

  // Vertical centering via computed padding rather than flex/grid alignment:
  // align-items/justify-content: center combined with overflow: auto has a
  // long-standing cross-browser bug where content larger than its container
  // gets clipped at the start with no way to scroll to it. Padding on a
  // plain block container has no such bug, and degrades to "just scrolls"
  // once the board is taller than the wrap (padding computes to 0).
  const boardH = state.rows * cellSize + (state.rows - 1) + frame;
  const extra = Math.max(0, boardWrapEl.clientHeight - boardH - BASE_PAD * 2);
  boardWrapEl.style.paddingTop = `${BASE_PAD + Math.floor(extra / 2)}px`;
}

window.addEventListener('resize', resizeBoard);
window.addEventListener('orientationchange', () => setTimeout(resizeBoard, 50));

function buildBoardDOM() {
  boardEl.innerHTML = '';
  cellEls = new Array(state.rows * state.cols);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < state.rows * state.cols; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.index = String(i);
    frag.appendChild(el);
    cellEls[i] = el;
  }
  boardEl.appendChild(frag);
  resizeBoard();
}

// ---------- rendering ----------

function renderCell(index) {
  const el = cellEls[index];
  const cell = state.grid[index];
  el.className = 'cell';
  if (cell.revealed) {
    el.classList.add('revealed');
    if (cell.mine) {
      el.classList.add('mine');
      if (index === state.explodedIndex) el.classList.add('exploded');
      el.innerHTML = cellIconHTML('mine');
    } else if (cell.adjacent > 0) {
      el.classList.add(`n${cell.adjacent}`);
      el.textContent = String(cell.adjacent);
    } else {
      el.innerHTML = '';
    }
  } else if (cell.flagged) {
    const wrong = state.phase === 'lost' && !cell.mine;
    el.innerHTML = cellIconHTML(wrong ? 'wrongFlag' : 'flag');
  } else {
    el.innerHTML = '';
  }
}

function renderBoard() {
  for (let i = 0; i < state.grid.length; i++) renderCell(i);
}

function renderStatus() {
  statusEl.className = 'status';
  if (state.phase === 'ready') statusEl.textContent = 'Tap any cell to start';
  else if (state.phase === 'playing') statusEl.textContent = 'Long-press or right-click to flag';
  else if (state.phase === 'won') { statusEl.classList.add('win'); statusEl.textContent = 'You win!'; }
  else { statusEl.classList.add('lose'); statusEl.textContent = 'Boom! Game over.'; }
}

function renderStats() {
  const remaining = state.mines - state.flagsUsed;
  const mm = Math.floor(state.elapsed / 60);
  const ss = String(state.elapsed % 60).padStart(2, '0');
  statsEl.textContent = `Mines left: ${remaining} · Time: ${mm}:${ss}`;
}

function renderDifficultyRow() {
  difficultyRowEl.innerHTML = '';
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `diff-btn${key === state.difficulty ? ' active' : ''}`;
    btn.textContent = d.label;
    btn.addEventListener('click', () => newGame(key));
    difficultyRowEl.appendChild(btn);
  }
}

function render() {
  renderStatus();
  renderBoard();
  renderStats();
}

// ---------- timer ----------

function startTimer() {
  state.startTime = Date.now();
  timerInterval = setInterval(() => {
    state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    renderStats();
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ---------- game actions ----------

function newGame(diffKey) {
  stopTimer();
  const d = DIFFICULTIES[diffKey];
  state.difficulty = diffKey;
  state.rows = d.rows;
  state.cols = d.cols;
  state.mines = d.mines;
  state.grid = createGrid(d.rows, d.cols);
  state.phase = 'ready';
  state.flagsUsed = 0;
  state.elapsed = 0;
  state.minesPlaced = false;
  state.explodedIndex = null;
  buildBoardDOM();
  renderDifficultyRow();
  render();
}

function onLose() {
  state.phase = 'lost';
  stopTimer();
  revealAllMines(state.grid);
  render();
  playExplosion();
}

function onWin() {
  state.phase = 'won';
  stopTimer();
  for (const cell of state.grid) if (cell.mine) cell.flagged = true;
  state.flagsUsed = countFlags(state.grid);
  render();
  playWin();
}

function doReveal(r, c) {
  if (!state.minesPlaced) {
    placeMines(state.grid, state.rows, state.cols, state.mines, r, c);
    state.minesPlaced = true;
    state.phase = 'playing';
    startTimer();
  }
  const { hitMine, revealed } = revealCell(state.grid, state.rows, state.cols, r, c);
  if (hitMine) {
    state.explodedIndex = cellIndex(r, c, state.cols);
    onLose();
    return;
  }
  if (revealed.length > 1) playCascade(revealed.length);
  else if (revealed.length === 1) playReveal();
  if (checkWin(state.grid)) { onWin(); return; }
  render();
}

function doChord(r, c) {
  const { hitMine, revealed } = chordReveal(state.grid, state.rows, state.cols, r, c);
  if (hitMine) {
    state.explodedIndex = revealed.find((i) => state.grid[i].mine) ?? null;
    onLose();
    return;
  }
  if (revealed.length > 0) playChord();
  if (checkWin(state.grid)) { onWin(); return; }
  render();
}

function handleTap(index) {
  if (state.phase === 'won' || state.phase === 'lost') return;
  const cell = state.grid[index];
  const { r, c } = coordsOf(index);
  if (!cell.revealed) {
    if (cell.flagged) return; // must unflag first — no accidental reveals
    doReveal(r, c);
  } else if (cell.adjacent > 0) {
    doChord(r, c);
  }
}

function handleFlagToggle(index) {
  if (state.phase === 'won' || state.phase === 'lost') return;
  const { r, c } = coordsOf(index);
  const newFlagged = toggleFlag(state.grid, r, c, state.cols);
  if (newFlagged === null) return; // already revealed, nothing to flag
  state.flagsUsed = countFlags(state.grid);
  render();
  if (newFlagged) playFlag(); else playUnflag();
}

// ---------- input ----------
//
// Tap reveals (or chords, on an already-revealed number); long-press or
// right-click flags. Pointer events, not click — see the touchstart handler
// below for why. A long-press is a JS timer started on pointerdown and
// cancelled on any real movement, so dragging to scroll the board (Expert
// mode routinely needs this) never gets misread as a flag.
const LONG_PRESS_MS = 420;
const MOVE_THRESHOLD = 10;
let longPressTimer = null;
let pointerStart = null; // { pointerId, index, x, y, longPressed }

boardEl.addEventListener('pointerdown', (e) => {
  if (state.phase === 'won' || state.phase === 'lost') return;
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  const index = Number(cellEl.dataset.index);
  pointerStart = { pointerId: e.pointerId, index, x: e.clientX, y: e.clientY, longPressed: false };
  longPressTimer = setTimeout(() => {
    if (!pointerStart || pointerStart.pointerId !== e.pointerId) return;
    pointerStart.longPressed = true;
    handleFlagToggle(pointerStart.index);
  }, LONG_PRESS_MS);
});

boardEl.addEventListener('pointermove', (e) => {
  if (!pointerStart || pointerStart.pointerId !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
  if (moved > MOVE_THRESHOLD) {
    clearTimeout(longPressTimer);
    pointerStart = null;
  }
});

boardEl.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
  if (!pointerStart || pointerStart.pointerId !== e.pointerId) { pointerStart = null; return; }
  const { index, longPressed } = pointerStart;
  pointerStart = null;
  if (longPressed) return;
  handleTap(index);
});

boardEl.addEventListener('pointercancel', () => {
  clearTimeout(longPressTimer);
  pointerStart = null;
});

boardEl.addEventListener('contextmenu', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  e.preventDefault();
  handleFlagToggle(Number(cellEl.dataset.index));
});

btnNewGame.addEventListener('click', () => newGame(state.difficulty));

// Stop iOS's copy/select callout bar from popping up on repeated taps,
// without blocking real clicks on buttons or native scrolling of the board
// (Expert mode routinely needs to scroll — the CSS half of the suppression,
// -webkit-touch-callout/-webkit-user-select in style.css, still applies
// inside the board even though this JS half is skipped there).
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button, #toast, #boardWrap')) return;
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
  const dismissed = localStorage.getItem('minesweeper_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('minesweeper_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

newGame(state.difficulty);
