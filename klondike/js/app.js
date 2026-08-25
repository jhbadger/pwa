import {
  SUITS, isRed, rankName, suitSymbol, createGame, topOf, faceUpRunStart,
  isWon, canAutoComplete, drawFromStock, moveWasteToFoundation, moveWasteToTableau,
  moveTableauToFoundation, moveTableauToTableau, moveFoundationToTableau,
  findAutoMove, applyAutoMove,
} from './klondike.js';
import {
  playFlip, playDeal, playPlace, playFoundation, playInvalid, playRecycle,
  playUndo, playWin, playAutoMove,
} from './sound.js';

const appEl = document.querySelector('.app');
const statusEl = document.getElementById('status');
const tableSlotEl = document.getElementById('tableSlot');
const topRowEl = document.getElementById('topRow');
const tableauRowEl = document.getElementById('tableauRow');
const stockEl = document.getElementById('stock');
const wasteEl = document.getElementById('waste');
const statsEl = document.getElementById('stats');
const btnUndo = document.getElementById('btnUndo');
const btnDrawMode = document.getElementById('btnDrawMode');
const btnAuto = document.getElementById('btnAuto');
const btnNewGame = document.getElementById('btnNewGame');
const toastEl = document.getElementById('toast');
const winOverlayEl = document.getElementById('winOverlay');
const winMovesEl = document.getElementById('winMoves');
const btnWinNewGame = document.getElementById('btnWinNewGame');

const foundationEls = {};
for (const suit of SUITS) foundationEls[suit] = document.getElementById(`f-${suit}`);

const columnEls = [];
for (let c = 0; c < 7; c++) {
  const col = document.createElement('div');
  col.className = 'column';
  col.dataset.col = String(c);
  tableauRowEl.appendChild(col);
  columnEls.push(col);
}

const DOUBLE_TAP_MS = 350;
const savedDrawCount = Number(localStorage.getItem('klondike_drawcount')) === 3 ? 3 : 1;

const state = {
  game: createGame(savedDrawCount),
  selected: null, // { type: 'waste' | 'tableau' | 'foundation', col, cardIndex, suit }
  selectedAt: 0,
  history: [],
  moves: 0,
  autoRunning: false,
};

// ---------- layout ----------

// Below this, a stacked card's rank/suit corner is too thin a sliver to
// read, so the fan step never shrinks past it even if a very deep column
// then runs past the nominal available height.
const MIN_DOWN_STEP = 9;
const MIN_UP_STEP = 17;

function computeLayout() {
  const rowRect = tableauRowEl.getBoundingClientRect();
  const totalWidth = rowRect.width;
  const gap = Math.max(6, Math.min(14, totalWidth * 0.022));
  // Leave a little breathing room instead of tiling cards fully edge to
  // edge — smaller cards give a stacked column more headroom before its
  // fan step has to shrink to fit.
  const cardW = ((totalWidth - gap * 6) / 7) * 0.92;
  const cardH = cardW * 1.4;

  appEl.style.setProperty('--card-w', `${cardW}px`);
  appEl.style.setProperty('--card-h', `${cardH}px`);
  appEl.style.setProperty('--gap', `${gap}px`);

  // The ceiling the tableau is allowed to grow to, measured from the slot
  // itself rather than the row — the row is sized to its own content
  // (flex: 0 0 auto), so measuring the row would just echo last render.
  const slotHeight = tableSlotEl.getBoundingClientRect().height;
  const topRowHeight = topRowEl.getBoundingClientRect().height;
  const availableHeight = Math.max(cardH, slotHeight - topRowHeight - 8);
  const prefDownStep = Math.max(cardH * 0.16, MIN_DOWN_STEP);
  const prefUpStep = Math.max(cardH * 0.34, MIN_UP_STEP);

  function stepsFor(pile, downStep, upStep) {
    const tops = [0];
    for (let i = 1; i < pile.length; i++) {
      tops.push(tops[i - 1] + (pile[i].faceUp ? upStep : downStep));
    }
    return tops;
  }

  let maxNeeded = cardH;
  for (const pile of state.game.tableau) {
    const tops = stepsFor(pile, prefDownStep, prefUpStep);
    const needed = cardH + (tops.length ? tops[tops.length - 1] : 0);
    if (needed > maxNeeded) maxNeeded = needed;
  }

  // Shrink the fan only if there's slack to give up, and never past the
  // legibility floors above — a very deep column is allowed to run past
  // the nominal available height rather than crush its cards unreadable.
  let scale = 1;
  if (maxNeeded > availableHeight && maxNeeded > cardH) {
    scale = Math.max(0.15, (availableHeight - cardH) / (maxNeeded - cardH));
  }

  const downStep = Math.max(prefDownStep * scale, MIN_DOWN_STEP);
  const upStep = Math.max(prefUpStep * scale, MIN_UP_STEP);

  let colHeight = cardH;
  const tops = state.game.tableau.map((pile) => {
    const t = stepsFor(pile, downStep, upStep);
    const needed = cardH + (t.length ? t[t.length - 1] : 0);
    if (needed > colHeight) colHeight = needed;
    return t;
  });
  appEl.style.setProperty('--col-h', `${colHeight}px`);
  return tops;
}

