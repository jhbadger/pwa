// Classic 3-reel slot machine: cherries, lemons, oranges, plums, bells, bars,
// sevens. Pure game logic — reel composition, spin outcomes, payout table.
// No DOM here — keeps this testable from scripts/selftest.mjs without a browser.

export const Bet = 1;
export const StartMoney = 100;

export const SYMBOLS = ['cherry', 'lemon', 'orange', 'plum', 'bell', 'bar', 'seven'];

export const SYMBOL_LABEL = {
  cherry: 'Cherry',
  lemon: 'Lemon',
  orange: 'Orange',
  plum: 'Plum',
  bell: 'Bell',
  bar: 'Bar',
  seven: 'Seven',
};

// Reel-strip composition: how many of each symbol appear per lap of the
// reel, same on all three reels. Weighted toward the common low-pay fruit so
// the jackpot symbol is genuinely rare (1-in-22 per reel) — tuned below,
// together with the payouts, for a ~88% return.
const WEIGHTS = { cherry: 6, lemon: 5, orange: 4, plum: 3, bell: 2, bar: 1, seven: 1 };

export function buildReelStrip() {
  const strip = [];
  for (const sym of SYMBOLS) {
    for (let i = 0; i < WEIGHTS[sym]; i++) strip.push(sym);
  }
  return strip;
}

export const REEL_STRIP = buildReelStrip();

// Three-of-a-kind payouts, in multiples of Bet.
export const PAYOUT_3 = {
  seven: 200, bar: 80, bell: 40, plum: 20, orange: 14, lemon: 10, cherry: 8,
};

// Classic fruit-machine cherry rule: cherries pay on a partial match too,
// read left to right off the first reel(s).
export const PAYOUT_CHERRY_2 = 4; // reels 1 & 2 cherry, reel 3 anything else
export const PAYOUT_CHERRY_1 = 1; // reel 1 only, reel 2 not cherry

const TRIPLE_ORDER = ['seven', 'bar', 'bell', 'plum', 'orange', 'lemon', 'cherry'];

// Paytable rows in display order, richest first.
export const PAY_TABLE = [
  ...TRIPLE_ORDER.map((sym) => ({
    key: sym,
    label: `Triple ${SYMBOL_LABEL[sym]}`,
    amount: PAYOUT_3[sym],
    icons: [sym, sym, sym],
  })),
  { key: 'cherry2', label: 'Two Cherries', amount: PAYOUT_CHERRY_2, icons: ['cherry', 'cherry'] },
  { key: 'cherry1', label: 'One Cherry', amount: PAYOUT_CHERRY_1, icons: ['cherry'] },
];

export function spinReel(rng = Math.random) {
  return REEL_STRIP[Math.floor(rng() * REEL_STRIP.length)];
}

export function rollReels(rng = Math.random) {
  return [spinReel(rng), spinReel(rng), spinReel(rng)];
}

// Returns { key, payout, label } for a completed 3-symbol spin. payout is in
// multiples of Bet; key identifies the matching PAY_TABLE row (or null).
export function evaluateSpin([a, b, c]) {
  if (a === b && b === c) {
    return { key: a, payout: PAYOUT_3[a], label: `Triple ${SYMBOL_LABEL[a]}!` };
  }
  if (a === 'cherry' && b === 'cherry') {
    return { key: 'cherry2', payout: PAYOUT_CHERRY_2, label: 'Two Cherries!' };
  }
  if (a === 'cherry') {
    return { key: 'cherry1', payout: PAYOUT_CHERRY_1, label: 'Cherry' };
  }
  return { key: null, payout: 0, label: 'No match' };
}

export function isJackpot(results) {
  return results[0] === 'seven' && results[1] === 'seven' && results[2] === 'seven';
}
