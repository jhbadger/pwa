import {
  Bet, StartMoney, PAY_TABLE, OnePair,
  createDeck, shuffle, cardSuit, cardRank, isRed, rankLabel,
  scoreHand, isJacksOrBetter, handPayout, resultLabel, SUIT_SYMBOL,
} from './poker.js';

const cardsRowEl = document.getElementById('cardsRow');
const resultEl = document.getElementById('result');
const paytableEl = document.getElementById('paytable');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');
const btnMain = document.getElementById('btnMain');
const btnRestart = document.getElementById('btnRestart');
const toastEl = document.getElementById('toast');

const state = {
  hand: [null, null, null, null, null],
  hold: [false, false, false, false, false],
  phase: 'deal', // 'deal' | 'draw' | 'show' | 'over'
  handRank: null,
  jacksOrBetter: false,
  payout: 0,
  money: StartMoney,
  games: 0,
  won: 0,
};

// Built once; refreshed in place each render() (5 slots is cheap either way).
const slotEls = [];
for (let i = 0; i < 5; i++) {
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  slot.dataset.i = String(i);
  slot.innerHTML = '<div class="hold-badge"></div><div class="card"><div class="card-back"></div></div>';
  cardsRowEl.appendChild(slot);
  slotEls.push(slot);
}

function cardFaceHTML(card) {
  const rank = rankLabel(cardRank(card));
  const suit = SUIT_SYMBOL[cardSuit(card)];
  const color = isRed(card) ? 'red' : 'black';
  return `
    <div class="card-face ${color}">
      <div class="corner tl"><span class="r">${rank}</span><span class="s">${suit}</span></div>
      <div class="pip">${suit}</div>
      <div class="corner br"><span class="r">${rank}</span><span class="s">${suit}</span></div>
    </div>`;
}

function renderCards() {
  const dealt = state.phase === 'draw' || state.phase === 'show';
  for (let i = 0; i < 5; i++) {
    const slot = slotEls[i];
    const cardEl = slot.querySelector('.card');
    const badgeEl = slot.querySelector('.hold-badge');
    const held = state.hold[i];

    slot.classList.toggle('held', dealt && held);
    slot.classList.toggle('tappable', state.phase === 'draw');
    slot.classList.toggle('empty-slot', !dealt);

    if (dealt) {
      cardEl.innerHTML = cardFaceHTML(state.hand[i]);
      badgeEl.textContent = state.phase === 'draw'
        ? (held ? 'HOLD' : `TAP ${i + 1}`)
        : (held ? 'HELD' : '');
    } else {
      cardEl.innerHTML = '<div class="card-back"></div>';
      badgeEl.textContent = String(i + 1);
    }
  }
}

function renderResult() {
  resultEl.className = 'result';
  if (state.phase === 'draw') {
    resultEl.classList.add('hint');
    resultEl.textContent = 'Tap cards to hold, then Draw';
  } else if (state.phase === 'show') {
    const net = state.payout - Bet;
    const label = resultLabel(state.handRank, state.jacksOrBetter);
    const netText = net > 0 ? `+$${net}` : net === 0 ? 'push' : `-$${Bet}`;
    resultEl.classList.add(net > 0 ? 'win' : net === 0 ? 'push' : 'lose');
    resultEl.textContent = `${label} — ${netText}`;
  } else if (state.phase === 'over') {
    resultEl.classList.add('lose');
    resultEl.textContent = 'Out of money! Tap New Game to play again.';
  } else {
    resultEl.textContent = '';
  }
}

function renderPaytable() {
  paytableEl.innerHTML = '';
  for (const [rank, label, amount, isJacksRow] of PAY_TABLE) {
    const row = document.createElement('div');
    row.className = 'pay-row';
    const isMatch = state.phase === 'show' && rank === state.handRank
      && (rank !== OnePair || isJacksRow === state.jacksOrBetter);
    if (isMatch) row.classList.add(amount > 0 ? 'win' : 'lose');
    row.innerHTML = `<span class="name">${label}</span><span class="amt">$${amount}</span>`;
    paytableEl.appendChild(row);
  }
}

