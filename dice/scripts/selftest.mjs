// Quick correctness check for the dice pool logic — not shipped to the app, dev-only.
import {
  DIE_TYPES, MAX_PER_TYPE, rollDie, addDie, removeDie, removeAllOfType, clearPool,
  totalDiceCount, rollPool, countUnheld, sumRolls, isMaxRoll, isMinRoll,
} from '../js/dice.js';

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

// A seeded rng (mulberry32) so rolls are deterministic across test runs.
function seeded(seed) {
  let a = seed;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- DIE_TYPES ----------
check('DIE_TYPES lists the seven standard polyhedral dice', DIE_TYPES, [4, 6, 8, 10, 12, 20, 100]);

// ---------- rollDie ----------
{
  const rng = seeded(1);
  for (let i = 0; i < 500; i++) {
    const v = rollDie(6, rng);
    if (v < 1 || v > 6 || !Number.isInteger(v)) {
      failures++;
      console.log(`FAIL rollDie(6) produced out-of-range value: ${v}`);
      break;
    }
  }
  console.log('ok   rollDie(6) stays within 1..6 over many rolls');

  check('rollDie(1, () => 0) is always 1', rollDie(1, () => 0), 1);
  check('rollDie(20, () => 0.999) is 20', rollDie(20, () => 0.999), 20);
  check('rollDie(20, () => 0) is 1', rollDie(20, () => 0), 1);
}

// ---------- pool management ----------
{
  let pool = clearPool();
  check('clearPool starts empty', pool, []);

  pool = addDie(pool, 6);
  check('addDie creates a new entry for an unseen type', pool, [{ sides: 6, count: 1 }]);

  pool = addDie(pool, 6);
  check('addDie increments an existing type', pool, [{ sides: 6, count: 2 }]);

  pool = addDie(pool, 20);
  check('addDie keeps the pool sorted by sides', pool, [{ sides: 6, count: 2 }, { sides: 20, count: 1 }]);

  check('totalDiceCount sums every entry', totalDiceCount(pool), 3);

  pool = removeDie(pool, 6);
  check('removeDie decrements without dropping the entry above 1', pool, [{ sides: 6, count: 1 }, { sides: 20, count: 1 }]);

  pool = removeDie(pool, 6);
  check('removeDie drops the entry once its count reaches 0', pool, [{ sides: 20, count: 1 }]);

  check('removeDie on an absent type is a no-op', removeDie(pool, 8), [{ sides: 20, count: 1 }]);

  pool = addDie(pool, 20);
  pool = removeAllOfType(pool, 20);
  check('removeAllOfType drops the whole entry regardless of count', pool, []);

  let capped = [];
  for (let i = 0; i < MAX_PER_TYPE + 5; i++) capped = addDie(capped, 4);
  check(`addDie caps a single type at MAX_PER_TYPE (${MAX_PER_TYPE})`, capped, [{ sides: 4, count: MAX_PER_TYPE }]);
}

// ---------- rolling ----------
{
  const pool = [{ sides: 6, count: 3 }, { sides: 20, count: 1 }];
  const rolls = rollPool(pool, seeded(2));
  check('rollPool produces one roll per physical die', rolls.length, 4);
  check('rollPool preserves pool order (ascending sides)', rolls.map((r) => r.sides), [6, 6, 6, 20]);
  check('every roll stays within its own die\'s range', rolls.every((r) => r.value >= 1 && r.value <= r.sides), true);

  const fixedRolls = [{ sides: 6, value: 6 }, { sides: 6, value: 1 }, { sides: 20, value: 11 }];
  check('sumRolls adds every value', sumRolls(fixedRolls), 18);
  check('sumRolls of an empty roll is 0', sumRolls([]), 0);

  check('isMaxRoll is true only when value equals sides', isMaxRoll({ sides: 6, value: 6 }), true);
  check('isMaxRoll is false for a non-max roll', isMaxRoll({ sides: 6, value: 5 }), false);
  check('isMinRoll is true only for a natural 1', isMinRoll({ sides: 20, value: 1 }), true);
  check('isMinRoll is false for a non-1 roll', isMinRoll({ sides: 20, value: 2 }), false);

  check('rollPool on an empty pool returns no rolls', rollPool([], seeded(3)), []);
}

// ---------- holding dice between rolls ----------
{
  const pool = [{ sides: 6, count: 3 }, { sides: 20, count: 1 }];
  const held = [{ sides: 6, value: 4, held: true }];
  const rolls = rollPool(pool, seeded(4), held);
  check('rollPool keeps a held die\'s exact entry', rolls[0], { sides: 6, value: 4, held: true });
  check('rollPool still rolls the rest of that type fresh', rolls.length, 4);
  check('rollPool leaves untouched types alone', rolls[3].sides, 20);

  check('countUnheld subtracts held dice of the same type', countUnheld(pool, held), 3);
  check('countUnheld never goes negative for a shrunken pool', countUnheld([{ sides: 6, count: 0 }], held), 0);
  check('countUnheld ignores held dice of a type no longer in the pool', countUnheld([{ sides: 20, count: 1 }], held), 1);
  check('countUnheld with nothing held equals the full pool', countUnheld(pool, []), 4);

  const allHeld = [{ sides: 6, value: 2, held: true }, { sides: 6, value: 5, held: true }, { sides: 6, value: 1, held: true }];
  const shrunkPool = [{ sides: 6, count: 2 }];
  const rerolled = rollPool(shrunkPool, seeded(5), allHeld);
  check('rollPool drops held entries beyond the pool\'s current count for that type', rerolled.length, 2);
  check('rollPool keeps the first held entries when the type shrinks', rerolled, [allHeld[0], allHeld[1]]);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
