#!/usr/bin/env node
// Fetches "Capital" (Moore/Aveling/Untermann translation, ed. Engels, 1906)
// from English Wikisource and converts it into the same block-JSON shape the
// other bundled books use. Dev-only — not shipped to the app; re-run this
// after adding front-matter/chapters or if the source text changes:
//   node scripts/build-das-kapital.mjs
//
// Unlike the Gutenberg plain-text books, Wikisource only exposes rendered
// HTML for a transcluded proofread text (the wikitext itself is just
// <pages index=.../> transclusion tags with no expanded content). So this
// script walks the rendered HTML of each chapter/front-matter subpage with a
// small hand-rolled tag tree parser (MediaWiki's output is well-formed, so a
// full HTML parser isn't needed) instead of the line-oriented regex approach
// build-books.mjs uses for plain text.
//
// Simplifications made for a page-turning plain-text reader:
//  - Footnotes: Wikisource inline markers ("[1]") are kept in the paragraph
//    text as-is (they're already plain "[N]" text once tags are stripped);
//    the footnote bodies are collected from the page's reference list and
//    appended as a "Notes" section at the end of each chapter, numbered —
//    there's no in-reader link/jump, just a print-style endnote list.
//  - Tables: this edition uses tables only for illustrative diagrams (e.g.
//    working-day line diagrams, wage/price comparison tables), never for
//    running prose. Each table becomes a "verse" block (one table row per
//    line) so it survives as readable text without needing real table
//    layout, which the reader's block schema doesn't support.
//  - Decorative <math> elements: every <math> in this text is an empty
//    LaTeX brace used only to visually bracket several table rows together
//    (Marx's arithmetic is written out in prose, not typeset equations), so
//    <math> and its fallback <img> are dropped rather than converted.
//  - Heading levels: BOOK/PART divisions become h1; everything else a
//    Wikisource "wst-center" block marks as a title (chapter headings,
//    in-chapter numbered sections, front-matter titles) becomes h2, exactly
//    as the two-level h1/h2 schema the other books already use.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'content');
mkdirSync(outDir, { recursive: true });

const WORK = 'Das Kapital (Moore, 1906)';

// Order confirmed by following each subpage's header previous/next chain.
const PAGES = [
  { title: "Editor's Note to the First American Edition" },
  { title: "Author's Preface to the First Edition" },
  { title: "Author's Preface to the Second Edition" },
  { title: "Editor's Preface to the First English Translation" },
  { title: "Editor's Preface to the Fourth German Edition" },
  ...Array.from({ length: 33 }, (_, i) => ({ title: `Chapter ${i + 1}` })),
];

// ---------- tiny HTML tag-tree parser ----------

const VOID_TAGS = new Set(['br', 'hr', 'img', 'link', 'meta', 'col', 'input']);

function tokenize(html) {
  let i = 0;
  const n = html.length;
  function parseNodes() {
    const nodes = [];
    while (i < n) {
      if (html.startsWith('</', i)) return nodes;
      if (html[i] === '<') {
        const m = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/.exec(html.slice(i, i + 4000));
        if (!m) { i++; continue; }
        const tag = m[1].toLowerCase();
        const attrs = m[2];
        const selfClose = m[3] === '/';
        i += m[0].length;
        const classMatch = /class="([^"]*)"/.exec(attrs);
        const className = classMatch ? classMatch[1] : '';
        const idMatch = /id="([^"]*)"/.exec(attrs);
        const id = idMatch ? idMatch[1] : '';
        if (tag === 'math') {
          const close = html.indexOf('</math>', i);
          i = close >= 0 ? close + 7 : n;
          nodes.push({ tag, className, id, children: [] });
          continue;
        }
        if (VOID_TAGS.has(tag) || selfClose) {
          nodes.push({ tag, className, id, children: [] });
          continue;
        }
        const children = parseNodes();
        if (html.startsWith(`</${tag}`, i)) {
          const end = html.indexOf('>', i);
          i = end >= 0 ? end + 1 : n;
        }
        nodes.push({ tag, className, id, children });
        continue;
      }
      const next = html.indexOf('<', i);
      const text = next === -1 ? html.slice(i) : html.slice(i, next);
      i = next === -1 ? n : next;
      if (text.length) nodes.push({ text });
      if (next === -1) break;
    }
    return nodes;
  }
  return parseNodes();
}