// ---------- rendering ----------

function cardEl(card, extraClass) {
  const el = document.createElement('div');
  el.className = `card ${isRed(card.suit) ? 'red' : 'black'} ${card.faceUp ? '' : 'face-down'} ${extraClass || ''}`.trim();
  if (card.faceUp) {
    const rank = rankName(card.rank);
    const suit = suitSymbol(card.suit);
    el.innerHTML = `<div class="corner top-left"><span class="rank">${rank}</span><span class="suit">${suit}</span></div>`
      + `<div class="pip">${suit}</div>`
      + `<div class="corner bottom-right"><span class="rank">${rank}</span><span class="suit">${suit}</span></div>`;
  }
  return el;
}

function isSelected(type, col, cardIndex, suit) {
  const s = state.selected;
  if (!s || s.type !== type) return false;
  if (type === 'tableau') return s.col === col && cardIndex >= s.cardIndex;
  if (type === 'foundation') return s.suit === suit;
  return true; // waste
}

function render() {
  renderStock();
  renderWaste();
  renderFoundations();
  renderTableau();
  renderStatus();
  renderStats();
  renderControls();
}

function renderStock() {
  stockEl.innerHTML = '';
  stockEl.classList.toggle('empty-slot', state.game.stock.length === 0);
  if (state.game.stock.length === 0) {
    if (state.game.waste.length > 0) {
      const glyph = document.createElement('div');
      glyph.className = 'slot-glyph';
      glyph.textContent = '↺';
      stockEl.appendChild(glyph);
    }
    return;
  }
  const top = topOf(state.game.stock);
  stockEl.appendChild(cardEl(top));
}

function renderWaste() {
  wasteEl.innerHTML = '';
  wasteEl.classList.toggle('empty-slot', state.game.waste.length === 0);
  if (state.game.waste.length === 0) return;
  const fanCount = Math.min(state.game.waste.length, state.game.drawCount === 3 ? 3 : 1);
  const start = state.game.waste.length - fanCount;
  for (let i = start; i < state.game.waste.length; i++) {
    const card = state.game.waste[i];
    const isTop = i === state.game.waste.length - 1;
    const el = cardEl(card, isSelected('waste') && isTop ? 'selected' : '');
    el.style.left = `calc(var(--card-w) * ${0.18 * (i - start)})`;
    el.style.zIndex = String(i - start);
    wasteEl.appendChild(el);
  }
}

function renderFoundations() {
  for (const suit of SUITS) {
    const el = foundationEls[suit];
    el.innerHTML = '';
    const pile = state.game.foundations[suit];
    el.classList.toggle('empty-slot', pile.length === 0);
    if (pile.length === 0) {
      const glyph = document.createElement('div');
      glyph.className = 'slot-glyph';
      glyph.textContent = suitSymbol(suit);
      el.appendChild(glyph);
      continue;
    }
    const top = topOf(pile);
    el.appendChild(cardEl(top, `foundation-card ${isSelected('foundation', null, null, suit) ? 'selected' : ''}`));
  }
}

function renderTableau() {
  const layout = computeLayout();
  for (let c = 0; c < 7; c++) {
    const col = columnEls[c];
    col.innerHTML = '';
    const pile = state.game.tableau[c];
    const tops = layout[c];
    for (let i = 0; i < pile.length; i++) {
      const card = pile[i];
      const el = cardEl(card, isSelected('tableau', c, i) ? 'selected' : '');
      el.dataset.index = String(i);
      el.style.top = `${tops[i]}px`;
      el.style.zIndex = String(i);
      col.appendChild(el);
    }
  }
}

