import { BOOKS, bookById } from './books.js';
import { createReader } from './reader.js';

const bookcaseView = document.getElementById('bookcaseView');
const readerView = document.getElementById('readerView');
const shelfEl = document.getElementById('shelf');
const btnBack = document.getElementById('btnBack');
const readerBookTitle = document.getElementById('readerBookTitle');
const readerChapter = document.getElementById('readerChapter');
const pageIndicator = document.getElementById('pageIndicator');
const toastEl = document.getElementById('toast');

// ---------- bookcase ----------

for (const book of BOOKS) {
  const cover = document.createElement('button');
  cover.type = 'button';
  cover.className = `cover cover--${book.cover}`;
  cover.dataset.bookId = book.id;
  cover.setAttribute('aria-label', `Open ${book.title} by ${book.author}`);
  cover.innerHTML = `
    <svg class="cover-art" viewBox="0 0 100 100" aria-hidden="true">${book.icon}</svg>
    <span class="cover-title">${book.title}</span>
    <span class="cover-author">${book.author}</span>
  `;
  shelfEl.appendChild(cover);
}

shelfEl.addEventListener('click', (e) => {
  const cover = e.target.closest('.cover');
  if (!cover) return;
  openBook(cover.dataset.bookId);
});

// ---------- reader wiring ----------

const bookCache = new Map();

const reader = createReader({
  pageEl: document.getElementById('page'),
  leafEl: document.getElementById('pageLeaf'),
  underEl: document.getElementById('pageUnder'),
  measureEl: document.getElementById('measure'),
  onPageChange: (index, count, chapterLabel) => {
    readerChapter.textContent = chapterLabel;
    pageIndicator.textContent = count > 0 ? `Page ${index + 1} of ${count}` : '';
  },
});

async function fetchBookContent(id) {
  if (bookCache.has(id)) return bookCache.get(id);
  const res = await fetch(`content/${id}.json`);
  const data = await res.json();
  bookCache.set(id, data);
  return data;
}

async function openBook(id) {
  const meta = bookById(id);
  if (!meta) return;
  readerBookTitle.textContent = meta.title;
  readerChapter.textContent = '';
  pageIndicator.textContent = '';
  bookcaseView.classList.add('hidden');
  readerView.classList.remove('hidden');
  const content = await fetchBookContent(id);
  reader.loadBook(content);
}

function closeBook() {
  readerView.classList.add('hidden');
  bookcaseView.classList.remove('hidden');
}

btnBack.addEventListener('click', closeBook);

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (readerView.classList.contains('hidden')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => reader.repaginate(), 150);
});

// Stop iOS's copy/select callout bar from popping up on repeated taps, without
// blocking real clicks on buttons or the page-flip gesture area (which needs
// its own pointerdown/up handling in reader.js, unaffected by this).
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button')) return;
  e.preventDefault();
}, { passive: false });

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
  const dismissed = localStorage.getItem('lib_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('lib_ios_hint_dismissed', '1');
    });
  }, 1500);
})();
