// Klondike solvability search — pure game-state search, no DOM. Used to verify a
// freshly-shuffled deal has a winning line before handing it to the player (see
// dealer.js), and importable from a worker or from scripts/selftest.mjs alike.
//
// This is a "thoughtful" (full-information) solver: it knows every card, including
// ones still face down or buried in the stock, exactly as an offline analysis of the
// deal would. That's the same standard other solitaire generators rely on when they
// claim a deal is "winnable" — it doesn't guarantee a blindfolded human will find the
// line, only that one exists. Search is budgeted (node count + wall clock); running
// out of budget is treated as "not verified solvable," never as a false positive, so
// the caller can safely reshuffle and try again.
import {
  SUITS, isRed, topOf, faceUpRunStart, isWon,
  canAddToFoundation, canAddToTableau,
  drawFromStock, moveWasteToFoundation, moveWasteToTableau,
  moveTableauToFoundation, moveTableauToTableau, moveFoundationToTableau,
} from './klondike.js';

function oppositeColorSuits(suit) {
  return isRed(suit) ? ['spades', 'clubs'] : ['hearts', 'diamonds'];
}

// A card is safe to send home immediately — regardless of what a fuller search might
// prefer — once neither opposite-color foundation could still need it as a base to
// stack on. Standard "safe autoplay" rule; forcing it (rather than branching on it)
// collapses a huge share of the search without ever ruling out a real winning line.
function isSafeAutoplay(card, foundations) {
  if (card.rank <= 2) return true;
  return oppositeColorSuits(card.suit).every((s) => foundations[s].length >= card.rank - 1);
}

function applySafeCascade(state) {
  let cur = state;
  for (;;) {
    const wc = topOf(cur.waste);
    if (wc && canAddToFoundation(wc, cur.foundations[wc.suit]) && isSafeAutoplay(wc, cur.foundations)) {
      cur = moveWasteToFoundation(cur);
      continue;
    }
    let movedTableau = false;
    for (let col = 0; col < 7; col++) {
      const tc = topOf(cur.tableau[col]);
      if (tc && tc.faceUp && canAddToFoundation(tc, cur.foundations[tc.suit]) && isSafeAutoplay(tc, cur.foundations)) {
        cur = moveTableauToFoundation(cur, col);
        movedTableau = true;
        break;
      }
    }
    if (movedTableau) continue;
    return cur;
  }
}

function cardKey(c) {
  return `${c.suit[0]}${c.rank}`;
}

// Compact key for the transposition table. Face-down card identities matter (the
// solver has full information), stock/waste order matters (it governs future
// draws); face-down-ness itself doesn't need encoding beyond "not yet flipped".
function hashState(state) {
  const tableau = state.tableau
    .map((pile) => pile.map((c) => (c.faceUp ? cardKey(c) : `_${cardKey(c)}`)).join(','))
    .join('|');
  const foundations = SUITS.map((s) => state.foundations[s].length).join(',');
  const stock = state.stock.map(cardKey).join(',');
  const waste = state.waste.map(cardKey).join(',');
  return `${tableau}#${foundations}#${stock}#${waste}`;
}

// Generates every legal next state, with duplicate/no-op moves to empty tableau
// columns collapsed: all empty columns are interchangeable destinations, and moving
// an entire column onto another empty column is pure relabeling (nothing below it
// gets exposed), so neither case can ever change what's strategically reachable.
function generateMoves(state) {
  const moves = []; // { state, priority } — pushed onto the DFS stack low-to-high
                     // priority so the highest-priority move is popped first.

  for (let col = 0; col < 7; col++) {
    const card = topOf(state.tableau[col]);
    if (card && card.faceUp && canAddToFoundation(card, state.foundations[card.suit])) {
      moves.push({ state: applySafeCascade(moveTableauToFoundation(state, col)), priority: 5 });
    }
  }
  {
    const card = topOf(state.waste);
    if (card && canAddToFoundation(card, state.foundations[card.suit])) {
      moves.push({ state: applySafeCascade(moveWasteToFoundation(state)), priority: 5 });
    }
  }

  for (let from = 0; from < 7; from++) {
    const pile = state.tableau[from];
    if (!pile.length) continue;
    const runStart = faceUpRunStart(pile);
    const firstEmptyCol = state.tableau.findIndex((p, i) => i !== from && p.length === 0);
    for (let idx = runStart; idx < pile.length; idx++) {
      const card = pile[idx];
      for (let to = 0; to < 7; to++) {
        if (to === from) continue;
        const destPile = state.tableau[to];
        const destEmpty = destPile.length === 0;
        if (destEmpty && (idx === 0 || to !== firstEmptyCol)) continue;
        if (!canAddToTableau(card, destPile)) continue;
        const moved = moveTableauToTableau(state, from, idx, to);
        if (moved) moves.push({ state: applySafeCascade(moved), priority: idx === runStart ? 3 : 2 });
      }
    }
  }

  {
    const card = topOf(state.waste);
    if (card) {
      const firstEmptyCol = state.tableau.findIndex((p) => p.length === 0);
      for (let to = 0; to < 7; to++) {
        const destPile = state.tableau[to];
        const destEmpty = destPile.length === 0;
        if (destEmpty && to !== firstEmptyCol) continue;
        if (!canAddToTableau(card, destPile)) continue;
        const moved = moveWasteToTableau(state, to);
        if (moved) moves.push({ state: applySafeCascade(moved), priority: 3 });
      }
    }
  }

  for (const suit of SUITS) {
    const card = topOf(state.foundations[suit]);
    if (!card) continue;
    const firstEmptyCol = state.tableau.findIndex((p) => p.length === 0);
    for (let to = 0; to < 7; to++) {
      const destPile = state.tableau[to];
      const destEmpty = destPile.length === 0;
      if (destEmpty && to !== firstEmptyCol) continue;
      if (!canAddToTableau(card, destPile)) continue;
      const moved = moveFoundationToTableau(state, suit, to);
      if (moved) moves.push({ state: applySafeCascade(moved), priority: 1 });
    }
  }

  if (state.stock.length || state.waste.length) {
    const moved = drawFromStock(state);
    if (moved) moves.push({ state: applySafeCascade(moved), priority: 0 });
  }

  moves.sort((a, b) => a.priority - b.priority);
  return moves;
}

// Depth-first search with a transposition table (so redundant draw/recycle loops and
// reorderings collapse) and a node/time budget. Returns true only when an explicit
// winning line was found; false covers both "provably no line exists" (the reachable
// state space under our move set was exhausted) and "ran out of budget" — the caller
// treats both the same way, by trying a different deal.
export function isSolvable(game, opts = {}) {
  const nodeBudget = opts.nodeBudget ?? 20000;
  const timeBudgetMs = opts.timeBudgetMs ?? 600;
  const start = Date.now();

  const visited = new Set();
  const seed = applySafeCascade(game);
  if (isWon(seed)) return true;
  visited.add(hashState(seed));
  const stack = [seed];
  let nodes = 0;

  while (stack.length) {
    nodes++;
    if (nodes > nodeBudget) return false;
    if (nodes % 500 === 0 && Date.now() - start > timeBudgetMs) return false;

    const state = stack.pop();
    for (const { state: next } of generateMoves(state)) {
      if (isWon(next)) return true;
      const h = hashState(next);
      if (visited.has(h)) continue;
      visited.add(h);
      stack.push(next);
    }
  }
  return false;
}
