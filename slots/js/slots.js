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
// together with the payouts, for a ~79.5% return.
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

// Cherry bonus: any two of the three reels showing cherry pays out, in
// whatever positions they land — genuinely position-independent, not read
// left to right. (An earlier version of this rule only checked reels 1+2,
// which meant two cherries in, say, reels 2+3 silently paid nothing; that
// read as a scoring bug, because from the player's seat it is one.)
//
// There's no separate payout for a single lone cherry, even though cherry
// is the most common symbol on the strip (see WEIGHTS above): at that
// frequency, paying out on just one reel matching would trigger on well
// over half of all spins and push the return past 100% on its own, before
// the pair bonus or any triple is even counted. Capping it at "two cherries
// pays a little" is what keeps the bonus affordable while cherry stays the
// most frequent symbol on the reel.
export const PAYOUT_CHERRY_PAIR = 2;

const TRIPLE_ORDER = ['seven', 'bar', 'bell', 'plum', 'orange', 'lemon', 'cherry'];

// Paytable rows in display order, richest first.
export const PAY_TABLE = [
  ...TRIPLE_ORDER.map((sym) => ({
    key: sym,
    label: `Triple ${SYMBOL_LABEL[sym]}`,
    amount: PAYOUT_3[sym],
    icons: [sym, sym, sym],
  })),
  { key: 'cherryPair', label: 'Two Cherries (any spot)', amount: PAYOUT_CHERRY_PAIR, icons: ['cherry', 'cherry'] },
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
  const cherries = [a, b, c].filter((s) => s === 'cherry').length;
  if (cherries === 2) {
    return { key: 'cherryPair', payout: PAYOUT_CHERRY_PAIR, label: 'Two Cherries!' };
  }
  return { key: null, payout: 0, label: 'No match' };
}

export function isJackpot(results) {
  return results[0] === 'seven' && results[1] === 'seven' && results[2] === 'seven';
}
