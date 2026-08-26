import {
  TYPE_BY_ID, buildLayout, dealNewGame, isFree, canMatch, findValidPair,
  hasAnyMove, reshuffleRemaining,
} from './tiles.js';

// Tile pixel footprint — keep in sync with the .tile width/height in css/style.css.
const TILE_W = 44;
const TILE_H = 60;
// Per-layer pixel nudge (up-and-left) that gives the stack its pseudo-3D "steps"
// look. Purely cosmetic — the underlying board is a flat logical grid.
const LAYER_DX = -3;
const LAYER_DY = -4;

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const toastEl = document.getElementById('toast');
const btnNew = document.getElementById('btnNew');
const btnUndo = document.getElementById('btnUndo');
const btnHint = document.getElementById('btnHint');
const btnShuffle = document.getElementById('btnShuffle');

// The 144 board slots never change shape between games — only which tile type
// lands in each slot does — so pixel positions are computed once and the same
// 144 DOM elements are reused (repopulated) by every newGame().
const LAYOUT = buildLayout();
const { screenPositions, width: boardWidth, height: boardHeight } = layoutToScreen(LAYOUT);

function layoutToScreen(layout) {
  const raw = layout.map((p) => ({
    left: (p.x / 2) * TILE_W + p.layer * LAYER_DX,
    top: (p.y / 2) * TILE_H + p.layer * LAYER_DY,
    zIndex: p.layer * 10,
  }));
  const minLeft = Math.min(...raw.map((r) => r.left));
  const minTop = Math.min(...raw.map((r) => r.top));
  const maxLeft = Math.max(...raw.map((r) => r.left));
  const maxTop = Math.max(...raw.map((r) => r.top));
  const offsetX = -minLeft + TILE_W;
  const offsetY = -minTop + TILE_H;
  raw.forEach((r) => { r.left += offsetX; r.top += offsetY; });
  return {
    screenPositions: raw,
    width: maxLeft - minLeft + TILE_W * 3,
    height: maxTop - minTop + TILE_H * 3,
  };
}

boardEl.style.width = `${boardWidth}px`;
boardEl.style.height = `${boardHeight}px`;

const tileEls = LAYOUT.map((_, id) => {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = String(id);
  const pos = screenPositions[id];
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.style.zIndex = String(pos.zIndex);
  const face = document.createElement('span');
  face.className = 'glyph';
  el.appendChild(face);
  boardEl.appendChild(el);
  return el;
});

const state = {
  tiles: [],
  index: null,
  selectedId: null,
  hintIds: [],
  history: [],
  matchedPairs: 0,
  startTime: 0,
  elapsedSec: 0,
  timerId: null,
  won: false,
  stuck: false,
  deadlock: false,
};

// ---------- game actions ----------

function newGame() {
  stopTimer();
  const { tiles, index } = dealNewGame();
  state.tiles = tiles;
  state.index = index;
  state.selectedId = null;
  state.hintIds = [];
  state.history = [];
  state.matchedPairs = 0;
  state.elapsedSec = 0;
  state.won = false;
  state.stuck = false;
  state.deadlock = false;
  state.startTime = Date.now();
  state.timerId = setInterval(tick, 1000);
  render();
}

