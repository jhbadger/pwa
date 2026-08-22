import { FRENCH_MONTHS, CARLYLE_MONTHS, SATIRE_MONTHS, DAY_NAMES } from './data.js';
import { fromGregorian, formatRevDate, daySymbol, decimalTime } from './revcal.js';

const MONTH_SETS = { french: FRENCH_MONTHS, carlyle: CARLYLE_MONTHS, satire: SATIRE_MONTHS };
const STYLE_KEY = 'thermidor.monthStyle';

const revDateEl = document.getElementById('revDate');
const symbolEl = document.getElementById('symbol');
const clockEl = document.getElementById('clock');
const datePicker = document.getElementById('datePicker');
const btnToday = document.getElementById('btnToday');
const btnSettings = document.getElementById('btnSettings');
const btnAbout = document.getElementById('btnAbout');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const aboutBackdrop = document.getElementById('aboutBackdrop');
const btnSettingsClose = document.getElementById('btnSettingsClose');
const btnAboutClose = document.getElementById('btnAboutClose');
const monthStyleGroup = document.getElementById('monthStyleGroup');
const toast = document.getElementById('toast');

let monthStyle = localStorage.getItem(STYLE_KEY) || 'french';
for (const input of monthStyleGroup.querySelectorAll('input')) {
  input.checked = input.value === monthStyle;
}

// Local date (not UTC) from a "YYYY-MM-DD" <input type="date"> value.
function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderDate(date) {
  const revDate = fromGregorian(date);
  const months = MONTH_SETS[monthStyle];
  revDateEl.textContent = formatRevDate(revDate, months);
  symbolEl.textContent = daySymbol(revDate, DAY_NAMES);
}

function showToday() {
  const today = new Date();
  datePicker.value = toInputValue(today);
  renderDate(today);
}

datePicker.addEventListener('change', () => {
  if (!datePicker.value) return showToday();
  renderDate(parseLocalDate(datePicker.value));
});

btnToday.addEventListener('click', showToday);

showToday();

// ---------- decimal clock ----------

let clockTimer = null;

function tickClock() {
  clockEl.textContent = decimalTime(new Date());
}

function startClock() {
  if (clockTimer) return;
  tickClock();
  clockTimer = setInterval(tickClock, 100);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

startClock();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopClock();
  } else {
    startClock();
    // Mirrors the original app's onResume(), which always jumps back to today.
    showToday();
  }
});

// ---------- settings sheet ----------

function openSheet(backdrop) {
  backdrop.hidden = false;
}

function closeSheet(backdrop) {
  backdrop.hidden = true;
}

btnSettings.addEventListener('click', () => openSheet(settingsBackdrop));
btnSettingsClose.addEventListener('click', () => closeSheet(settingsBackdrop));
settingsBackdrop.addEventListener('click', (e) => {
  if (e.target === settingsBackdrop) closeSheet(settingsBackdrop);
});

monthStyleGroup.addEventListener('change', (e) => {
  if (e.target.name !== 'monthStyle') return;
  monthStyle = e.target.value;
  localStorage.setItem(STYLE_KEY, monthStyle);
  renderDate(datePicker.value ? parseLocalDate(datePicker.value) : new Date());
});

btnAbout.addEventListener('click', () => openSheet(aboutBackdrop));
btnAboutClose.addEventListener('click', () => closeSheet(aboutBackdrop));
aboutBackdrop.addEventListener('click', (e) => {
  if (e.target === aboutBackdrop) closeSheet(aboutBackdrop);
});

// ---------- service worker updates ----------

if ('serviceWorker' in navigator) {
  const hadControllerAtLoad = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (hadControllerAtLoad) {
      toast.textContent = 'New version available — tap to refresh';
      toast.hidden = false;
      toast.addEventListener('click', () => {
        reloading = true;
        window.location.reload();
      }, { once: true });
    }
  });

  navigator.serviceWorker.ready.then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update();
    });
    setInterval(() => reg.update(), 60 * 60 * 1000);
  });
}
