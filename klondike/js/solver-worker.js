// Runs the solvable-deal search off the main thread so shuffling never freezes the
// board or input. app.js posts { requestId, drawCount } and gets back
// { requestId, game, verified, attempts }.
import { dealSolvableGame } from './dealer.js';

self.onmessage = (e) => {
  const { requestId, drawCount } = e.data;
  const result = dealSolvableGame(drawCount, Math.random);
  self.postMessage({ requestId, ...result });
};
