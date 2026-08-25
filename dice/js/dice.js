// Dice pool logic: which dice are queued to roll, and rolling them. No DOM
// here — keeps this testable from scripts/selftest.mjs without a browser.
// Pool management functions return a new pool array rather than mutating
// their input, matching the immutable-state style used across these apps.

export const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];

// Plenty for any tabletop use (stat rolls, dice-pool systems like Shadowrun)
// without letting the results grid grow unmanageably large.
export const MAX_PER_TYPE = 20;

export function rollDie(sides, rng = Math.random) {
  return 1 + Math.floor(rng() * sides);
}

// pool: array of { sides, count }, sorted ascending by sides.
export function addDie(pool, sides) {
  const next = pool.map((e) => ({ ...e }));
  const existing = next.find((e) => e.sides === sides);
  if (existing) {
    if (existing.count >= MAX_PER_TYPE) return next;
    existing.count += 1;
  } else {
    next.push({ sides, count: 1 });
  }
  return next.sort((a, b) => a.sides - b.sides);
}

export function removeDie(pool, sides) {
  const next = [];
  for (const e of pool) {
    if (e.sides !== sides) {
      next.push({ ...e });
    } else if (e.count > 1) {
      next.push({ ...e, count: e.count - 1 });
    }
  }
  return next;
}

export function removeAllOfType(pool, sides) {
  return pool.filter((e) => e.sides !== sides);
}

export function clearPool() {
  return [];
}

export function totalDiceCount(pool) {
  return pool.reduce((n, e) => n + e.count, 0);
}

// Flattens the pool into individual die rolls — one entry per physical die,
// in pool order (ascending sides, then roll order within a type).
export function rollPool(pool, rng = Math.random) {
  const rolls = [];
  for (const { sides, count } of pool) {
    for (let i = 0; i < count; i++) {
      rolls.push({ sides, value: rollDie(sides, rng) });
    }
  }
  return rolls;
}

export function sumRolls(rolls) {
  return rolls.reduce((sum, r) => sum + r.value, 0);
}

export function isMaxRoll(roll) {
  return roll.value === roll.sides;
}

export function isMinRoll(roll) {
  return roll.value === 1;
}