function renderStatus() {
  statusEl.className = 'status';
  if (isWon(state.game)) {
    statusEl.classList.add('win');
    statusEl.textContent = 'You win!';
  } else if (state.selected) {
    statusEl.textContent = 'Tap a pile to move the selected card';
  } else {
    statusEl.textContent = 'Tap a card to select it';
  }
}

function renderStats() {
  statsEl.textContent = `Moves: ${state.moves}`;
}

function renderControls() {
  btnUndo.disabled = state.history.length === 0 || state.autoRunning;
  btnDrawMode.querySelector('span').textContent = state.game.drawCount === 3 ? 'Draw 3' : 'Draw 1';
  btnAuto.disabled = state.autoRunning || !canAutoComplete(state.game);
}

// ---------- game actions ----------

function pushHistory() {
  state.history.push(state.game);
}

function clearSelection() {
  state.selected = null;
}

function commit(nextGame, { sound, flipped } = {}) {
  pushHistory();
  state.game = nextGame;
  state.moves++;
  clearSelection();
  render();
  if (sound) sound();
  if (flipped) setTimeout(playFlip, 90);
  checkWin();
}

function checkWin() {
  if (isWon(state.game)) {
    setTimeout(() => {
      playWin();
      winMovesEl.textContent = `Solved in ${state.moves} moves.`;
      winOverlayEl.hidden = false;
    }, 200);
  }
}

function handleStockTap() {
  const wasRecycle = state.game.stock.length === 0 && state.game.waste.length > 0;
  const next = drawFromStock(state.game);
  if (!next) return;
  clearSelection();
  pushHistory();
  state.game = next;
  render();
  if (wasRecycle) playRecycle();
  else playDeal();
}

function trySelect(info) {
  if (info.type === 'waste') {
    if (state.game.waste.length === 0) return false;
    state.selected = { type: 'waste' };
    state.selectedAt = Date.now();
    return true;
  }
  if (info.type === 'foundation') {
    if (state.game.foundations[info.suit].length === 0) return false;
    state.selected = { type: 'foundation', suit: info.suit };
    state.selectedAt = Date.now();
    return true;
  }
  if (info.type === 'tableau') {
    if (info.cardIndex === null) return false;
    const pile = state.game.tableau[info.col];
    const card = pile[info.cardIndex];
    if (!card || !card.faceUp) return false;
    if (info.cardIndex < faceUpRunStart(pile)) return false;
    state.selected = { type: 'tableau', col: info.col, cardIndex: info.cardIndex };
    state.selectedAt = Date.now();
    return true;
  }
  return false;
}

// A move that empties a tableau run reveals the card below it, unless that
// card was already face up. Checked against the pre-move state so it can be
// known before the move function runs.
function willFlip(sel) {
  if (sel.type !== 'tableau' || sel.cardIndex === 0) return false;
  return !state.game.tableau[sel.col][sel.cardIndex - 1].faceUp;
}

function attemptMove(sel, info) {
  const flipped = willFlip(sel);
  if (info.type === 'foundation') {
    if (sel.type === 'waste') return { game: moveWasteToFoundation(state.game), toFoundation: true, flipped: false };
    if (sel.type === 'tableau') return { game: moveTableauToFoundation(state.game, sel.col), toFoundation: true, flipped };
    return { game: null };
  }
  if (info.type === 'tableau') {
    if (sel.type === 'waste') return { game: moveWasteToTableau(state.game, info.col), toFoundation: false, flipped: false };
    if (sel.type === 'tableau') return { game: moveTableauToTableau(state.game, sel.col, sel.cardIndex, info.col), toFoundation: false, flipped };
    if (sel.type === 'foundation') return { game: moveFoundationToTableau(state.game, sel.suit, info.col), toFoundation: false, flipped: false };
  }
  return { game: null };
}

function tryAutoSendToFoundation(sel) {
  if (sel.type === 'waste') return moveWasteToFoundation(state.game);
  if (sel.type === 'tableau') return moveTableauToFoundation(state.game, sel.col);
  return null;
}

