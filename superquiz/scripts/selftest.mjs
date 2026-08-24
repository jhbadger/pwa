// Data integrity check for the extracted quiz sets — not shipped to the app, dev-only.
import { QUIZ_SETS } from '../js/questions.js';

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.log(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

check('has a substantial number of quiz sets', QUIZ_SETS.length > 400);

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
let allTenPairs = true;
let allNonEmpty = true;
let allValidDifficulty = true;
const byDifficulty = { easy: 0, medium: 0, hard: 0 };

for (const set of QUIZ_SETS) {
  if (!Array.isArray(set.qa) || set.qa.length !== 10) allTenPairs = false;
  if (!VALID_DIFFICULTIES.has(set.d)) allValidDifficulty = false;
  else byDifficulty[set.d]++;
  if (!set.c || !set.c.trim()) allNonEmpty = false;
  for (const pair of set.qa || []) {
    if (!Array.isArray(pair) || pair.length !== 2) { allNonEmpty = false; continue; }
    const [q, a] = pair;
    if (!q || !q.trim() || !a || !a.trim()) allNonEmpty = false;
  }
}

check('every set has exactly 10 question/answer pairs', allTenPairs);
check('every question and answer is non-empty', allNonEmpty);
check('every set has a valid difficulty (easy/medium/hard)', allValidDifficulty);
check('each difficulty level has at least 100 sets', Object.values(byDifficulty).every((n) => n >= 100));

console.log(`\nSets by difficulty: easy=${byDifficulty.easy} medium=${byDifficulty.medium} hard=${byDifficulty.hard}`);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
