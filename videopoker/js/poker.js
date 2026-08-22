// Five-card draw video poker, Jacks-or-Better paytable.
// Pure deck/scoring logic, ported from oberon-transpiler/examples/videopoker.mod.
// No DOM here — keeps this testable from scripts/selftest.mjs without a browser.

export const Bet = 5;
export const StartMoney = 100;

// Hand ranks, low to high.
export const HighCard = 0;
export const OnePair = 1;
export const TwoPair = 2;
export const ThreeOfAKind = 3;
export const Straight = 4;
export const Flush = 5;
export const FullHouse = 6;
export const FourOfAKind = 7;
export const StraightFlush = 8;
export const RoyalFlush = 9;

export const RANK_NAMES = {
  [RoyalFlush]: 'Royal Flush',
  [StraightFlush]: 'Straight Flush',
  [FourOfAKind]: 'Four of a Kind',
  [FullHouse]: 'Full House',
  [Flush]: 'Flush',
  [Straight]: 'Straight',
  [ThreeOfAKind]: 'Three of a Kind',
  [TwoPair]: 'Two Pair',
  [OnePair]: 'One Pair',
  [HighCard]: 'High Card',
};

// PAY_TABLE rows in display order, each: [rank, label, amount, isJacksRow].
// isJacksRow distinguishes the two OnePair rows (Jacks-or-better vs below).
export const PAY_TABLE = [
  [RoyalFlush, 'Royal Flush', 4000, false],
  [StraightFlush, 'Straight Flush', 250, false],
  [FourOfAKind, 'Four of a Kind', 125, false],
  [FullHouse, 'Full House', 45, false],
  [Flush, 'Flush', 30, false],
  [Straight, 'Straight', 20, false],
  [ThreeOfAKind, 'Three of a Kind', 15, false],
  [TwoPair, 'Two Pair', 10, false],
  [OnePair, 'Jacks or Better', 5, true],
  [OnePair, 'Pair (below Jacks)', 0, false],
];

// Cards are 0..51. Suit = card / 13 (0=Clubs 1=Diamonds 2=Hearts 3=Spades).
// Rank = card % 13 + 1 (1=Ace ... 10=Ten 11=Jack 12=Queen 13=King).
export const Clubs = 0;
export const Diamonds = 1;
export const Hearts = 2;
export const Spades = 3;
export const SUIT_SYMBOL = { [Clubs]: '♣', [Diamonds]: '♦', [Hearts]: '♥', [Spades]: '♠' };
export const RANK_SYMBOL = { 1: 'A', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };

export function cardSuit(c) {
  return Math.floor(c / 13);
}

export function cardRank(c) {
  return (c % 13) + 1;
}

export function isRed(c) {
  const s = cardSuit(c);
  return s === Diamonds || s === Hearts;
}

export function rankLabel(r) {
  return RANK_SYMBOL[r] || String(r);
}

export function createDeck() {
  const deck = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

// Fisher-Yates. rng defaults to Math.random but is injectable for tests.
export function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function scoreHand(hand) {
  const rc = new Array(14).fill(0);
  const sc = new Array(4).fill(0);
  for (const c of hand) {
    rc[cardRank(c)]++;
    sc[cardSuit(c)]++;
  }

  const isFlush = sc.some((n) => n === 5);

  let minR = 14;
  let maxR = 0;
  for (let r = 1; r <= 13; r++) {
    if (rc[r] > 0) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }

  let isStraight = maxR - minR === 4;
  if (isStraight) {
    for (let r = minR; r <= maxR; r++) {
      if (rc[r] !== 1) { isStraight = false; break; }
    }
  }
  // Ace-low wheel: A-2-3-4-5.
  if (rc[1] === 1 && rc[2] === 1 && rc[3] === 1 && rc[4] === 1 && rc[5] === 1) isStraight = true;
  // Ace-high broadway: 10-J-Q-K-A.
  if (rc[1] === 1 && rc[10] === 1 && rc[11] === 1 && rc[12] === 1 && rc[13] === 1) isStraight = true;

  const isRoyal = isFlush && rc[1] === 1 && rc[10] === 1 && rc[11] === 1 && rc[12] === 1 && rc[13] === 1;

  let pairs = 0;
  let trips = 0;
  let quads = 0;
  for (let r = 1; r <= 13; r++) {
    if (rc[r] === 2) pairs++;
    else if (rc[r] === 3) trips++;
    else if (rc[r] === 4) quads++;
  }

  if (isRoyal) return RoyalFlush;
  if (isStraight && isFlush) return StraightFlush;
  if (quads === 1) return FourOfAKind;
  if (trips === 1 && pairs === 1) return FullHouse;
  if (isFlush) return Flush;
  if (isStraight) return Straight;
  if (trips === 1) return ThreeOfAKind;
  if (pairs === 2) return TwoPair;
  if (pairs === 1) return OnePair;
  return HighCard;
}

export function isJacksOrBetter(hand) {
  const rc = new Array(14).fill(0);
  for (const c of hand) rc[cardRank(c)]++;
  return rc[1] >= 2 || rc[11] >= 2 || rc[12] >= 2 || rc[13] >= 2;
}

export function handPayout(handRank, jacksOrBetter) {
  for (const [rank, , amount, isJacksRow] of PAY_TABLE) {
    if (rank !== handRank) continue;
    if (rank === OnePair && isJacksRow !== jacksOrBetter) continue;
    return amount;
  }
  return 0;
}

export function resultLabel(handRank, jacksOrBetter) {
  if (handRank === OnePair) {
    return jacksOrBetter ? 'Jacks or Better' : 'One Pair (below Jacks)';
  }
  return RANK_NAMES[handRank];
}
