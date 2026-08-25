// Klondike Solitaire: pure game logic — deck, deal, move validation, and
// state transitions. No DOM here — keeps this testable from
// scripts/selftest.mjs without a browser. All state-changing functions
// return a new state (or null if the move is illegal) rather than mutating
// their input, so app.js can push a state onto a history stack for Undo
// just by keeping the reference around.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RED_SUITS = ['hearts', 'diamonds'];

export function isRed(suit) {
  return RED_SUITS.includes(suit);
}

const RANK_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export function rankName(rank) {
  return RANK_NAMES[rank];
}

const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit];
}

// ---------- deck / deal ----------

export function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, faceUp: false });
    }
  }
  return deck;
}

// rng is injectable so tests can deal a deterministic deck.
export function shuffle(deck, rng = Math.random) {
  const cards = deck.slice();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function createGame(drawCount = 1, rng = Math.random) {
  const deck = shuffle(newDeck(), rng);
  const tableau = [[], [], [], [], [], [], []];
  let i = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = deck[i++];
      tableau[col].push({ ...card, faceUp: row === col });
    }
  }
  const stock = deck.slice(i).map((c) => ({ ...c, faceUp: false }));
  return {
    tableau,
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock,
    waste: [],
    drawCount,
  };
}

function cloneState(state) {
  return {
    tableau: state.tableau.map((pile) => pile.map((c) => ({ ...c }))),
    foundations: {
      spades: state.foundations.spades.map((c) => ({ ...c })),
      hearts: state.foundations.hearts.map((c) => ({ ...c })),
      diamonds: state.foundations.diamonds.map((c) => ({ ...c })),
      clubs: state.foundations.clubs.map((c) => ({ ...c })),
    },
    stock: state.stock.map((c) => ({ ...c })),
    waste: state.waste.map((c) => ({ ...c })),
    drawCount: state.drawCount,
  };
}

// ---------- predicates ----------

export function topOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

export function canAddToFoundation(card, foundationPile) {
  const top = topOf(foundationPile);
  return top ? card.suit === top.suit && card.rank === top.rank + 1 : card.rank === 1;
}

export function canAddToTableau(card, tableauPile) {
  const top = topOf(tableauPile);
  return top ? isRed(card.suit) !== isRed(top.suit) && card.rank === top.rank - 1 : card.rank === 13;
}

// A contiguous face-up run starting at `index` is always internally valid
// (each card was only ever placed on the one below via canAddToTableau), so
// moving it as a group just needs the base card to fit the destination.
export function faceUpRunStart(pile) {
  let i = pile.length - 1;
  while (i > 0 && pile[i - 1].faceUp) i--;
  return pile[i] && pile[i].faceUp ? i : pile.length;
}

export function isWon(state) {
  return SUITS.every((s) => state.foundations[s].length === 13);
}

// Safe to auto-finish once nothing is left face down or hidden in stock/waste
// — from there every card can eventually reach its foundation.
export function canAutoComplete(state) {
  if (state.stock.length || state.waste.length) return false;
  return state.tableau.every((pile) => pile.every((c) => c.faceUp));
}

// ---------- moves ----------
// Each returns a new state, or null if the move is illegal.

export function drawFromStock(state) {
  const next = cloneState(state);
  if (next.stock.length === 0) {
    if (next.waste.length === 0) return null;
    next.stock = next.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    next.waste = [];
    return next;
  }
  const n = Math.min(next.drawCount, next.stock.length);
  for (let i = 0; i < n; i++) {
    const card = next.stock.pop();
    card.faceUp = true;
    next.waste.push(card);
  }
  return next;
}

function flipNewTop(pile) {
  const top = topOf(pile);
  if (top && !top.faceUp) top.faceUp = true;
}

export function moveWasteToFoundation(state) {
  const card = topOf(state.waste);
  if (!card) return null;
  if (!canAddToFoundation(card, state.foundations[card.suit])) return null;
  const next = cloneState(state);
  next.foundations[card.suit].push(next.waste.pop());
  return next;
}

export function moveWasteToTableau(state, toCol) {
  const card = topOf(state.waste);
  if (!card) return null;
  if (!canAddToTableau(card, state.tableau[toCol])) return null;
  const next = cloneState(state);
  next.tableau[toCol].push(next.waste.pop());
  return next;
}

export function moveTableauToFoundation(state, fromCol) {
  const pile = state.tableau[fromCol];
  const card = topOf(pile);
  if (!card || !card.faceUp) return null;
  if (!canAddToFoundation(card, state.foundations[card.suit])) return null;
  const next = cloneState(state);
  next.foundations[card.suit].push(next.tableau[fromCol].pop());
  flipNewTop(next.tableau[fromCol]);
  return next;
}

export function moveTableauToTableau(state, fromCol, cardIndex, toCol) {
  if (fromCol === toCol) return null;
  const pile = state.tableau[fromCol];
  const card = pile[cardIndex];
  if (!card || !card.faceUp) return null;
  if (cardIndex < faceUpRunStart(pile)) return null;
  if (!canAddToTableau(card, state.tableau[toCol])) return null;
  const next = cloneState(state);
  const run = next.tableau[fromCol].splice(cardIndex);
  next.tableau[toCol].push(...run);
  flipNewTop(next.tableau[fromCol]);
  return next;
}

export function moveFoundationToTableau(state, suit, toCol) {
  const card = topOf(state.foundations[suit]);
  if (!card) return null;
  if (!canAddToTableau(card, state.tableau[toCol])) return null;
  const next = cloneState(state);
  next.tableau[toCol].push(next.foundations[suit].pop());
  return next;
}

// Finds one legal card to send to a foundation, preferring the waste pile
// then scanning tableau columns left to right. Used to drive auto-complete
// one step at a time so the UI can animate and play a sound per card.
export function findAutoMove(state) {
  if (state.waste.length) {
    const card = topOf(state.waste);
    if (canAddToFoundation(card, state.foundations[card.suit])) return { type: 'waste' };
  }
  for (let col = 0; col < state.tableau.length; col++) {
    const card = topOf(state.tableau[col]);
    if (card && card.faceUp && canAddToFoundation(card, state.foundations[card.suit])) {
      return { type: 'tableau', col };
    }
  }
  return null;
}

export function applyAutoMove(state, move) {
  if (move.type === 'waste') return moveWasteToFoundation(state);
  return moveTableauToFoundation(state, move.col);
}
