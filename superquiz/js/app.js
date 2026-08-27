import { QUIZ_SETS } from './questions.js';

const difficultyRowEl = document.getElementById('difficultyRow');
const categorySelectEl = document.getElementById('categorySelect');
const categoryEl = document.getElementById('category');
const quizListEl = document.getElementById('quizList');
const contentEl = document.getElementById('content');
const btnNewQuiz = document.getElementById('btnNewQuiz');
const toastEl = document.getElementById('toast');

const DIFFICULTIES = [
  { key: 'mixed', label: 'Mixed' },
  { key: 'easy', label: 'Freshman' },
  { key: 'medium', label: 'Graduate' },
  { key: 'hard', label: 'Ph.D.' },
];

const state = {
  difficulty: localStorage.getItem('superquiz_difficulty') || 'mixed',
  category: localStorage.getItem('superquiz_category') || 'all',
  set: null, // the currently displayed quiz set: { c, d, qa }
};

// The book's category headings are printed in all caps; anything already mixed
// case (the three "Freshman/Graduate/Ph.D. Level: <name>" sets) is left alone.
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in',
  'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'with',
]);

function titleCase(str) {
  if (str !== str.toUpperCase()) return str;
  let firstWordSeen = false;
  return str.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) => {
    const lower = word.toLowerCase();
    const capitalized = word[0].toUpperCase() + lower.slice(1);
    if (!firstWordSeen) {
      firstWordSeen = true;
      return capitalized;
    }
    return (MINOR_WORDS.has(lower) && word.length > 1) ? lower : capitalized;
  });
}

const CATEGORIES = [...new Set(QUIZ_SETS.map((s) => s.c))]
  .sort((a, b) => titleCase(a).localeCompare(titleCase(b)));

if (state.category !== 'all' && !CATEGORIES.includes(state.category)) {
  state.category = 'all';
}

function poolFor(difficulty, category) {
  return QUIZ_SETS.filter((s) =>
    (difficulty === 'mixed' || s.d === difficulty)
    && (category === 'all' || s.c === category));
}

function pickSet() {
  // A category can be tied to a single difficulty (a few of the book's named
  // sets); fall back to ignoring difficulty rather than coming up empty.
  let pool = poolFor(state.difficulty, state.category);
  if (pool.length === 0) {
    pool = poolFor('mixed', state.category);
  }
  let candidates = pool;
  if (pool.length > 1 && state.set) {
    const filtered = pool.filter((s) => s !== state.set);
    if (filtered.length > 0) candidates = filtered;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function renderCategorySelect() {
  categorySelectEl.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All Categories';
  categorySelectEl.appendChild(allOpt);
  for (const c of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = titleCase(c);
    categorySelectEl.appendChild(opt);
  }
  categorySelectEl.value = state.category;
}

function renderDifficultyRow() {
  difficultyRowEl.innerHTML = '';
  for (const { key, label } of DIFFICULTIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `diff-btn${key === state.difficulty ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (state.difficulty === key) return;
      state.difficulty = key;
      localStorage.setItem('superquiz_difficulty', key);
      renderDifficultyRow();
      newQuiz();
    });
    difficultyRowEl.appendChild(btn);
  }
}

function renderQuiz() {
  const { set } = state;
  const levelLabel = DIFFICULTIES.find((d) => d.key === set.d).label;
  categoryEl.textContent = `${titleCase(set.c)} — ${levelLabel} Level`;

  quizListEl.innerHTML = '';
  set.qa.forEach(([question, answer], i) => {
    const li = document.createElement('li');
    li.className = 'qcard';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qcard-btn';
    btn.setAttribute('aria-expanded', 'false');

    const num = document.createElement('span');
    num.className = 'qnum';
    num.textContent = String(i + 1);

    const qtext = document.createElement('span');
    qtext.className = 'qtext';
    qtext.textContent = question;

    const atext = document.createElement('span');
    atext.className = 'atext';
    atext.textContent = answer;

    btn.append(num, qtext, atext);
    li.appendChild(btn);
    quizListEl.appendChild(li);
  });

  contentEl.scrollTop = 0;
}

function newQuiz() {
  state.set = pickSet();
  renderQuiz();
}

quizListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.qcard-btn');
  if (!btn) return;
  const li = btn.closest('.qcard');
  const revealed = li.classList.toggle('revealed');
  btn.setAttribute('aria-expanded', String(revealed));
});

categorySelectEl.addEventListener('change', () => {
  state.category = categorySelectEl.value;
  localStorage.setItem('superquiz_category', state.category);
  newQuiz();
});

btnNewQuiz.addEventListener('click', newQuiz);

// ---------- service worker: install-once cache, background updates ----------

if ('serviceWorker' in navigator) {
  let priorControllerURL = navigator.serviceWorker.controller
    && navigator.serviceWorker.controller.scriptURL;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const newURL = navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.scriptURL;
    if (priorControllerURL && newURL === priorControllerURL) {
      showToast('Updated — tap to refresh', () => window.location.reload());
    }
    priorControllerURL = newURL;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((reg) => {
      const update = () => reg.update();
      setInterval(update, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) update();
      });
    });
  });
}

function showToast(text, onTap) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.onclick = () => {
    toastEl.hidden = true;
    if (onTap) onTap();
  };
}

// ---------- iOS "add to home screen" hint (no programmatic install API on iOS) ----------

(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = document.documentElement.classList.contains('standalone');
  const dismissed = localStorage.getItem('superquiz_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('superquiz_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

renderDifficultyRow();
renderCategorySelect();
newQuiz();