function isText(node) { return typeof node.text === 'string'; }
function hasClass(node, cls) { return !isText(node) && node.className.split(/\s+/).includes(cls); }

function findFirst(nodes, pred) {
  for (const node of nodes) {
    if (!isText(node) && pred(node)) return node;
    if (!isText(node)) {
      const found = findFirst(node.children, pred);
      if (found) return found;
    }
  }
  return null;
}

// ---------- entity decoding / escaping ----------

const ENTITY_NAMES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ENTITY_CODES = { 39: "'", 91: '[', 93: ']', 160: ' ', 8203: '', 8288: '' };

function decodeEntities(s) {
  return s.replace(/&#(\d+);|&([a-zA-Z]+);/g, (whole, num, name) => {
    if (num) return ENTITY_CODES[num] ?? String.fromCodePoint(Number(num));
    return ENTITY_NAMES[name] ?? whole;
  });
}

function htmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- node -> inline HTML ----------
// allowBr: headings may keep <br> between lines; paragraphs may not (the
// reader's pagination code only understands <em> inside a 'p' block's html).

function inlineHTML(node, { upper = false, allowBr = false } = {}) {
  if (isText(node)) {
    const decoded = decodeEntities(node.text);
    return htmlEscape(upper ? decoded.toUpperCase() : decoded);
  }
  const { tag } = node;
  if (tag === 'style' || tag === 'link' || tag === 'math' || tag === 'img' || tag === 'table') return '';
  if (hasClass(node, 'pagenum') || hasClass(node, 'wst-dhr')) return '';
  if (tag === 'br') return allowBr ? '<br>' : ' ';
  const childUpper = upper || hasClass(node, 'smallcaps');
  const inner = node.children.map((c) => inlineHTML(c, { upper: childUpper, allowBr })).join('');
  if (tag === 'i') return `<em>${inner}</em>`;
  return inner;
}

function collapseSpace(s) { return s.replace(/[ \t\n]+/g, ' ').trim(); }

// ---------- fetching ----------

async function fetchChapterHTML(title) {
  const url = `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(`${WORK}/${title}`)}&prop=text&format=json`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'library-pwa-build-script/1.0' } });
    if (res.status === 429 && attempt < 5) {
      const wait = 5000 * (attempt + 1);
      console.log(`  (rate limited, waiting ${wait}ms)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`fetch ${title} -> ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`${title}: ${data.error.info}`);
    return data.parse.text['*'];
  }
}

function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<link\b[^>]*>/g, '');
}

// ---------- footnotes ----------

function extractFootnotes(topNodes) {
  const refList = findFirst(topNodes, (n) => n.tag === 'ol' && hasClass(n, 'references'));
  const notes = [];
  if (!refList) return notes;
  for (const li of refList.children) {
    if (isText(li) || li.tag !== 'li') continue;
    const idMatch = /cite.note-(\d+)/.exec(li.id || '');
    const num = idMatch ? Number(idMatch[1]) : notes.length + 1;
    const textSpan = findFirst(li.children, (n) => hasClass(n, 'reference-text'));
    if (!textSpan) continue;
    const html = collapseSpace(textSpan.children.map((c) => inlineHTML(c, {})).join(''));
    if (html) notes.push({ num, html });
  }
  return notes;
}

// ---------- centered blocks (headings, and sometimes just centered equations) ----------