function tick() {
  state.elapsedSec = Math.floor((Date.now() - state.startTime) / 1000);
  renderStats();
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function checkGameStatus() {
  const remaining = state.tiles.filter((t) => !t.removed).length;
  if (remaining === 0) {
    state.won = true;
    state.stuck = false;
    state.deadlock = false;
    stopTimer();
    return;
  }
  const move = hasAnyMove(state.tiles, state.index);
  state.stuck = !move && remaining > 2;
  state.deadlock = !move && remaining <= 2;
}

function selectTile(id) {
  if (state.won) return;
  const tile = state.tiles[id];
  if (!tile || tile.removed) return;
  state.hintIds = [];

  if (!isFree(state.index, tile)) return;

  if (state.selectedId === null) {
    state.selectedId = id;
  } else if (state.selectedId === id) {
    state.selectedId = null;
  } else {
    const a = state.tiles[state.selectedId];
    if (canMatch(a, tile)) {
      a.removed = true;
      tile.removed = true;
      state.history.push([a.id, tile.id]);
      state.matchedPairs++;
      state.selectedId = null;
      checkGameStatus();
    } else {
      state.selectedId = id;
    }
  }
  render();
}

function undo() {
  if (state.history.length === 0) return;
  const [aId, bId] = state.history.pop();
  state.tiles[aId].removed = false;
  state.tiles[bId].removed = false;
  state.matchedPairs--;
  state.selectedId = null;
  state.hintIds = [];
  if (state.won) {
    state.won = false;
    state.startTime = Date.now() - state.elapsedSec * 1000;
    state.timerId = setInterval(tick, 1000);
  }
  checkGameStatus();
  render();
}

function hint() {
  const pair = findValidPair(state.tiles, state.index);
  if (!pair) {
    showToast(state.deadlock ? "These last two tiles don't match" : 'No moves left — try Shuffle');
    return;
  }
  state.hintIds = [pair[0].id, pair[1].id];
  render();
  setTimeout(() => {
    state.hintIds = [];
    render();
  }, 1500);
}

function doShuffle() {
  const solved = reshuffleRemaining(state.tiles, state.index);
  state.selectedId = null;
  state.hintIds = [];
  checkGameStatus();
  render();
  if (!solved) showToast("Can't find a move for these tiles — try New Game");
}

// ---------- rendering ----------

function render() {
  for (const tile of state.tiles) {
    const el = tileEls[tile.id];
    if (tile.removed) {
      el.classList.add('removed');
      continue;
    }
    el.classList.remove('removed');
    const type = TYPE_BY_ID[tile.typeId];
    const face = el.querySelector('.glyph');
    if (face.textContent !== type.glyph) face.textContent = type.glyph;
    face.className = `glyph suit-${type.suit}`;
    el.title = type.name;
    const free = isFree(state.index, tile);
    el.classList.toggle('free', free);
    el.classList.toggle('blocked', !free);
    el.classList.toggle('selected', state.selectedId === tile.id);
    el.classList.toggle('hint', state.hintIds.includes(tile.id));
  }
  renderStatus();
  renderStats();
  btnUndo.disabled = state.history.length === 0;
  btnHint.disabled = state.won;
  btnShuffle.disabled = state.won;
}

function renderStatus() {
  statusEl.classList.remove('win', 'warn');
  if (state.won) {
    statusEl.textContent = `You win! Cleared in ${formatTime(state.elapsedSec)}`;
    statusEl.classList.add('win');
  } else if (state.deadlock) {
    statusEl.textContent = "Stuck — these last two tiles don't match. Start a New Game.";
    statusEl.classList.add('warn');
  } else if (state.stuck) {
    statusEl.textContent = 'No moves left — tap Shuffle to continue';
    statusEl.classList.add('warn');
  } else {
    statusEl.textContent = 'Tap two matching free tiles';
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderStats() {
  const remaining = state.tiles.filter((t) => !t.removed).length;
  statsEl.textContent = `Tiles left: ${remaining} · Pairs: ${state.matchedPairs} · Time: ${formatTime(state.elapsedSec)}`;
}

// ---------- input ----------

// Pointer events, not click: the touchstart handler below calls preventDefault()
// to stop iOS's callout bar, which per the touch-event spec also suppresses the
// synthetic click Android would otherwise fire after a tap — pointerdown/up are
// unaffected. (Same fix as videopoker's card-hold taps.)
let tilePointerDown = null;

boardEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.tile');
  if (!el) return;
  tilePointerDown = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY };
});

boardEl.addEventListener('pointerup', (e) => {
  if (!tilePointerDown) return;
  const moved = Math.hypot(e.clientX - tilePointerDown.x, e.clientY - tilePointerDown.y) > 8;
  const el = e.target.closest('.tile');
  const sameTile = el && Number(el.dataset.id) === tilePointerDown.id;
  if (!moved && sameTile) selectTile(tilePointerDown.id);
  tilePointerDown = null;
});

boardEl.addEventListener('pointercancel', () => {
  tilePointerDown = null;
});

btnNew.addEventListener('click', newGame);
btnUndo.addEventListener('click', undo);
btnHint.addEventListener('click', hint);
btnShuffle.addEventListener('click', doShuffle);

// Stop iOS's copy/select callout bar from popping up on repeated taps, without
// blocking real clicks on the toolbar buttons or native scrolling on the board
// (the board needs real touchmove-driven scroll, which a touchstart preventDefault
// would break, so it's exempted here the same way buttons are).
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button') || e.target.closest('#boardWrap') || e.target.closest('#toast')) return;
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
  const dismissed = localStorage.getItem('sh_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('sh_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

newGame();
