// Quick correctness check for the scoring engine — not shipped to the app, dev-only.
import {
  createDeck, shuffle, scoreHand, isJacksOrBetter, handPayout,
  RoyalFlush, StraightFlush, FourOfAKind, FullHouse, Flush, Straight,
  ThreeOfAKind, TwoPair, OnePair, HighCard,
} from '../js/poker.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${actual}, want ${expected}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// Card = suit*13 + (rank-1). Suits: 0 Clubs 1 Diamonds 2 Hearts 3 Spades.
const c = (suit, rank) => suit * 13 + (rank - 1);

check('royal flush', scoreHand([c(3, 1), c(3, 10), c(3, 11), c(3, 12), c(3, 13)]), RoyalFlush);
check('straight flush', scoreHand([c(2, 4), c(2, 5), c(2, 6), c(2, 7), c(2, 8)]), StraightFlush);
check('wheel straight flush (A-5)', scoreHand([c(1, 1), c(1, 2), c(1, 3), c(1, 4), c(1, 5)]), StraightFlush);
check('four of a kind', scoreHand([c(0, 9), c(1, 9), c(2, 9), c(3, 9), c(0, 2)]), FourOfAKind);
check('full house', scoreHand([c(0, 7), c(1, 7), c(2, 7), c(0, 3), c(1, 3)]), FullHouse);
check('flush', scoreHand([c(0, 2), c(0, 5), c(0, 9), c(0, 11), c(0, 13)]), Flush);
check('straight (broadway)', scoreHand([c(0, 1), c(1, 10), c(2, 11), c(3, 12), c(0, 13)]), Straight);
check('straight (wheel)', scoreHand([c(0, 1), c(1, 2), c(2, 3), c(3, 4), c(0, 5)]), Straight);
check('not a straight (gap)', scoreHand([c(0, 1), c(1, 2), c(2, 3), c(3, 4), c(0, 6)]), HighCard);
check('three of a kind', scoreHand([c(0, 6), c(1, 6), c(2, 6), c(0, 2), c(1, 9)]), ThreeOfAKind);
check('two pair', scoreHand([c(0, 6), c(1, 6), c(0, 9), c(1, 9), c(2, 2)]), TwoPair);
check('jacks pair', scoreHand([c(0, 11), c(1, 11), c(2, 2), c(3, 5), c(0, 9)]), OnePair);
check('low pair', scoreHand([c(0, 4), c(1, 4), c(2, 2), c(3, 5), c(0, 9)]), OnePair);
check('high card', scoreHand([c(0, 2), c(1, 5), c(2, 9), c(3, 11), c(0, 13)]), HighCard);

check('jacks-or-better: JJ counts', isJacksOrBetter([c(0, 11), c(1, 11), c(2, 2), c(3, 5), c(0, 9)]), true);
check('jacks-or-better: aces count', isJacksOrBetter([c(0, 1), c(1, 1), c(2, 2), c(3, 5), c(0, 9)]), true);
check('jacks-or-better: low pair does not count', isJacksOrBetter([c(0, 4), c(1, 4), c(2, 2), c(3, 5), c(0, 9)]), false);

check('payout royal', handPayout(RoyalFlush, false), 4000);
check('payout jacks pair', handPayout(OnePair, true), 5);
check('payout low pair', handPayout(OnePair, false), 0);
check('payout high card', handPayout(HighCard, false), 0);

// Deck integrity: 52 unique cards, every shuffle is a permutation.
const deck = createDeck();
check('deck size', deck.length, 52);
check('deck unique', new Set(deck).size, 52);
for (let trial = 0; trial < 20; trial++) {
  shuffle(deck);
  if (new Set(deck).size !== 52 || deck.some((v) => v < 0 || v > 51)) {
    failures++;
    console.log(`FAIL shuffle trial ${trial}: not a permutation`);
  }
}
console.log('ok   50 shuffle trials remain permutations of 0..51');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
