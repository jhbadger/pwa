import {
  DIE_TYPES, addDie, removeDie, removeAllOfType, clearPool, totalDiceCount,
  rollPool, sumRolls, isMaxRoll, isMinRoll,
} from './dice.js';
import {
  playAddDie, playRemoveDie, playRollStart, playDieLand, playCritical, playFumble, playClear,
} from './sound.js';

const statusEl = document.getElementById('status');
const pickerEl = document.getElementById('picker');
const poolEl = document.getElementById('pool');
const resultsEl = document.getElementById('results');
const sumEl = document.getElementById('sum');
const statsEl = document.getElementById('stats');
const btnClear = document.getElementById('btnClear');
const btnRoll = document.getElementById('btnRoll');
const toastEl = document.getElementById('toast');

const state = {
  pool: [], // [{ sides, count }]
  lastRolls: null, // [{ sides, value }] from the most recently completed roll, or null
  rolling: false,
  rollCount: 0,
};

// ---------- die-type picker (built once; only its disabled state changes) ----------

const pickerButtons = DIE_TYPES.map((sides) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'die-btn';
  btn.textContent = `d${sides}`;
  btn.setAttribute('aria-label', `Add a d${sides}`);
  btn.addEventListener('click', () => {
    if (state.rolling) return;
    state.pool = addDie(state.pool, sides);
    playAddDie(sides);
    render();
  });
  pickerEl.appendChild(btn);
  return btn;
});

// ---------- rendering ----------

function render() {
  renderPool();
  renderResults();
  renderStats();
  renderStatus();
  renderControls();
}

function renderPool() {
  poolEl.innerHTML = '';
  if (state.pool.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'pool-hint';
    hint.textContent = 'No dice yet — tap d4, d6, d8, d10, d12, d20 or d100 above';
    poolEl.appendChild(hint);
    return;
  }
  for (const { sides, count } of state.pool) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `
      <span class="chip-label">d${sides}</span>
      <span class="chip-count">× ${count}</span>
      <button type="button" class="chip-btn minus" aria-label="Remove one d${sides}">−</button>
      <button type="button" class="chip-btn remove" aria-label="Remove all d${sides}">×</button>
    `;
    const minusBtn = chip.querySelector('.minus');
    const removeBtn = chip.querySelector('.remove');
    minusBtn.disabled = state.rolling;
    removeBtn.disabled = state.rolling;
    minusBtn.addEventListener('click', () => {
      if (state.rolling) return;
      state.pool = removeDie(state.pool, sides);
      playRemoveDie(sides);
      render();
    });
    removeBtn.addEventListener('click', () => {
      if (state.rolling) return;
      state.pool = removeAllOfType(state.pool, sides);
      playRemoveDie(sides);
      render();
    });
    poolEl.appendChild(chip);
  }
}

// Builds the static (post-roll) results grid from state.lastRolls. While a
// roll is animating, the tiles are owned and updated directly by roll() —
// this just bails out so it doesn't fight that in-flight animation.
function renderResults() {
  if (state.rolling) return;
  resultsEl.innerHTML = '';
  if (!state.lastRolls) {
    sumEl.textContent = '';
    return;
  }
  for (const r of state.lastRolls) {
    const tile = document.createElement('div');
    tile.className = `die-tile ${isMaxRoll(r) ? 'max' : ''} ${isMinRoll(r) ? 'min' : ''}`.trim();
    tile.innerHTML = `<span class="die-label">d${r.sides}</span><span class="die-value">${r.value}</span>`;
    resultsEl.appendChild(tile);
  }
  sumEl.textContent = `Sum: ${sumRolls(state.lastRolls)}`;
}

function renderStats() {
  statsEl.textContent = `Rolls: ${state.rollCount}`;
}

function renderStatus() {
  if (state.rolling) {
    statusEl.textContent = 'Rolling…';
  } else if (state.lastRolls) {
    statusEl.textContent = `Rolled ${state.lastRolls.length} ${state.lastRolls.length === 1 ? 'die' : 'dice'}`;
  } else if (state.pool.length === 0) {
    statusEl.textContent = 'Tap a die below to add it to your roll';
  } else {
    statusEl.textContent = 'Tap Roll when ready';
  }
}

function renderControls() {
  const count = totalDiceCount(state.pool);
  btnRoll.disabled = state.rolling || count === 0;
  btnRoll.textContent = state.rolling ? 'Rolling…' : count > 0 ? `Roll ${count} ${count === 1 ? 'die' : 'dice'}` : 'Roll';
  btnClear.disabled = state.rolling || (state.pool.length === 0 && !state.lastRolls);
  for (const btn of pickerButtons) btn.disabled = state.rolling;
}

// ---------- roll animation ----------
//
// Each die tile cycles through random values on its own recursive-setTimeout
// loop (not requestAnimationFrame — the cadence here is 45-150ms per swap,
// far coarser than a frame), with the delay between swaps growing over time
// for an ease-out "settling" feel. Tiles land at staggered times so a big
// pool clatters rather than stopping in lockstep, matching a real handful of
// dice thrown together.

const ROLL_BASE_MS = 480;
const ROLL_STAGGER_MS = 380;

function animateTile(tile, sides, finalValue, duration, onLand) {
  const valueEl = tile.querySelector('.die-value');
  const start = performance.now();
  function tick() {
    const elapsed = performance.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    if (progress >= 1) {
      tile.classList.remove('rolling');
      tile.classList.add('landed');
      setTimeout(() => tile.classList.remove('landed'), 220);
      valueEl.textContent = String(finalValue);
      onLand();
      return;
    }
    valueEl.textContent = String(1 + Math.floor(Math.random() * sides));
    const delay = 45 + progress ** 2 * 105;
    setTimeout(tick, delay);
  }
  tick();
}

function roll() {
  if (state.rolling || totalDiceCount(state.pool) === 0) return;
  const rolls = rollPool(state.pool);

  state.rolling = true;
  state.lastRolls = null;
  render();
  playRollStart(rolls.length);

  resultsEl.innerHTML = '';
  const tiles = rolls.map(({ sides }) => {
    const tile = document.createElement('div');
    tile.className = 'die-tile rolling';
    tile.innerHTML = `<span class="die-label">d${sides}</span><span class="die-value">${sides}</span>`;
    resultsEl.appendChild(tile);
    return tile;
  });

  let landed = 0;
  rolls.forEach((r, i) => {
    const duration = ROLL_BASE_MS + Math.random() * ROLL_STAGGER_MS + i * 12;
    animateTile(tiles[i], r.sides, r.value, duration, () => {
      playDieLand(r.sides);
      tiles[i].classList.toggle('max', isMaxRoll(r));
      tiles[i].classList.toggle('min', isMinRoll(r));
      landed++;
      if (landed === rolls.length) finishRoll(rolls);
    });
  });
}

function finishRoll(rolls) {
  state.rolling = false;
  state.lastRolls = rolls;
  state.rollCount++;
  render();

  const anyNat20 = rolls.some((r) => r.sides === 20 && r.value === 20);
  const anyNat1 = rolls.some((r) => r.sides === 20 && r.value === 1);
  if (anyNat20) playCritical();
  else if (anyNat1) playFumble();
}

function clear() {
  if (state.rolling) return;
  state.pool = clearPool();
  state.lastRolls = null;
  playClear();
  render();
}

// ---------- input ----------

btnRoll.addEventListener('click', roll);
btnClear.addEventListener('click', clear);

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
  const dismissed = localStorage.getItem('dice_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('dice_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
