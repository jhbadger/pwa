import { splitParagraphBySentences, compareMarkers } from './paginate-text.js';

const STORAGE_PREFIX = 'library_pos_';

function loadPosition(bookId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + bookId);
    if (!raw) return { blockIndex: -1, wordOffset: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed.blockIndex === 'number' && typeof parsed.wordOffset === 'number') return parsed;
  } catch { /* corrupt/old data — start over */ }
  return { blockIndex: -1, wordOffset: 0 };
}

function savePosition(bookId, marker) {
  localStorage.setItem(STORAGE_PREFIX + bookId, JSON.stringify(marker));
}

function renderChunkHTML(chunk) {
  if (chunk.tag === 'h1') return `<h1>${chunk.html}</h1>`;
  if (chunk.tag === 'h2') return `<h2>${chunk.html}</h2>`;
  if (chunk.tag === 'verse') return `<p class="verse">${chunk.html}</p>`;
  if (chunk.tag === 'title') return `<div class="title-page">${chunk.html}</div>`;
  return `<p>${chunk.html}</p>`;
}

function pageHTML(chunks) {
  return chunks.map(renderChunkHTML).join('');
}

// Greedily fills pages with whole blocks; a block too tall to fit on even an
// empty page is broken into sentence-sized pieces (see paginate-text.js) —
// the one case classic-literature prose can hit given a small enough viewport
// or large enough font.
function paginate(blocks, measureEl, pageHeight) {
  const queue = blocks.map((b, i) => ({ ...b, blockIndex: i, wordOffset: 0 }));
  const pages = [];
  let current = [];
  let currentStart = null;

  function fits(chunks) {
    measureEl.innerHTML = pageHTML(chunks);
    return measureEl.getBoundingClientRect().height <= pageHeight;
  }

  while (queue.length > 0) {
    const chunk = queue[0];
    if (currentStart === null) currentStart = { blockIndex: chunk.blockIndex, wordOffset: chunk.wordOffset };
    if (fits([...current, chunk])) {
      current.push(chunk);
      queue.shift();
      continue;
    }
    if (current.length > 0) {
      pages.push({ start: currentStart, html: pageHTML(current) });
      current = [];
      currentStart = null;
      continue; // retry this same chunk against a fresh page
    }
    if (fits([chunk])) {
      current = [chunk];
      continue;
    }
    if (chunk.tag === 'p') {
      const parts = splitParagraphBySentences(chunk);
      if (parts.length > 1) {
        queue.splice(0, 1, ...parts);
        continue;
      }
    }
    // Unsplittable and still too tall (a heading, a verse, or a single
    // sentence longer than the page) — place it alone and accept overflow
    // rather than lose content.
    current = [chunk];
    queue.shift();
  }
  if (current.length > 0) pages.push({ start: currentStart, html: pageHTML(current) });
  return pages;
}

function findPageForMarker(pages, marker) {
  let idx = 0;
  for (let i = 0; i < pages.length; i++) {
    if (compareMarkers(pages[i].start, marker) <= 0) idx = i;
    else break;
  }
  return idx;
}