function renderStats() {
  statsEl.textContent = `Balance: $${state.money} · Hands: ${state.games} · Won: ${state.won}`;
  statsEl.style.color = state.money > 30 ? 'var(--win)'
    : state.money > Bet ? 'var(--accent)' : 'var(--lose)';
}

function renderControls() {
  if (state.phase === 'deal') {
    statusEl.textContent = 'Ready — tap Deal to play';
    btnMain.textContent = `Deal ($${Bet})`;
    btnMain.disabled = false;
  } else if (state.phase === 'draw') {
    statusEl.textContent = 'Choose cards to hold';
    btnMain.textContent = 'Draw';
    btnMain.disabled = false;
  } else if (state.phase === 'show') {
    statusEl.textContent = 'Hand complete';
    btnMain.textContent = `Deal Next ($${Bet})`;
    btnMain.disabled = false;
  } else {
    statusEl.textContent = 'Game over';
    btnMain.textContent = 'Out of money';
    btnMain.disabled = true;
  }
}

function render() {
  renderCards();
  renderResult();
  renderPaytable();
  renderStats();
  renderControls();
}

// ---------- game actions ----------

function deal() {
  if (state.money < Bet) {
    state.phase = 'over';
    render();
    return;
  }
  state.money -= Bet;
  const deck = shuffle(createDeck());
  state.hand = deck.slice(0, 5);
  state.deckTop = 5;
  state.deck = deck;
  state.hold = [false, false, false, false, false];
  state.handRank = null;
  state.payout = 0;
  state.phase = 'draw';
  render();
}

function toggleHold(i) {
  if (state.phase !== 'draw') return;
  state.hold[i] = !state.hold[i];
  render();
}

function draw() {
  if (state.phase !== 'draw') return;
  for (let i = 0; i < 5; i++) {
    if (!state.hold[i]) {
      state.hand[i] = state.deck[state.deckTop];
      state.deckTop++;
    }
  }
  state.handRank = scoreHand(state.hand);
  state.jacksOrBetter = isJacksOrBetter(state.hand);
  state.payout = handPayout(state.handRank, state.jacksOrBetter);
  state.money += state.payout;
  state.games++;
  if (state.payout > 0) state.won++;
  state.phase = 'show';
  render();
}

function restart() {
  state.hand = [null, null, null, null, null];
  state.hold = [false, false, false, false, false];
  state.phase = 'deal';
  state.handRank = null;
  state.jacksOrBetter = false;
  state.payout = 0;
  state.money = StartMoney;
  state.games = 0;
  state.won = 0;
  render();
}

// ---------- input ----------

// Pointer events, not click: the touchstart handler below calls preventDefault()
// to stop iOS's callout bar, and per the touch-event spec that suppresses the
// synthetic click Android would otherwise fire after a tap — pointerdown/up are
// unaffected, so they're what still works there.
let cardPointerDown = null; // { i, x, y }

cardsRowEl.addEventListener('pointerdown', (e) => {
  const slot = e.target.closest('.card-slot');
  if (!slot) return;
  cardPointerDown = { i: Number(slot.dataset.i), x: e.clientX, y: e.clientY };
});

cardsRowEl.addEventListener('pointerup', (e) => {
  if (!cardPointerDown) return;
  const moved = Math.hypot(e.clientX - cardPointerDown.x, e.clientY - cardPointerDown.y) > 8;
  const slot = e.target.closest('.card-slot');
  const sameSlot = slot && Number(slot.dataset.i) === cardPointerDown.i;
  if (!moved && sameSlot) toggleHold(cardPointerDown.i);
  cardPointerDown = null;
});

cardsRowEl.addEventListener('pointercancel', () => {
  cardPointerDown = null;
});

btnMain.addEventListener('click', () => {
  if (state.phase === 'deal' || state.phase === 'show') deal();
  else if (state.phase === 'draw') draw();
});

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
  const dismissed = localStorage.getItem('vp_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('vp_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