// Wikisource centers two unrelated things the same way: real headings
// (BOOK/PART/CHAPTER/SECTION titles, run-in numbered subheadings like
// "(b.) Quantitative determination...") and Marx's centered value-form
// equations ("20 yards of linen = 1 coat"). A single wst-center block can
// even bundle both in sequence with no further nesting to tell them apart —
// the first chapter of a Book/Part carries "BOOK I. / CAPITALIST PRODUCTION.
// / PART I. / ... / SECTION 1.—..." as plain sibling <p> lines, while a
// value-form example centers a run-in subheading right next to its equation
// lines. Distinguish them by content instead of container: a line that's
// either ALL CAPS (chapter/section titles — small caps in the source, which
// this script's smallcaps handling already uppercases) or carries an <em>
// (Marx's italicized run-in subheading phrases) is a heading; anything else
// (the equations themselves, always plain roman text) is body prose.
function isHeadingLine(html) {
  const plain = html.replace(/<[^>]+>/g, '');
  if (/<em>/.test(html)) return true;
  return /[A-Z]/.test(plain) && !/[a-z]/.test(plain);
}

function blocksFromCenter(div) {
  // 'inline' runs go through the heading/paragraph classifier below; a
  // 'table' run (Marx's value-form tables are also wrapped in a centering
  // div) is handled separately since it has no meaningful inline text of
  // its own for isHeadingLine to look at.
  const runs = [];
  let pending = [];
  const flushPending = () => { if (pending.length) { runs.push({ kind: 'inline', nodes: pending }); pending = []; } };
  for (const child of div.children) {
    if (!isText(child) && child.tag === 'p') {
      flushPending();
      runs.push({ kind: 'inline', nodes: child.children });
    } else if (!isText(child) && child.tag === 'table') {
      flushPending();
      runs.push({ kind: 'table', node: child });
    } else if (isText(child) && child.text.trim() === '') {
      continue;
    } else {
      pending.push(child);
    }
  }
  flushPending();

  const blocks = [];
  let heading = null; // { tag, lines: [] }
  const flushHeading = () => {
    if (heading) { blocks.push({ tag: heading.tag, html: heading.lines.join('<br>') }); heading = null; }
  };
  for (const run of runs) {
    if (run.kind === 'table') {
      flushHeading();
      const block = tableToVerse(run.node);
      if (block) blocks.push(block);
      continue;
    }
    const html = collapseSpace(run.nodes.map((c) => inlineHTML(c, { allowBr: false })).join(''));
    if (!html) continue;
    if (isHeadingLine(html)) {
      const plain = html.replace(/<[^>]+>/g, '');
      const isBig = /^(BOOK|PART)\b/.test(plain);
      const isKeyword = isBig || /^(CHAPTER|SECTION)\b/.test(plain);
      if (!heading || isKeyword) {
        flushHeading();
        heading = { tag: isBig ? 'h1' : 'h2', lines: [html] };
      } else {
        heading.lines.push(html);
      }
    } else {
      flushHeading();
      blocks.push({ tag: 'p', html });
    }
  }
  flushHeading();
  return blocks;
}

// ---------- tables ----------

function tableToVerse(table) {
  const rows = [];
  const trs = [];
  (function collect(n) {
    for (const c of n.children) {
      if (isText(c)) continue;
      if (c.tag === 'tr') trs.push(c);
      else collect(c);
    }
  })(table);
  for (const tr of trs) {
    const cells = tr.children.filter((c) => !isText(c) && (c.tag === 'td' || c.tag === 'th'));
    const texts = cells
      .map((c) => collapseSpace(c.children.map((cc) => inlineHTML(cc, {})).join('')))
      .filter(Boolean);
    if (texts.length) rows.push(texts.join('&nbsp;&nbsp;|&nbsp;&nbsp;'));
  }
  if (rows.length === 0) return null;
  return { tag: 'verse', html: rows.join('<br>') };
}

// ---------- dl/dd (used a couple of times for indented enumerations) ----------

function ddParagraphs(dl) {
  // A <dd> that just wraps a further-indented <dl> (nesting used purely for
  // extra indent, as in the room-dimensions list in Ch.25) contributes no
  // text of its own — only its leaf <dd> descendants do — so don't collect
  // it, only recurse into it, or its text would double up with theirs.
  const dds = [];
  (function collect(n) {
    for (const c of n.children) {
      if (isText(c)) continue;
      if (c.tag === 'dd') {
        if (c.children.some((cc) => !isText(cc) && cc.tag === 'dl')) collect(c);
        else dds.push(c);
      } else {
        collect(c);
      }
    }
  })(dl);
  return dds
    .map((dd) => collapseSpace(dd.children.map((c) => inlineHTML(c, {})).join('')))
    .filter(Boolean)
    .map((html) => ({ tag: 'p', html }));
}

