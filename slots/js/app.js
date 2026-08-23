import { Bet, StartMoney, PAY_TABLE, SYMBOLS, rollReels, evaluateSpin, isJackpot } from './slots.js';
import { symbolIconHTML } from './symbols.js';
import { playLeverPull, playSpinLoop, playReelStop, playWin, playJackpot, playLose, playOutOfMoney } from './sound.js';

const reelsEl = document.getElementById('reels');
const leverEl = document.getElementById('lever');
const resultEl = document.getElementById('result');
const paytableEl = document.getElementById('paytable');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');
const btnSpin = document.getElementById('btnSpin');
const btnRestart = document.getElementById('btnRestart');
const toastEl = document.getElementById('toast');

const state = {
  reels: ['bar', 'bell', 'plum'], // arbitrary at-rest display before the first spin
  phase: 'idle', // 'idle' | 'spinning' | 'over'
  lastResult: null, // { key, payout, label } | null
  money: StartMoney,
  spins: 0,
  won: 0,
};

// Built once; each reel window's symbol is swapped in place.
const reelStripEls = [];
for (let i = 0; i < 3; i++) {
  const win = document.createElement('div');
  win.className = 'reel-window';
  const strip = document.createElement('div');
  strip.className = 'reel-strip';
  win.appendChild(strip);
  reelsEl.appendChild(win);
  reelStripEls.push(strip);
}

function setSymbol(i, sym) {
  reelStripEls[i].innerHTML = symbolIconHTML(sym);
}

function renderReels() {
  for (let i = 0; i < 3; i++) setSymbol(i, state.reels[i]);
}

function renderResult() {
  resultEl.className = 'result';
  if (state.phase === 'spinning') {
    resultEl.textContent = '';
  } else if (state.lastResult) {
    const { payout, label } = state.lastResult;
    resultEl.classList.add(payout > 0 ? 'win' : 'lose');
    resultEl.textContent = payout > 0 ? `${label} — +$${payout}` : `${label} — -$${Bet}`;
  } else if (state.phase === 'over') {
    resultEl.classList.add('lose');
    resultEl.textContent = 'Out of money! Tap New Game to play again.';
  } else {
    resultEl.classList.add('hint');
    resultEl.textContent = 'Match the payline to win';
  }
}

function renderPaytable() {
  paytableEl.innerHTML = '';
  for (const row of PAY_TABLE) {
    const el = document.createElement('div');
    el.className = 'pay-row';
    if (state.lastResult && state.lastResult.key === row.key && row.amount > 0) {
      el.classList.add('win');
    }
    const icons = row.icons.map((s) => symbolIconHTML(s, 'small')).join('');
    el.innerHTML = `
      <span class="pay-icons">${icons}</span>
      <span class="pay-name">${row.label}</span>
      <span class="pay-amt">$${row.amount}</span>`;
    paytableEl.appendChild(el);
  }
}

function renderStats() {
  statsEl.textContent = `Balance: $${state.money} · Spins: ${state.spins} · Won: ${state.won}`;
  statsEl.style.color = state.money > 20 ? 'var(--win)'
    : state.money >= Bet ? 'var(--accent)' : 'var(--lose)';
}

function renderControls() {
  if (state.phase === 'spinning') {
    statusEl.textContent = 'Spinning…';
    btnSpin.textContent = 'Spinning…';
    btnSpin.disabled = true;
  } else if (state.phase === 'over') {
    statusEl.textContent = 'Game over';
    btnSpin.textContent = 'Out of money';
    btnSpin.disabled = true;
  } else {
    statusEl.textContent = 'Ready — pull the lever';
    btnSpin.textContent = `SPIN ($${Bet})`;
    btnSpin.disabled = false;
  }
}

function render() {
  renderReels();
  renderResult();
  renderPaytable();
  renderStats();
  renderControls();
}

// ---------- reel spin animation ----------
//
// Each reel cycles through random symbols on its own recursive-setTimeout
// loop (not requestAnimationFrame — the cadence here is 55-200ms per swap,
// far coarser than a frame), with the delay between swaps growing over time
// for an ease-out "decelerating" feel, then settles on the real result.
// Reels are staggered (0 stops first) to match a real fruit machine.

const REEL_STOP_DELAYS = [700, 1050, 1500]; // ms

function randomCosmeticSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

function animateReel(i, finalSymbol, duration, onStop) {
  const windowEl = reelStripEls[i].parentElement;
  windowEl.classList.add('spinning');
  const start = performance.now();
  function tick() {
    const elapsed = performance.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    if (progress >= 1) {
      windowEl.classList.remove('spinning');
      windowEl.classList.add('landed');
      setTimeout(() => windowEl.classList.remove('landed'), 260);
      setSymbol(i, finalSymbol);
      onStop();
      return;
    }
    setSymbol(i, randomCosmeticSymbol());
    const delay = 55 + progress ** 2 * 145; // 55ms -> 200ms as it approaches the stop
    setTimeout(tick, delay);
  }
  tick();
}

// ---------- game actions ----------

function spin() {
  if (state.phase === 'spinning' || state.money < Bet) return;
  state.money -= Bet;
  state.phase = 'spinning';
  state.lastResult = null;
  render();

  playLeverPull();
  leverEl.classList.remove('pulled');
  void leverEl.offsetWidth; // restart the CSS animation even on back-to-back spins
  leverEl.classList.add('pulled');
  const stopLoop = playSpinLoop();

  const results = rollReels();
  let landed = 0;
  results.forEach((sym, i) => {
    animateReel(i, sym, REEL_STOP_DELAYS[i], () => {
      playReelStop();
      landed++;
      if (landed === results.length) finishSpin(results, stopLoop);
    });
  });
}

function finishSpin(results, stopLoop) {
  stopLoop();
  const { key, payout, label } = evaluateSpin(results);
  const winnings = payout * Bet;

  state.reels = results;
  state.money += winnings;
  state.spins++;
  if (winnings > 0) state.won++;
  state.lastResult = { key, payout: winnings, label };

  if (isJackpot(results)) playJackpot();
  else if (winnings > 0) playWin(payout);
  else playLose();

  state.phase = state.money < Bet ? 'over' : 'idle';
  render();
  if (state.phase === 'over') setTimeout(playOutOfMoney, 500);
}

function restart() {
  state.reels = ['bar', 'bell', 'plum'];
  state.phase = 'idle';
  state.lastResult = null;
  state.money = StartMoney;
  state.spins = 0;
  state.won = 0;
  render();
}

// ---------- input ----------

btnSpin.addEventListener('click', spin);
btnRestart.addEventListener('click', restart);

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
  const dismissed = localStorage.getItem('slots_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('slots_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
