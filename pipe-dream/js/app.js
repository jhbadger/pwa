import {
  ROWS, COLS, createInitialBoard, createQueue, randomPieceType, canPlace, placePiece,
  initialFlowState, stepFlow,
} from './pipedream.js';
import { pieceIconHTML } from './icons.js';
import {
  playPlace, playInvalid, playFlowTick, playCountdownTick, playFlowStart,
  playSpeedUp, playLeak, playNewHighScore,
} from './sound.js';

const statusEl = document.getElementById('status');
const queueTilesEl = document.getElementById('queueTiles');
const boardEl = document.getElementById('board');
const statsEl = document.getElementById('stats');
const btnNewGame = document.getElementById('btnNewGame');
const toastEl = document.getElementById('toast');

const QUEUE_SIZE = 5;
const COUNTDOWN_SECONDS = 15;
const FLOW_TICK_START_MS = 550;
const FLOW_TICK_MIN_MS = 200;
const FLOW_TICK_STEP_MS = 25;
const SPEEDUP_EVERY = 6; // segments flowed between each speed-up
const BEST_KEY = 'pipedream_best';

const state = {
  board: createInitialBoard(),
  queue: createQueue(QUEUE_SIZE),
  phase: 'countdown', // 'countdown' | 'flowing' | 'over'
  countdown: COUNTDOWN_SECONDS,
  flow: initialFlowState(),
  wetSet: new Set(),
  lastFilledIndex: null,
  score: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  tickMs: FLOW_TICK_START_MS,
  newBest: false,
};

let countdownTimer = null;
let flowTimer = null;

// Built once; each cell's content is replaced in place every render().
const cellEls = new Array(ROWS * COLS);
for (let i = 0; i < ROWS * COLS; i++) {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.index = String(i);
  boardEl.appendChild(el);
  cellEls[i] = el;
}

// ---------- rendering ----------

function renderBoard() {
  for (let i = 0; i < cellEls.length; i++) {
    const el = cellEls[i];
    const cell = state.board[i];
    el.className = 'cell';
    el.innerHTML = '';
    if (!cell) {
      el.classList.add('empty');
      continue;
    }
    if (cell.type === 'SOURCE') {
      el.classList.add('source');
      if (state.phase !== 'countdown') el.classList.add('wet');
      el.innerHTML = pieceIconHTML('SOURCE');
      continue;
    }
    el.innerHTML = pieceIconHTML(cell.type);
    if (state.wetSet.has(i)) {
      el.classList.add('wet');
      if (i === state.lastFilledIndex) el.classList.add('pulse');
    }
  }
}

function renderQueue() {
  queueTilesEl.innerHTML = '';
  state.queue.forEach((type, i) => {
    const tile = document.createElement('div');
    tile.className = `queue-tile${i === 0 ? ' next' : ''}`;
    tile.innerHTML = pieceIconHTML(type);
    queueTilesEl.appendChild(tile);
  });
}

function renderStatus() {
  statusEl.className = 'status';
  if (state.phase === 'countdown') {
    if (state.countdown <= 3) statusEl.classList.add('urgent');
    statusEl.textContent = `Flow starts in ${state.countdown}s — lay pipe now`;
  } else if (state.phase === 'flowing') {
    statusEl.textContent = 'Water is flowing — keep the pipe going';
  } else {
    statusEl.classList.add(state.newBest ? 'highscore' : 'lose');
    statusEl.textContent = state.newBest
      ? `New best! Leaked after ${state.score} segments.`
      : `Leak! Final score: ${state.score}`;
  }
}

function renderStats() {
  statsEl.textContent = `Score: ${state.score} · Best: ${state.best}`;
}

function render() {
  renderBoard();
  renderQueue();
  renderStatus();
  renderStats();
}

// ---------- game actions ----------

function placeAt(index) {
  if (state.phase === 'over') return;
  if (!canPlace(state.board, index)) {
    playInvalid();
    return;
  }
  const type = state.queue[0];
  state.board = placePiece(state.board, index, type);
  state.queue = [...state.queue.slice(1), randomPieceType()];
  render();
  playPlace();
}

function startCountdown() {
  countdownTimer = setInterval(() => {
    state.countdown--;
    if (state.countdown <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      startFlowing();
      return;
    }
    if (state.countdown <= 5) playCountdownTick(state.countdown);
    render();
  }, 1000);
}

function startFlowing() {
  state.phase = 'flowing';
  render();
  playFlowStart();
  scheduleFlowTick();
}

function scheduleFlowTick() {
  flowTimer = setTimeout(flowTick, state.tickMs);
}

function flowTick() {
  const result = stepFlow(state.board, state.flow);
  if (result.leak) {
    onLeak();
    return;
  }
  state.flow = result.state;
  state.wetSet.add(result.index);
  state.lastFilledIndex = result.index;
  state.score++;

  const speedingUp = state.score % SPEEDUP_EVERY === 0 && state.tickMs > FLOW_TICK_MIN_MS;
  if (speedingUp) {
    state.tickMs = Math.max(FLOW_TICK_MIN_MS, state.tickMs - FLOW_TICK_STEP_MS);
    playSpeedUp();
  } else {
    playFlowTick();
  }
  render();
  scheduleFlowTick();
}

function onLeak() {
  state.phase = 'over';
  state.newBest = state.score > state.best;
  if (state.newBest) {
    state.best = state.score;
    localStorage.setItem(BEST_KEY, String(state.best));
  }
  render();
  playLeak();
  if (state.newBest) setTimeout(playNewHighScore, 350);
}

function newGame() {
  clearInterval(countdownTimer);
  clearTimeout(flowTimer);
  countdownTimer = null;
  flowTimer = null;

  state.board = createInitialBoard();
  state.queue = createQueue(QUEUE_SIZE);
  state.phase = 'countdown';
  state.countdown = COUNTDOWN_SECONDS;
  state.flow = initialFlowState();
  state.wetSet = new Set();
  state.lastFilledIndex = null;
  state.score = 0;
  state.tickMs = FLOW_TICK_START_MS;
  state.newBest = false;

  render();
  startCountdown();
}

// ---------- input ----------

// Pointer events, not click: the touchstart handler below calls preventDefault()
// to stop iOS's callout bar, and per the touch-event spec that suppresses the
// synthetic click Android would otherwise fire after a tap — pointerdown/up are
// unaffected, so they're what still works there.
let cellPointerDown = null; // { index, x, y }

boardEl.addEventListener('pointerdown', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  cellPointerDown = { index: Number(cellEl.dataset.index), x: e.clientX, y: e.clientY };
});

boardEl.addEventListener('pointerup', (e) => {
  if (!cellPointerDown) return;
  const moved = Math.hypot(e.clientX - cellPointerDown.x, e.clientY - cellPointerDown.y) > 8;
  const cellEl = e.target.closest('.cell');
  const sameCell = cellEl && Number(cellEl.dataset.index) === cellPointerDown.index;
  if (!moved && sameCell) placeAt(cellPointerDown.index);
  cellPointerDown = null;
});

boardEl.addEventListener('pointercancel', () => {
  cellPointerDown = null;
});

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
  const dismissed = localStorage.getItem('pipedream_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('pipedream_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
startCountdown();
