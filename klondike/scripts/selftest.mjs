// Quick correctness check for the game logic — not shipped to the app, dev-only.
import {
  SUITS, isRed, rankName, suitSymbol, newDeck, shuffle, createGame, topOf,
  canAddToFoundation, canAddToTableau, faceUpRunStart, isWon, canAutoComplete,
  drawFromStock, moveWasteToFoundation, moveWasteToTableau, moveTableauToFoundation,
  moveTableauToTableau, moveFoundationToTableau, findAutoMove, applyAutoMove,
} from '../js/klondike.js';

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

// A seeded rng (mulberry32) so deals are deterministic across test runs.
function seeded(seed) {
  let a = seed;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- basics ----------
check('isRed(hearts)', isRed('hearts'), true);
check('isRed(spades)', isRed('spades'), false);
check('rankName(1)', rankName(1), 'A');
check('rankName(13)', rankName(13), 'K');
check('rankName(10)', rankName(10), '10');
check('suitSymbol(clubs)', suitSymbol('clubs'), '♣');

{
  const deck = newDeck();
  check('deck has 52 cards', deck.length, 52);
  check('deck starts all face down', deck.every((c) => !c.faceUp), true);
  const shuffled = shuffle(deck, seeded(1));
  check('shuffle preserves count', shuffled.length, 52);
  check('shuffle does not mutate input', deck.length, 52);
  const ranks = shuffled.map((c) => `${c.suit}${c.rank}`).sort();
  const orig = deck.map((c) => `${c.suit}${c.rank}`).sort();
  check('shuffle is a permutation, not a resample', ranks, orig);
}

// ---------- deal ----------
{
  const game = createGame(1, seeded(2));
  const dealtCounts = game.tableau.map((p) => p.length);
  check('tableau column sizes are 1..7', dealtCounts, [1, 2, 3, 4, 5, 6, 7]);
  check('only the last card of each tableau pile is face up', game.tableau.every((p) => p.slice(0, -1).every((c) => !c.faceUp) && topOf(p).faceUp), true);
  check('stock holds the remaining 24 cards', game.stock.length, 24);
  check('stock starts face down', game.stock.every((c) => !c.faceUp), true);
  check('waste starts empty', game.waste.length, 0);
  check('foundations start empty', SUITS.every((s) => game.foundations[s].length === 0), true);

  const total = game.tableau.reduce((n, p) => n + p.length, 0) + game.stock.length;
  check('all 52 cards are accounted for', total, 52);
}

// ---------- predicates ----------
check('ace can start an empty foundation', canAddToFoundation({ suit: 'hearts', rank: 1 }, []), true);
check('non-ace cannot start an empty foundation', canAddToFoundation({ suit: 'hearts', rank: 2 }, []), false);
check('next rank same suit extends a foundation', canAddToFoundation({ suit: 'hearts', rank: 3 }, [{ suit: 'hearts', rank: 1 }, { suit: 'hearts', rank: 2 }]), true);
check('wrong suit cannot extend a foundation', canAddToFoundation({ suit: 'diamonds', rank: 3 }, [{ suit: 'hearts', rank: 1 }, { suit: 'hearts', rank: 2 }]), false);

check('king can start an empty tableau column', canAddToTableau({ suit: 'clubs', rank: 13 }, []), true);
check('non-king cannot start an empty tableau column', canAddToTableau({ suit: 'clubs', rank: 12 }, []), false);
check('alternating color descending rank extends a tableau pile', canAddToTableau({ suit: 'hearts', rank: 5 }, [{ suit: 'clubs', rank: 6 }]), true);
check('same color cannot extend a tableau pile', canAddToTableau({ suit: 'diamonds', rank: 5 }, [{ suit: 'hearts', rank: 6 }]), false);
check('wrong rank cannot extend a tableau pile', canAddToTableau({ suit: 'hearts', rank: 4 }, [{ suit: 'clubs', rank: 6 }]), false);

{
  const pile = [
    { suit: 'clubs', rank: 9, faceUp: false },
    { suit: 'hearts', rank: 8, faceUp: true },
    { suit: 'clubs', rank: 7, faceUp: true },
    { suit: 'diamonds', rank: 6, faceUp: true },
  ];
  check('faceUpRunStart finds the first face-up card of the trailing run', faceUpRunStart(pile), 1);
  check('faceUpRunStart on an all-face-down pile returns length', faceUpRunStart([{ suit: 'clubs', rank: 9, faceUp: false }]), 1);
  check('faceUpRunStart on an empty pile returns 0', faceUpRunStart([]), 0);
}

// ---------- drawFromStock / recycle ----------
{
  let game = createGame(1, seeded(3));
  const stockBefore = game.stock.length;
  game = drawFromStock(game);
  check('draw-1 moves one card to waste', game.waste.length, 1);
  check('draw-1 shrinks the stock by one', game.stock.length, stockBefore - 1);
  check('drawn card is face up', topOf(game.waste).faceUp, true);

  let game3 = createGame(3, seeded(3));
  game3 = drawFromStock(game3);
  check('draw-3 moves three cards to waste', game3.waste.length, 3);

  // Drain the stock, then recycle.
  let g = createGame(1, seeded(4));
  const order = [];
  while (g.stock.length) {
    g = drawFromStock(g);
    order.push(topOf(g.waste));
  }
  check('stock is empty after draining', g.stock.length, 0);
  const wasteBeforeRecycle = g.waste.length;
  g = drawFromStock(g); // stock empty, waste non-empty -> recycle
  check('recycle refills the stock from the waste', g.stock.length, wasteBeforeRecycle);
  check('recycle empties the waste', g.waste.length, 0);
  check('recycled stock is face down', g.stock.every((c) => !c.faceUp), true);
  check('drawing from empty stock and waste is a no-op (null)', drawFromStock({ ...g, stock: [], waste: [] }), null);
}

// ---------- foundation moves ----------
{
  const state = createGame(1, seeded(5));
  state.waste.push({ suit: 'hearts', rank: 1, faceUp: true });
  const moved = moveWasteToFoundation(state);
  check('ace of hearts from waste goes to the hearts foundation', moved.foundations.hearts.length, 1);
  check('moving to foundation removes the card from the waste', moved.waste.length, state.waste.length - 1);

  const bad = { ...state, waste: [{ suit: 'hearts', rank: 5, faceUp: true }] };
  check('a non-ace cannot start a foundation from the waste', moveWasteToFoundation(bad), null);
  check('moveWasteToFoundation on an empty waste is null', moveWasteToFoundation({ ...state, waste: [] }), null);

  const state5 = createGame(1, seeded(5.5));
  state5.tableau[0] = [{ suit: 'spades', rank: 6, faceUp: true }];
  state5.waste = [{ suit: 'hearts', rank: 5, faceUp: true }];
  const wt = moveWasteToTableau(state5, 0);
  check('a matching card moves from the waste onto a tableau pile', wt.tableau[0].length, 2);
  check('moveWasteToTableau is null on an illegal fit', moveWasteToTableau({ ...state5, tableau: [[{ suit: 'hearts', rank: 6, faceUp: true }]] }, 0), null);

  const state6 = createGame(1, seeded(5.6));
  state6.tableau[0] = [{ suit: 'diamonds', rank: 1, faceUp: true }];
  const tf = moveTableauToFoundation(state6, 0);
  check('an exposed ace moves from the tableau to its foundation', tf.foundations.diamonds.length, 1);
  check('moveTableauToFoundation is null when the tableau top cannot extend the foundation', moveTableauToFoundation({ ...state6, tableau: [[{ suit: 'diamonds', rank: 5, faceUp: true }]] }, 0), null);
}

// ---------- tableau moves ----------
{
  const state = createGame(1, seeded(6));
  state.tableau[0] = [{ suit: 'clubs', rank: 6, faceUp: true }];
  state.tableau[1] = [{ suit: 'hearts', rank: 5, faceUp: true }];
  const moved = moveTableauToTableau(state, 1, 0, 0);
  check('red 5 legally moves onto a black 6', moved.tableau[0].length, 2);
  check('source column empties out', moved.tableau[1].length, 0);

  const state2 = createGame(1, seeded(7));
  state2.tableau[0] = [
    { suit: 'clubs', rank: 9, faceUp: false },
    { suit: 'hearts', rank: 8, faceUp: true },
    { suit: 'clubs', rank: 7, faceUp: true },
  ];
  state2.tableau[1] = [{ suit: 'spades', rank: 9, faceUp: true }];
  const moved2 = moveTableauToTableau(state2, 0, 1, 1);
  check('moving a run carries every card above the picked card', moved2.tableau[1].length, 3);
  check('the run keeps its internal order', moved2.tableau[1].map((c) => c.rank), [9, 8, 7]);
  check('the face-down card left behind flips face up', topOf(moved2.tableau[0]).faceUp, true);

  check('picking a card below the face-up run is illegal', moveTableauToTableau(state2, 0, 0, 1), null);
  check('a face-down top card cannot be moved', moveTableauToTableau({ ...state2, tableau: [[{ suit: 'clubs', rank: 7, faceUp: false }], state2.tableau[1]] }, 0, 0, 1), null);

  const state3 = createGame(1, seeded(8));
  state3.tableau[0] = [{ suit: 'clubs', rank: 5, faceUp: true }];
  state3.tableau[2] = [];
  check('only a king can move to an empty tableau column', moveTableauToTableau(state3, 0, 0, 2), null);
  state3.tableau[0] = [{ suit: 'clubs', rank: 13, faceUp: true }];
  check('a king may move to an empty tableau column', moveTableauToTableau(state3, 0, 0, 2).tableau[2].length, 1);

  const state4 = createGame(1, seeded(9));
  state4.tableau[0] = [{ suit: 'clubs', rank: 6, faceUp: true }];
  state4.foundations.hearts = [{ suit: 'hearts', rank: 1, faceUp: true }, { suit: 'hearts', rank: 2, faceUp: true }];
  state4.tableau[1] = [{ suit: 'hearts', rank: 2, faceUp: true }];
  // sanity: foundation top is 2 of hearts, moving it back onto a black-3-less pile
  state4.tableau[1] = [];
  const back = moveFoundationToTableau(state4, 'hearts', 0);
  check('moveFoundationToTableau is null when the destination cannot take the card', back, null);
  state4.tableau[0] = [{ suit: 'clubs', rank: 3, faceUp: true }];
  const back2 = moveFoundationToTableau(state4, 'hearts', 0);
  check('a foundation card can move back onto a valid tableau pile', back2.tableau[0].length, 2);
  check('moving a card back off a foundation shrinks it', back2.foundations.hearts.length, 1);
}

// ---------- win / auto-complete ----------
{
  const won = { foundations: {} };
  for (const s of SUITS) won.foundations[s] = new Array(13).fill({});
  check('all four foundations full is a win', isWon(won), true);
  const notWon = { foundations: { ...won.foundations, hearts: won.foundations.hearts.slice(1) } };
  check('one short foundation is not a win', isWon(notWon), false);

  const game = createGame(1, seeded(10));
  check('a fresh deal cannot auto-complete', canAutoComplete(game), false);
  const allUp = {
    ...game,
    stock: [],
    waste: [],
    tableau: game.tableau.map((p) => p.map((c) => ({ ...c, faceUp: true }))),
  };
  check('all face-up cards with empty stock/waste can auto-complete', canAutoComplete(allUp), true);

  const state = createGame(1, seeded(11));
  state.waste = [{ suit: 'spades', rank: 1, faceUp: true }];
  const move = findAutoMove(state);
  check('findAutoMove prefers the waste pile', move, { type: 'waste' });
  const applied = applyAutoMove(state, move);
  check('applyAutoMove executes the found move', applied.foundations.spades.length, 1);

  const state2 = createGame(1, seeded(12));
  state2.waste = [];
  state2.tableau[3] = [{ suit: 'diamonds', rank: 1, faceUp: true }];
  const move2 = findAutoMove(state2);
  check('findAutoMove falls back to tableau tops', move2, { type: 'tableau', col: 3 });
  const stuck = createGame(1, seeded(13));
  stuck.waste = [];
  stuck.tableau = stuck.tableau.map((p) => (p.length ? [{ suit: 'clubs', rank: 8, faceUp: true }] : p));
  check('findAutoMove returns null when nothing can move', findAutoMove(stuck), null);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
