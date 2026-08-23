#!/usr/bin/env node
// Fetches the plain-text Project Gutenberg editions of the bundled books and
// converts each into a small JSON blob of semantic blocks (headings/paragraphs)
// that js/reader.js can paginate and render. Dev-only — not shipped to the app;
// re-run this after adding a book or if a source edition changes:
//   node scripts/build-books.mjs
//
// Each book needs a little bespoke parsing because Gutenberg's plain-text
// editions don't share one heading format: Alice and Dracula write "CHAPTER I."
// alone on a line with the title on/near the next line; Call of the Wild packs
// the title onto the same line ("Chapter I. Into the Primitive"); Treasure
// Island uses bare roman numerals ("I") for chapters and "PART ONE--..." for
// its six parts. Every book's front matter (title page, table of contents)
// looks superficially similar to a real heading, so each config's regexes are
// anchored precisely enough (exact trailing content, no leading indent) to
// reject the table-of-contents copy and match only the real heading line.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'content');
mkdirSync(outDir, { recursive: true });

const BOOKS = [
  {
    id: 'alice',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    gutenbergId: 11,
    // Bare "CHAPTER I." — the table of contents has trailing title text on the
    // same line, so this exact end-of-line anchor skips it.
    chapterRe: /^CHAPTER\s+[IVXLC]+\.$/,
    endLine: (line) => line.trim() === 'THE END',
  },
  {
    id: 'treasure-island',
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    gutenbergId: 120,
    // Bare roman numeral alone on a line. The table of contents pairs each
    // numeral with a period and title text, so it never matches this exactly.
    chapterRe: /^[IVXLC]+$/,
    // "PART ONE--The Old Buccaneer" — the table of contents has the part name
    // on its own line with no "--", so requiring it excludes the ToC entry.
    partRe: /^PART\s+(?:ONE|TWO|THREE|FOUR|FIVE|SIX)--.+$/,
    endLine: () => false, // runs to the Gutenberg end marker; no in-story tail
  },
  {
    id: 'call-of-the-wild',
    title: 'The Call of the Wild',
    author: 'Jack London',
    gutenbergId: 215,
    // Title baked into the same line. The table of contents has the identical
    // text but indented one space; matching only column-0 lines excludes it.
    chapterRe: /^Chapter\s+[IVXLC]+\.\s+.+$/,
    endLine: () => false,
  },
  {
    id: 'dracula',
    title: 'Dracula',
    author: 'Bram Stoker',
    gutenbergId: 345,
    // Bare "CHAPTER I" (no period, no title) — the table of contents always
    // has a title after the number, so this exact anchor skips it.
    chapterRe: /^CHAPTER\s+[IVXLC]+$/,
    endLine: (line) => line.trim() === 'THE END',
  },
];

async function fetchText(gutenbergId) {
  const url = `https://gutenberg.pglaf.org/cache/epub/${gutenbergId}/pg${gutenbergId}.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

function htmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Gutenberg marks italics with _underscores_. Convert to <em>, applied after
// escaping so the underscores themselves are untouched by htmlEscape.
function withItalics(s) {
  return s.replace(/_([^_]+)_/g, '<em>$1</em>');
}

function formatParagraph(rawLines) {
  const text = rawLines.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
  return withItalics(htmlEscape(text));
}

function formatVerse(rawLines) {
  const html = rawLines.map((l) => withItalics(htmlEscape(l.trim()))).join('<br>');
  return html;
}

// A block is "verse" when every one of its lines is indented at least two
// spaces in the source — ordinary paragraphs in these editions start flush
// left, so indentation reliably flags quoted song/poem lines that should keep
// their original line breaks instead of being rejoined into one paragraph.
function isVerseBlock(rawLines) {
  return rawLines.length > 0 && rawLines.every((l) => /^ {2,}/.test(l) && l.trim().length > 0);
}

function parseBook(fullText, config) {
  const startMarker = /^\*\*\* START OF .* \*\*\*/m;
  const endMarker = /^\*\*\* END OF .* \*\*\*/m;
  const startMatch = fullText.match(startMarker);
  const endMatch = fullText.match(endMarker);
  if (!startMatch || !endMatch) throw new Error(`${config.id}: Gutenberg start/end marker not found`);
  const body = fullText.slice(startMatch.index + startMatch[0].length, endMatch.index);
  const allLines = body.split(/\r?\n/);

  // Skip front matter (title page, table of contents) up to the first real
  // chapter or part heading.
  let i = 0;
  while (i < allLines.length) {
    const line = allLines[i].replace(/\s+$/, '');
    if (config.chapterRe.test(line) || (config.partRe && config.partRe.test(line))) break;
    i++;
  }
  if (i >= allLines.length) throw new Error(`${config.id}: no chapter heading found`);

  const rawBlocks = []; // { kind: 'heading'|'part'|'lines', lines: string[] }
  let buffer = [];
  const flush = () => {
    if (buffer.length > 0) { rawBlocks.push({ kind: 'lines', lines: buffer }); buffer = []; }
  };
  for (; i < allLines.length; i++) {
    const rawLine = allLines[i].replace(/\s+$/, '');
    if (config.endLine(rawLine)) break;
    if (rawLine.trim() === '') { flush(); continue; }
    if (config.partRe && config.partRe.test(rawLine)) {
      flush();
      rawBlocks.push({ kind: 'part', lines: [rawLine.trim()] });
      continue;
    }
    if (config.chapterRe.test(rawLine)) {
      flush();
      rawBlocks.push({ kind: 'heading', lines: [rawLine.trim()] });
      continue;
    }
    buffer.push(rawLine);
  }
  flush();

  // Merge a short, unpunctuated line immediately following a heading in as
  // its subtitle (Alice/Treasure Island put the title on the very next line;
  // Dracula puts it in the next paragraph block after a blank line).
  const blocks = [];
  for (let b = 0; b < rawBlocks.length; b++) {
    const block = rawBlocks[b];
    if (block.kind === 'heading') {
      const next = rawBlocks[b + 1];
      let subtitle = null;
      if (next && next.kind === 'lines' && next.lines.length === 1) {
        const t = next.lines[0].trim();
        if (t.length > 0 && t.length <= 70 && !/[.!?]$/.test(t)) {
          subtitle = htmlEscape(t);
          b++; // consume it
        }
      }
      const main = htmlEscape(block.lines[0]);
      blocks.push({
        tag: 'h2',
        html: subtitle ? `${main}<br><span class="subtitle">${subtitle}</span>` : main,
      });
    } else if (block.kind === 'part') {
      blocks.push({ tag: 'h1', html: htmlEscape(block.lines[0]) });
    } else if (isVerseBlock(block.lines)) {
      blocks.push({ tag: 'verse', html: formatVerse(block.lines) });
    } else {
      blocks.push({ tag: 'p', html: formatParagraph(block.lines) });
    }
  }
  return blocks;
}

for (const config of BOOKS) {
  process.stdout.write(`Fetching ${config.title}... `);
  const text = await fetchText(config.gutenbergId);
  const blocks = parseBook(text, config);
  const wordCount = blocks.reduce((n, b) => n + b.html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, 0);
  console.log(`${blocks.length} blocks, ~${wordCount} words`);
  const out = { id: config.id, title: config.title, author: config.author, blocks };
  writeFileSync(join(outDir, `${config.id}.json`), JSON.stringify(out));
}
console.log('Done.');
