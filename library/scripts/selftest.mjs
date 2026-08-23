// Quick correctness check for the pure text-splitting helpers and the bundled
// book content — not shipped to the app, dev-only. The DOM-dependent
// pagination/page-flip pieces in js/reader.js are covered separately by
// browser testing (there's no DOM in plain Node), but everything here can run
// headless.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractPlainAndSpans, reconstructHTML, splitParagraphBySentences, compareMarkers,
} from '../js/paginate-text.js';
import { BOOKS, bookById } from '../js/books.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
function ok(label, cond) {
  if (!cond) { failures++; console.log(`FAIL ${label}`); } else console.log(`ok   ${label}`);
}
function eq(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) { failures++; console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); } else console.log(`ok   ${label}`);
}

// ---------- extractPlainAndSpans / reconstructHTML ----------

{
  const { plain, spans } = extractPlainAndSpans('There was nothing so <em>very</em> remarkable in that.');
  eq('extractPlainAndSpans strips tags to plain text', plain, 'There was nothing so very remarkable in that.');
  eq('extractPlainAndSpans records the em span', spans, [{ start: 21, end: 25 }]);
  eq('reconstructHTML round-trips the whole range', reconstructHTML(plain, spans, 0, plain.length),
    'There was nothing so <em>very</em> remarkable in that.');
  eq('reconstructHTML on a sub-range outside the em span', reconstructHTML(plain, spans, 0, 10), 'There was ');
}
{
  // No italics at all.
  const { plain, spans } = extractPlainAndSpans('Plain text, nothing fancy.');
  eq('plain text has no spans', spans, []);
  eq('reconstructHTML with no spans is unchanged', reconstructHTML(plain, spans, 0, plain.length), 'Plain text, nothing fancy.');
}
{
  // A cut point falling inside an italic span splits the <em> correctly on both sides.
  const html = 'Before <em>italic words here</em> after.';
  const { plain, spans } = extractPlainAndSpans(html);
  const cut = plain.indexOf('words'); // lands mid-span
  const left = reconstructHTML(plain, spans, 0, cut);
  const right = reconstructHTML(plain, spans, cut, plain.length);
  ok('left half keeps its partial <em>', left.endsWith('<em>italic </em>'));
  ok('right half keeps its partial <em>', right.startsWith('<em>words here</em>'));
  eq('rejoining the two halves reproduces the plain text exactly', left.replace(/<\/?em>/g, '') + right.replace(/<\/?em>/g, ''), plain);
}

// ---------- splitParagraphBySentences ----------

{
  const chunk = { tag: 'p', html: 'One sentence here. Two sentences now! Is this three? Yes.', blockIndex: 5, wordOffset: 0 };
  const parts = splitParagraphBySentences(chunk);
  ok('splits into 4 sentences', parts.length === 4);
  ok('all parts keep the original blockIndex', parts.every((p) => p.blockIndex === 5));
  ok('wordOffsets are increasing', parts.every((p, i) => i === 0 || p.wordOffset > parts[i - 1].wordOffset));
  const rejoined = parts.map((p) => p.html).join(' ');
  eq('rejoined sentence text matches the source (modulo spacing)', rejoined.replace(/\s+/g, ' '), chunk.html.replace(/\s+/g, ' '));
}
{
  // A paragraph with no sentence-ending punctuation at all still returns itself, not an infinite split.
  const chunk = { tag: 'p', html: 'no terminal punctuation at all', blockIndex: 0, wordOffset: 0 };
  const parts = splitParagraphBySentences(chunk);
  eq('unsplittable paragraph returns as a single part', parts.length, 1);
}

// ---------- compareMarkers ----------

ok('same marker compares equal', compareMarkers({ blockIndex: 3, wordOffset: 5 }, { blockIndex: 3, wordOffset: 5 }) === 0);
ok('later blockIndex sorts after', compareMarkers({ blockIndex: 4, wordOffset: 0 }, { blockIndex: 3, wordOffset: 999 }) > 0);
ok('same block, later wordOffset sorts after', compareMarkers({ blockIndex: 3, wordOffset: 10 }, { blockIndex: 3, wordOffset: 5 }) > 0);

// ---------- bundled book content ----------

ok('6 books registered', BOOKS.length === 6);
for (const meta of BOOKS) {
  const path = join(root, 'content', `${meta.id}.json`);
  let book;
  try {
    book = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    failures++;
    console.log(`FAIL ${meta.id}: content/${meta.id}.json missing or invalid (${e.message})`);
    continue;
  }
  ok(`${meta.id}: id/title/author match registry`, book.id === meta.id && book.title === meta.title && book.author === meta.author);
  ok(`${meta.id}: has blocks`, Array.isArray(book.blocks) && book.blocks.length > 50);
  ok(`${meta.id}: starts with a heading`, book.blocks[0].tag === 'h1' || book.blocks[0].tag === 'h2');
  const badTag = book.blocks.find((b) => !['h1', 'h2', 'p', 'verse'].includes(b.tag));
  ok(`${meta.id}: no unexpected block tags`, !badTag);
  const empty = book.blocks.find((b) => b.html.replace(/<[^>]+>/g, '').trim() === '');
  ok(`${meta.id}: no empty blocks`, !empty);
  // Every <em> is balanced (build-books.mjs regex is non-greedy but paranoia is cheap).
  const unbalanced = book.blocks.find((b) => (b.html.match(/<em>/g) || []).length !== (b.html.match(/<\/em>/g) || []).length);
  ok(`${meta.id}: <em> tags are balanced`, !unbalanced);
  ok(`bookById('${meta.id}') resolves`, bookById(meta.id) === meta);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