function handlePileTap(info) {
  if (state.autoRunning || isWon(state.game)) return;
  if (info === null) return;

  if (info.type === 'stock') {
    handleStockTap();
    return;
  }

  const sel = state.selected;

  if (sel) {
    const sameSource = (sel.type === 'waste' && info.type === 'waste')
      || (sel.type === 'foundation' && info.type === 'foundation' && sel.suit === info.suit)
      || (sel.type === 'tableau' && info.type === 'tableau' && sel.col === info.col && sel.cardIndex === info.cardIndex);

    if (sameSource) {
      const quick = Date.now() - state.selectedAt < DOUBLE_TAP_MS;
      if (quick) {
        const next = tryAutoSendToFoundation(sel);
        if (next) {
          commit(next, { sound: playFoundation, flipped: willFlip(sel) });
          return;
        }
      }
      clearSelection();
      render();
      return;
    }

    // Tapped a different card within the same tableau column: reselect a
    // narrower/wider run instead of attempting to drop a pile on itself.
    if (sel.type === 'tableau' && info.type === 'tableau' && sel.col === info.col) {
      trySelect(info);
      render();
      return;
    }

    const { game: next, toFoundation, flipped } = attemptMove(sel, info);
    if (next) {
      commit(next, { sound: toFoundation ? playFoundation : playPlace, flipped });
      return;
    }

    playInvalid();
    if (!trySelect(info)) clearSelection();
    render();
    return;
  }

  trySelect(info);
  render();
}

function resolveClickInfo(el) {
  const pileEl = el.closest('.pile');
  if (pileEl) {
    if (pileEl === stockEl) return { type: 'stock' };
    if (pileEl === wasteEl) return { type: 'waste' };
    if (pileEl.classList.contains('foundation')) return { type: 'foundation', suit: pileEl.dataset.suit };
  }
  const colEl = el.closest('.column');
  if (colEl) {
    const col = Number(colEl.dataset.col);
    const cardElHit = el.closest('.card');
    const cardIndex = cardElHit && colEl.contains(cardElHit) ? Number(cardElHit.dataset.index) : null;
    return { type: 'tableau', col, cardIndex };
  }
  return null;
}

function undo() {
  if (state.history.length === 0 || state.autoRunning) return;
  state.game = state.history.pop();
  state.moves = Math.max(0, state.moves - 1);
  clearSelection();
  render();
  playUndo();
}

function newGame() {
  state.game = createGame(state.game.drawCount);
  state.history = [];
  state.moves = 0;
  clearSelection();
  winOverlayEl.hidden = true;
  render();
}

function toggleDrawMode() {
  if (state.autoRunning) return;
  const next = state.game.drawCount === 3 ? 1 : 3;
  state.game = { ...state.game, drawCount: next };
  localStorage.setItem('klondike_drawcount', String(next));
  render();
}

function autoComplete() {
  if (state.autoRunning || !canAutoComplete(state.game)) return;
  state.autoRunning = true;
  pushHistory();
  clearSelection();
  render();
  let i = 0;
  const step = () => {
    const move = findAutoMove(state.game);
    if (!move) {
      state.autoRunning = false;
      state.moves++;
      render();
      checkWin();
      return;
    }
    state.game = applyAutoMove(state.game, move);
    playAutoMove(i++);
    render();
    setTimeout(step, 110);
  };
  step();
}

// ---------- input ----------

let pointerDown = null; // { x, y }

tableSlotEl.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, target: e.target };
});

tableSlotEl.addEventListener('pointerup', (e) => {
  if (!pointerDown) return;
  const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 8;
  pointerDown = null;
  if (moved) return;
  const info = resolveClickInfo(e.target);
  handlePileTap(info);
});

tableSlotEl.addEventListener('pointercancel', () => {
  pointerDown = null;
});

btnUndo.addEventListener('click', undo);
btnDrawMode.addEventListener('click', toggleDrawMode);
btnAuto.addEventListener('click', autoComplete);
btnNewGame.addEventListener('click', newGame);
btnWinNewGame.addEventListener('click', newGame);

document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button, #toast')) return;
  e.preventDefault();
}, { passive: false });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 80);
});

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
  const dismissed = localStorage.getItem('klondike_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('klondike_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
