// Correctness check for the Republican Calendar conversion — not shipped to the app,
// dev-only. Checks against well-documented historical correspondences.
import { fromGregorian, formatRevDate, daySymbol, decimalTime } from '../js/revcal.js';
import { FRENCH_MONTHS, DAY_NAMES } from '../js/data.js';

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got "${actual}"${ok ? '' : `, expected "${expected}"`}`);
  if (!ok) process.exitCode = 1;
}

// 1 Vendémiaire An I: the calendar's own epoch.
check(
  'epoch day',
  formatRevDate(fromGregorian(new Date(1792, 8, 22)), FRENCH_MONTHS),
  '1 Vendémiaire I (1)',
);

// 9 Thermidor An II: the day Robespierre fell (27 July 1794).
check(
  'Thermidorian Reaction',
  formatRevDate(fromGregorian(new Date(1794, 6, 27)), FRENCH_MONTHS),
  '9 Thermidor II (2)',
);

// 18 Brumaire An VIII: Napoleon's coup (9 November 1799).
check(
  '18 Brumaire coup',
  formatRevDate(fromGregorian(new Date(1799, 10, 9)), FRENCH_MONTHS),
  '18 Brumaire VIII (8)',
);

// 11 Nivôse An XIV: the calendar was abolished effective 1 January 1806.
check(
  'abolition date',
  formatRevDate(fromGregorian(new Date(1806, 0, 1)), FRENCH_MONTHS),
  '11 Nivôse XIV (14)',
);

// Day-name lookup: day 1 of year 1 is Raisin (Grape), the calendar's first named day.
check(
  'first day symbol',
  daySymbol(fromGregorian(new Date(1792, 8, 22)), DAY_NAMES),
  'Raisin (Grape)',
);

// Sansculottides day symbol (year II was a leap year, so has a 6th, "Révolution" day).
check(
  'leap sansculottide symbol',
  daySymbol({ year: 2, month: 13, day: 6 }, DAY_NAMES),
  'La Fête de la Révolution (Celebration of the Revolution)',
);

// Decimal time: exact local midnight is 0:00:00, exact local noon is 5:00:00.
const midnight = new Date(2026, 0, 1, 0, 0, 0, 0);
check('midnight decimal time', decimalTime(midnight), '0:00:00');
const noon = new Date(2026, 0, 1, 12, 0, 0, 0);
check('noon decimal time', decimalTime(noon), '5:00:00');

if (process.exitCode === 1) {
  console.error('\nSome checks failed.');
} else {
  console.log('\nAll checks passed.');
}
