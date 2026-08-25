// Shuffles deals until one verifies as solvable (see solver.js), instead of handing
// the player whatever the shuffle happened to produce. Runs on a bounded budget —
// most deals verify in well under a second, but a handful of reshuffles or a run of
// unusually hard deals should never hang the UI, so both a per-attempt and an overall
// time budget cap the search and the last (unverified) deal is returned rather than
// looping forever.
import { createGame } from './klondike.js';
import { isSolvable } from './solver.js';

export function dealSolvableGame(drawCount, rng = Math.random, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 15;
  const nodeBudget = opts.nodeBudget ?? 20000;
  const timeBudgetMs = opts.timeBudgetMs ?? 600;
  const overallDeadline = Date.now() + (opts.overallTimeBudgetMs ?? 6000);

  let lastGame = null;
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    const game = createGame(drawCount, rng);
    lastGame = game;
    if (isSolvable(game, { nodeBudget, timeBudgetMs })) {
      return { game, verified: true, attempts: attempts + 1 };
    }
    if (Date.now() > overallDeadline) {
      attempts++;
      break;
    }
  }
  return { game: lastGame, verified: false, attempts };
}
