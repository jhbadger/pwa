import {
  SIZE, isValidCell, cellIndex, coordsOf, createBoard, movesFrom,
  applyMove, pegCount, isSolved, isCenterWin, isStuck,
} from './pegsolitaire.js';
import { playSelect, playDeselect, playJump, playRemove, playUndo, playWin, playPerfectWin, playStuck } from './sound.js';

const statusEl = document.getElementById('status');
const boardEl = document.getElementById('board');
const statsEl = document.getElementById('stats');
const btnUndo = document.getElementById('btnUndo');
const btnNewGame = document.getElementById('btnNewGame');
const toastEl = document.getElementById('toast');

const state = {
  board: createBoard(),
  selected: null, // cell index, or null
  legalTargets: [], // moves available from the selected peg
  history: [], // stack of prior boards, for Undo
  moves: 0,
  phase: 'playing', // 'playing' | 'won' | 'stuck'
};

// Built once; only on-board cells are interactive. Off-board cells (the
// four cut corners) stay in the grid so the CSS grid math is trivial, just
// hidden and inert.
const cellEls = new Array(SIZE * SIZE);
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    const i = cellIndex(r, c);
    const el = document.createElement('div');
    el.className = `cell ${isValidCell(r, c) ? 'on' : 'off'}`;
    el.dataset.index = String(i);
    boardEl.appendChild(el);
    cellEls[i] = el;
  }
}

function renderBoard() {
  for (let i = 0; i < cellEls.length; i++) {
    const el = cellEls[i];
    if (!el.classList.contains('on')) continue;
    el.classList.toggle('selected', state.selected === i);
    el.innerHTML = '';
    if (state.board[i] === 'peg') {
      const peg = document.createElement('div');
      peg.className = 'peg';
      el.appendChild(peg);
    }
    if (state.legalTargets.some((m) => m.to === i)) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      el.appendChild(dot);
    }
  }
}

function renderStatus() {
  statusEl.className = 'status';
  if (state.phase === 'won') {
    statusEl.classList.add('win');
    statusEl.textContent = isCenterWin(state.board)
      ? 'Perfect! One peg, dead center.'
      : 'You win! Down to one peg.';
  } else if (state.phase === 'stuck') {
    statusEl.classList.add('stuck');
    statusEl.textContent = 'No more moves — try Undo or New Game.';
  } else if (state.selected !== null) {
    statusEl.textContent = state.legalTargets.length > 0
      ? 'Tap a highlighted hole to jump'
      : "That peg can't move — tap another";
  } else {
    statusEl.textContent = 'Tap a peg to move';
  }
}

function renderStats() {
  statsEl.textContent = `Pegs left: ${pegCount(state.board)} · Moves: ${state.moves}`;
}

function renderControls() {
  btnUndo.disabled = state.history.length === 0;
}

function render() {
  renderBoard();
  renderStatus();
  renderStats();
  renderControls();
}

// ---------- game actions ----------

function select(i, r, c) {
  state.selected = i;
  state.legalTargets = movesFrom(state.board, r, c);
  render();
  playSelect();
}

function deselect() {
  state.selected = null;
  state.legalTargets = [];
  render();
  playDeselect();
}

function doMove(move) {
  state.history.push(state.board.slice());
  state.board = applyMove(state.board, move);
  state.selected = null;
  state.legalTargets = [];
  state.moves++;
  render();
  playJump();
  setTimeout(playRemove, 90);

  if (isSolved(state.board)) {
    state.phase = 'won';
    render();
    const perfect = isCenterWin(state.board);
    setTimeout(() => (perfect ? playPerfectWin() : playWin()), 220);
  } else if (isStuck(state.board)) {
    state.phase = 'stuck';
    render();
    setTimeout(playStuck, 220);
  }
}

function handleCellClick(i) {
  if (state.phase !== 'playing') return;
  const { r, c } = coordsOf(i);
  const cellValue = state.board[i];

  if (state.selected === i) {
    deselect();
    return;
  }

  const target = state.legalTargets.find((m) => m.to === i);
  if (state.selected !== null && target) {
    doMove(target);
    return;
  }

  if (cellValue === 'peg') {
    select(i, r, c);
    return;
  }

  if (state.selected !== null) deselect();
}

function undo() {
  if (state.history.length === 0) return;
  state.board = state.history.pop();
  state.selected = null;
  state.legalTargets = [];
  state.moves = Math.max(0, state.moves - 1);
  state.phase = 'playing';
  render();
  playUndo();
}

function newGame() {
  state.board = createBoard();
  state.selected = null;
  state.legalTargets = [];
  state.history = [];
  state.moves = 0;
  state.phase = 'playing';
  render();
}

// ---------- input ----------

// Pointer events, not click: the touchstart handler below calls preventDefault()
// to stop iOS's callout bar, and per the touch-event spec that suppresses the
// synthetic click Android would otherwise fire after a tap — pointerdown/up are
// unaffected, so they're what still works there.
let cellPointerDown = null; // { index, x, y }

boardEl.addEventListener('pointerdown', (e) => {
  const cellEl = e.target.closest('.cell.on');
  if (!cellEl) return;
  cellPointerDown = { index: Number(cellEl.dataset.index), x: e.clientX, y: e.clientY };
});

boardEl.addEventListener('pointerup', (e) => {
  if (!cellPointerDown) return;
  const moved = Math.hypot(e.clientX - cellPointerDown.x, e.clientY - cellPointerDown.y) > 8;
  const cellEl = e.target.closest('.cell.on');
  const sameCell = cellEl && Number(cellEl.dataset.index) === cellPointerDown.index;
  if (!moved && sameCell) handleCellClick(cellPointerDown.index);
  cellPointerDown = null;
});

boardEl.addEventListener('pointercancel', () => {
  cellPointerDown = null;
});

btnUndo.addEventListener('click', undo);
btnNewGame.addEventListener('click', newGame);

// Stop iOS's copy/select callout bar from popping up on repeated taps, without
// blocking real clicks on the toolbar buttons.
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button, #toast')) return;
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
  const dismissed = localStorage.getItem('pegsolitaire_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('pegsolitaire_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
