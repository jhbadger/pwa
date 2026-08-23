// Quick correctness check for the reel/payout logic — not shipped to the app, dev-only.
import {
  SYMBOLS, REEL_STRIP, PAY_TABLE, PAYOUT_3, PAYOUT_CHERRY_2, PAYOUT_CHERRY_1,
  rollReels, evaluateSpin, isJackpot,
} from '../js/slots.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof actual === 'object' && actual !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// Reel strip: every symbol present, no stray values.
check('reel strip non-empty', REEL_STRIP.length > 0, true);
check('reel strip only known symbols', REEL_STRIP.every((s) => SYMBOLS.includes(s)), true);
for (const sym of SYMBOLS) {
  check(`reel strip contains ${sym}`, REEL_STRIP.includes(sym), true);
}

// Payout evaluation.
check('triple seven', evaluateSpin(['seven', 'seven', 'seven']), { key: 'seven', payout: PAYOUT_3.seven, label: 'Triple Seven!' });
check('triple bar', evaluateSpin(['bar', 'bar', 'bar']), { key: 'bar', payout: PAYOUT_3.bar, label: 'Triple Bar!' });
check('triple cherry', evaluateSpin(['cherry', 'cherry', 'cherry']), { key: 'cherry', payout: PAYOUT_3.cherry, label: 'Triple Cherry!' });
check('two cherries', evaluateSpin(['cherry', 'cherry', 'lemon']), { key: 'cherry2', payout: PAYOUT_CHERRY_2, label: 'Two Cherries!' });
check('one cherry', evaluateSpin(['cherry', 'lemon', 'bell']), { key: 'cherry1', payout: PAYOUT_CHERRY_1, label: 'Cherry' });
check('cherry must lead: lemon-cherry-cherry does not count', evaluateSpin(['lemon', 'cherry', 'cherry']), { key: null, payout: 0, label: 'No match' });
check('no match', evaluateSpin(['lemon', 'orange', 'bell']), { key: null, payout: 0, label: 'No match' });
check('mixed non-cherry triple-looking (2 same, not 3)', evaluateSpin(['bell', 'bell', 'bar']).payout, 0);

check('isJackpot true', isJackpot(['seven', 'seven', 'seven']), true);
check('isJackpot false', isJackpot(['seven', 'seven', 'bar']), false);

// Every PAY_TABLE row's key round-trips through evaluateSpin via its own icons
// (triple rows) — guards against a label/amount edit drifting out of sync.
for (const row of PAY_TABLE) {
  if (row.icons.length !== 3) continue; // cherry partial rows aren't full spins
  const result = evaluateSpin(row.icons);
  check(`paytable row ${row.key} matches evaluateSpin`, result.payout, row.amount);
}

// RTP sanity: expected value per $1 bet should sit in a plausible casino-like
// range (not free money, not a guaranteed drain). Exact value documented in
// slots.js's WEIGHTS/PAYOUT comment as ~88%.
let ev = 0;
for (const a of SYMBOLS) {
  for (const b of SYMBOLS) {
    for (const c of SYMBOLS) {
      const wa = REEL_STRIP.filter((s) => s === a).length / REEL_STRIP.length;
      const wb = REEL_STRIP.filter((s) => s === b).length / REEL_STRIP.length;
      const wc = REEL_STRIP.filter((s) => s === c).length / REEL_STRIP.length;
      ev += wa * wb * wc * evaluateSpin([a, b, c]).payout;
    }
  }
}
console.log(`   (computed RTP: ${(ev * 100).toFixed(1)}%)`);
check('RTP is in a plausible range (70-95%)', ev >= 0.70 && ev <= 0.95, true);

// rollReels always returns 3 known symbols.
for (let trial = 0; trial < 200; trial++) {
  const r = rollReels();
  if (r.length !== 3 || !r.every((s) => SYMBOLS.includes(s))) {
    failures++;
    console.log(`FAIL rollReels trial ${trial}: ${JSON.stringify(r)}`);
  }
}
console.log('ok   200 rollReels trials return 3 known symbols');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
