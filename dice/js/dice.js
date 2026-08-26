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
// in pool order (ascending sides, then roll order within a type). `heldRolls`
// (entries from a previous rollPool() result, e.g. ones the player marked
// held) are reused as-is instead of re-rolled, up to how many of that type
// the pool currently has — extra pool slots of that type still get a fresh
// roll, and held entries whose type no longer appears in the pool are
// dropped. This lets a hold survive the pool being edited between rolls.
export function rollPool(pool, rng = Math.random, heldRolls = []) {
  const heldBySides = new Map();
  for (const r of heldRolls) {
    if (!heldBySides.has(r.sides)) heldBySides.set(r.sides, []);
    heldBySides.get(r.sides).push(r);
  }
  const rolls = [];
  for (const { sides, count } of pool) {
    const held = heldBySides.get(sides) || [];
    for (let i = 0; i < count; i++) {
      rolls.push(i < held.length ? held[i] : { sides, value: rollDie(sides, rng) });
    }
  }
  return rolls;
}

// How many dice in `pool` would still get a fresh roll from
// rollPool(pool, rng, heldRolls) — i.e. the pool's dice not covered by a held
// entry of the same type. Used to keep the Roll button's count honest once
// some dice are held.
export function countUnheld(pool, heldRolls) {
  const heldCountBySides = new Map();
  for (const r of heldRolls) heldCountBySides.set(r.sides, (heldCountBySides.get(r.sides) || 0) + 1);
  let unheld = 0;
  for (const { sides, count } of pool) {
    unheld += Math.max(count - (heldCountBySides.get(sides) || 0), 0);
  }
  return unheld;
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