export function createReader({ pageEl, leafEl, underEl, measureEl, onPageChange }) {
  let pages = [];
  let currentIndex = 0;
  let bookId = null;
  let titleBlock = null;
  let contentBlocks = [];

  function setAngle(deg) {
    const rad = (deg * Math.PI) / 180;
    leafEl.style.transform = `rotateY(${deg}deg)`;
    leafEl.style.setProperty('--shadow', String(Math.abs(Math.sin(rad))));
  }

  // The title page is always its own dedicated first page rather than a block
  // fed through paginate(): it's styled to fill the whole page (see
  // .title-page { height: 100% }), which the offscreen .measure element has
  // no equivalent notion of (its height is auto, by design, so pagination can
  // measure blocks at their natural size) — measuring it there would report a
  // tiny height and let real content get packed onto the same page, which
  // then renders wrong since the true title page visually claims the whole
  // page. A marker of blockIndex -1 sorts before all real content.
  function buildPages(pageHeight) {
    const titlePage = { start: { blockIndex: -1, wordOffset: 0 }, html: pageHTML([titleBlock]) };
    return [titlePage, ...paginate(contentBlocks, measureEl, pageHeight)];
  }

  function chapterLabelForIndex(index) {
    const page = pages[index];
    if (!page || page.start.blockIndex < 0) return '';
    for (let bi = page.start.blockIndex; bi >= 0; bi--) {
      const b = contentBlocks[bi];
      if (b && (b.tag === 'h1' || b.tag === 'h2')) {
        return b.html.split('<br>')[0].replace(/<[^>]+>/g, '');
      }
    }
    return '';
  }

  function showPage(index) {
    currentIndex = Math.max(0, Math.min(pages.length - 1, index));
    leafEl.style.transition = 'none';
    // At rest the leaf sits at rotateY(0), fully facing the viewer, painted
    // after (so on top of) .page-under — it must carry the visible content,
    // or an empty-but-opaque leaf just hides whatever page-under shows.
    leafEl.innerHTML = pages[currentIndex] ? pages[currentIndex].html : '';
    underEl.innerHTML = '';
    setAngle(0);
    // Force layout so the transition:none takes effect before any future change.
    void leafEl.offsetHeight;
    leafEl.style.transition = '';
    if (bookId) savePosition(bookId, pages[currentIndex] ? pages[currentIndex].start : { blockIndex: -1, wordOffset: 0 });
    if (onPageChange) onPageChange(currentIndex, pages.length, chapterLabelForIndex(currentIndex));
  }

  function repaginate() {
    const pageHeight = pageEl.clientHeight;
    measureEl.style.width = `${pageEl.clientWidth}px`;
    const marker = pages[currentIndex] ? pages[currentIndex].start : loadPosition(bookId);
    pages = buildPages(pageHeight);
    const newIndex = findPageForMarker(pages, marker);
    showPage(newIndex);
  }

  function loadBook(book) {
    bookId = book.id;
    titleBlock = { tag: 'title', html: `<h1>${book.title}</h1><p class="byline">${book.author}</p>` };
    contentBlocks = book.blocks;
    const savedMarker = loadPosition(bookId);
    const pageHeight = pageEl.clientHeight;
    measureEl.style.width = `${pageEl.clientWidth}px`;
    pages = buildPages(pageHeight);
    const startIndex = findPageForMarker(pages, savedMarker);
    showPage(startIndex);
  }

  // ---------- interactive flip gesture ----------

  let drag = null; // { forward, startX, startTime, width }

  function beginFlip(forward) {
    const target = forward ? currentIndex + 1 : currentIndex - 1;
    if (target < 0 || target >= pages.length) return false;
    leafEl.style.transition = 'none';
    if (forward) {
      leafEl.innerHTML = pages[currentIndex].html;
      underEl.innerHTML = pages[target].html;
      setAngle(0);
    } else {
      leafEl.innerHTML = pages[target].html;
      underEl.innerHTML = pages[currentIndex].html;
      setAngle(-180);
    }
    void leafEl.offsetHeight;
    leafEl.style.transition = '';
    return true;
  }

  function angleForDrag(forward, dx, width) {
    const ratio = Math.max(-1, Math.min(1, dx / width));
    return forward ? Math.max(-180, Math.min(0, ratio * 180)) : Math.max(-180, Math.min(0, -180 + ratio * 180));
  }

  function finishFlip(forward, completed) {
    const target = forward ? currentIndex + 1 : currentIndex - 1;
    leafEl.style.transition = 'transform 220ms ease-out';
    setAngle(completed ? (forward ? -180 : 0) : (forward ? 0 : -180));
    const onEnd = () => {
      leafEl.removeEventListener('transitionend', onEnd);
      leafEl.style.transition = 'none';
      if (completed) showPage(target);
      else showPage(currentIndex);
    };
    leafEl.addEventListener('transitionend', onEnd);
  }

  pageEl.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const rect = pageEl.getBoundingClientRect();
    const forward = (e.clientX - rect.left) > rect.width / 2;
    if (!beginFlip(forward)) return;
    drag = { forward, startX: e.clientX, startTime: Date.now(), width: rect.width };
    try { pageEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  pageEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    setAngle(angleForDrag(drag.forward, dx, drag.width));
  });

  function endDrag(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const isTap = Math.abs(dx) < 10 && (Date.now() - drag.startTime) < 300;
    const threshold = drag.width * 0.3;
    const completed = isTap ? true : (drag.forward ? dx < -threshold : dx > threshold);
    finishFlip(drag.forward, completed);
    drag = null;
  }

  pageEl.addEventListener('pointerup', endDrag);
  pageEl.addEventListener('pointercancel', endDrag);

  return {
    loadBook,
    repaginate,
    nextPage: () => { if (beginFlip(true)) finishFlip(true, true); },
    prevPage: () => { if (beginFlip(false)) finishFlip(false, true); },
    get currentIndex() { return currentIndex; },
    get pageCount() { return pages.length; },
  };
}