// ---------- one page -> blocks ----------

function parsePage(rawHTML) {
  const html = stripNoise(rawHTML);
  const startIdx = html.indexOf('<div class="prp-pages-output" lang="en">');
  if (startIdx === -1) throw new Error('content start marker not found');
  const topNodes = tokenize(html.slice(startIdx));
  const mainDiv = findFirst(topNodes, (n) => n.tag === 'div' && hasClass(n, 'prp-pages-output'));
  if (!mainDiv) throw new Error('main content div not found');

  const footnotes = extractFootnotes(topNodes);

  const blocks = [];
  for (const node of mainDiv.children) {
    if (isText(node)) continue;
    if (hasClass(node, 'wst-dhr')) continue;
    if (node.tag === 'hr') continue;
    if (node.tag === 'style' || node.tag === 'link') continue;
    if (node.className.includes('center')) {
      blocks.push(...blocksFromCenter(node));
      continue;
    }
    if (node.tag === 'table') {
      const block = tableToVerse(node);
      if (block) blocks.push(block);
      continue;
    }
    if (node.tag === 'dl') {
      blocks.push(...ddParagraphs(node));
      continue;
    }
    if (node.tag === 'p') {
      const html = collapseSpace(node.children.map((c) => inlineHTML(c, { allowBr: false })).join(''));
      if (html) blocks.push({ tag: 'p', html });
      continue;
    }
    // Unrecognized top-level container (shouldn't normally occur) — best
    // effort: pull its text out as a paragraph rather than silently drop it.
    const html = collapseSpace(node.children.map((c) => inlineHTML(c, { allowBr: false })).join(''));
    if (html) blocks.push({ tag: 'p', html });
  }

  if (footnotes.length > 0) {
    blocks.push({ tag: 'h2', html: 'Notes' });
    for (const note of footnotes) {
      blocks.push({ tag: 'p', html: `${note.num}. ${note.html}` });
    }
  }

  return blocks;
}

// ---------- paragraph rejoining ----------
// Wikisource's proofread transclusion is assembled one scanned page at a
// time; when a single running paragraph spans a page image, the two halves
// come through as separate sibling <p> elements instead of one continuous
// paragraph. Detect that (a 'p' block with no sentence-ending punctuation at
// its end, immediately followed by a 'p' block starting mid-word in
// lowercase) and rejoin them so the reader doesn't show a paragraph break in
// the middle of a sentence.
function mergeSplitParagraphs(blocks) {
  const merged = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.tag === 'p' && block.tag === 'p') {
      const prevPlain = prev.html.replace(/<[^>]+>/g, '').trim();
      const plain = block.html.replace(/<[^>]+>/g, '').trim();
      const endsMidSentence = prevPlain && !/[.!?"'”)\]:;]$/.test(prevPlain);
      const continuesLowercase = /^[a-z]/.test(plain);
      if (endsMidSentence && continuesLowercase) {
        prev.html = `${prev.html} ${block.html}`;
        continue;
      }
    }
    merged.push(block);
  }
  return merged;
}

// ---------- driver ----------

let allBlocks = [];
for (const page of PAGES) {
  process.stdout.write(`Fetching ${page.title}... `);
  const rawHTML = await fetchChapterHTML(page.title);
  const blocks = parsePage(rawHTML);
  console.log(`${blocks.length} blocks`);
  allBlocks.push(...blocks);
  // Be a polite API citizen.
  await new Promise((r) => setTimeout(r, 1000));
}

allBlocks = mergeSplitParagraphs(allBlocks);

const wordCount = allBlocks.reduce(
  (n, b) => n + b.html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
  0,
);
console.log(`Total: ${allBlocks.length} blocks, ~${wordCount} words`);

const out = {
  id: 'das-kapital',
  title: 'Capital',
  author: 'Karl Marx',
  blocks: allBlocks,
};
writeFileSync(join(outDir, 'das-kapital.json'), JSON.stringify(out));
console.log('Done.');
