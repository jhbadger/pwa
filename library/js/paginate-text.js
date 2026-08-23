// Pure text-splitting helpers used by the pagination engine (js/reader.js).
// No DOM here — keeps this testable from scripts/selftest.mjs without a browser.
//
// Content blocks only ever contain <em> as inline markup (see build-books.mjs),
// so splitting rich text is tractable with plain string/interval math instead
// of DOM Range surgery: pull out the plain text plus the character ranges that
// were italicized, cut the plain text wherever we like, then re-wrap whichever
// ranges survive in each cut with <em>.

export function extractPlainAndSpans(html) {
  const spans = [];
  let plain = '';
  const re = /<em>(.*?)<\/em>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const start = plain.length;
      plain += m[1];
      spans.push({ start, end: plain.length });
    } else {
      plain += m[2];
    }
  }
  return { plain, spans };
}

export function reconstructHTML(plain, spans, from, to) {
  const cuts = new Set([from, to]);
  for (const sp of spans) {
    if (sp.start > from && sp.start < to) cuts.add(sp.start);
    if (sp.end > from && sp.end < to) cuts.add(sp.end);
  }
  const points = Array.from(cuts).sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = plain.slice(a, b);
    if (!seg) continue;
    const isEm = spans.some((sp) => sp.start <= a && sp.end >= b);
    html += isEm ? `<em>${seg}</em>` : seg;
  }
  return html;
}

function countWords(s) {
  const trimmed = s.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

// Splits a paragraph chunk into sentence-sized chunks, each carrying a
// wordOffset measured from the start of the ORIGINAL paragraph — stable
// across repagination even though how a paragraph gets chunked can change
// with viewport/font size. Used only as a fallback when a whole paragraph is
// taller than an empty page.
export function splitParagraphBySentences(chunk) {
  const { plain, spans } = extractPlainAndSpans(chunk.html);
  const sentenceRe = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const matches = plain.match(sentenceRe) || [plain];
  const result = [];
  let offset = 0;
  for (const s of matches) {
    if (s.length === 0) continue;
    const from = offset;
    const to = offset + s.length;
    const wordsBefore = countWords(plain.slice(0, from));
    result.push({
      tag: 'p',
      html: reconstructHTML(plain, spans, from, to),
      blockIndex: chunk.blockIndex,
      wordOffset: chunk.wordOffset + wordsBefore,
    });
    offset = to;
  }
  return result;
}

// Ordering for saved position markers ({blockIndex, wordOffset}), used to find
// which page a saved position falls on after (re)pagination.
export function compareMarkers(a, b) {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
  return a.wordOffset - b.wordOffset;
}
