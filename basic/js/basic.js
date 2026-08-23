// A line-numbered BASIC interpreter (GW-BASIC / Applesoft flavor), ported from
// the Oberon bytecode-VM implementation at oberon-transpiler/examples/basic.mod.
// This port keeps the same language grammar, statement/error semantics and
// DEFN-function calling convention, but compiles each program line to a flat
// array of small statement records (with resolved jump targets) instead of a
// stack-machine opcode stream — simpler in a tree-walking host, same behavior.
//
// The interpreter has no DOM/browser dependency: all I/O goes through a
// `host` object passed to the constructor (see the `host` shape in app.js).

// ---------------------------------------------------------------- tokenizer

const TK = {
  EOL: 'eol', NUM: 'num', STR: 'str', IDENT: 'ident', OP: 'op',
  LP: 'lp', RP: 'rp', COMMA: 'comma', COLON: 'colon', SEMI: 'semi', HASH: 'hash',
};

function isDigit(c) { return c >= '0' && c <= '9'; }
function isAlpha(c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_'; }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }

export function expandQuestionMarks(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inStr = !inStr;
    if (c === '?' && !inStr) {
      out += 'PRINT';
      if (isAlnum(s[i + 1] || '')) out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

export function tokenize(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  const push = (kind, extra) => { toks.push({ kind, num: 0, s: '', ...extra }); };
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === "'") break;
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] || ''))) {
      let j = i;
      while (isDigit(text[j])) j++;
      if (text[j] === '.') { j++; while (isDigit(text[j])) j++; }
      if (text[j] === 'E' || text[j] === 'e') {
        let k = j + 1;
        if (text[k] === '+' || text[k] === '-') k++;
        if (isDigit(text[k])) { j = k; while (isDigit(text[j])) j++; }
      }
      const numText = text.slice(i, j);
      const v = parseFloat(numText);
      push(TK.NUM, { num: Number.isNaN(v) ? 0 : v });
      i = j;
    } else if (isAlpha(c)) {
      let j = i;
      while (isAlnum(text[j])) j++;
      if (text[j] === '$') j++;
      let word = text.slice(i, j).toUpperCase();
      if (word === 'REM') break;
      push(TK.IDENT, { s: word });
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j++;
      push(TK.STR, { s: text.slice(i + 1, j) });
      i = (j < n) ? j + 1 : j;
    } else if (c === '<') {
      if (text[i + 1] === '>') { push(TK.OP, { s: '<>' }); i += 2; }
      else if (text[i + 1] === '=') { push(TK.OP, { s: '<=' }); i += 2; }
      else { push(TK.OP, { s: '<' }); i += 1; }
    } else if (c === '>') {
      if (text[i + 1] === '=') { push(TK.OP, { s: '>=' }); i += 2; }
      else { push(TK.OP, { s: '>' }); i += 1; }
    } else if (c === '=' || c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      push(TK.OP, { s: c }); i += 1;
    } else if (c === '(') { push(TK.LP); i += 1; }
    else if (c === ')') { push(TK.RP); i += 1; }
    else if (c === ',') { push(TK.COMMA); i += 1; }
    else if (c === ':') { push(TK.COLON); i += 1; }
    else if (c === ';') { push(TK.SEMI); i += 1; }
    else if (c === '#') { push(TK.HASH); i += 1; }
    else { i += 1; }
  }
  push(TK.EOL);
  return toks;
}

// ------------------------------------------------------------- basic errors

export class BasicError extends Error {
  constructor(msg) { super(msg); this.basicMsg = msg; }
}

function err(msg) { throw new BasicError(msg); }

// --------------------------------------------------------------- builtins

const BUILTIN_NAMES = new Set([
  'ABS', 'INT', 'SGN', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'LOG', 'EXP', 'PI', 'RND',
  'TIMER', 'LEN', 'VAL', 'ASC', 'CHR$', 'STR$', 'LEFT$', 'RIGHT$', 'MID$', 'INSTR',
  'INKEY$', 'STRING$', 'SPACE$', 'SCRW', 'SCRH', 'MOUSEX', 'MOUSEY', 'MOUSEB', 'EOF',
]);

function isStrName(name) { return name.length > 0 && name[name.length - 1] === '$'; }

function mkNum(x) { return { isStr: false, num: x, s: '' }; }
function mkStr(s) { return { isStr: true, num: 0, s }; }
function mkBool(b) { return mkNum(b ? -1 : 0); }
function truthy(v) { return v.isStr ? v.s.length > 0 : v.num !== 0; }

// classic-BASIC-ish number formatting: integers plain, else trimmed decimal /
// exponential. Not byte-identical to the Oberon runtime's formatter, just
// readable and consistent.
export function numToStr(x) {
  if (Number.isNaN(x)) return 'NAN';
  if (!Number.isFinite(x)) return x > 0 ? 'INF' : '-INF';
  if (Object.is(x, -0)) x = 0;
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  let s = x.toPrecision(10);
  if (s.includes('e')) {
    let [mant, exp] = s.split('e');
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const expNum = parseInt(exp, 10);
    return `${mant}E${expNum >= 0 ? '+' : '-'}${String(Math.abs(expNum)).padStart(2, '0')}`;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// deterministic, reseedable PRNG (mulberry32) standing in for the runtime's
// Random module, so RANDOMIZE n gives reproducible sequences.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- tok cursor

class Cur {
  constructor(toks) { this.toks = toks; this.pos = 0; }
  kind() { return this.toks[this.pos].kind; }
  tok() { return this.toks[this.pos]; }
  isIdent(name) { return this.kind() === TK.IDENT && this.tok().s === name; }
  isOp(op) { return this.kind() === TK.OP && this.tok().s === op; }
  adv() { this.pos++; }
  bareLineNumberAhead() {
    if (this.kind() !== TK.NUM) return false;
    const nk = this.toks[this.pos + 1].kind;
    return nk === TK.COLON || nk === TK.EOL;
  }
}

// ------------------------------------------------------ compiler (per run)
//
// Compiles the whole program into `main` (a flat array of statement
// records) plus one flat array per DEFN function, mirroring the Oberon
// compiler's structure/backpatch scheme but at statement (not opcode)
// granularity. Control-flow records carry a `target` index resolved either
// immediately (IF/WHILE structural jumps) or via a deferred line-number
// backpatch list (GOTO/GOSUB/ON/bare-line IF branches), exactly as in the
// original.

class FuncDef {
  constructor(name) {
    this.name = name;
    this.isStr = isStrName(name);
    this.params = [];       // [{name, isStr}]
    this.body = [];         // flat compiled statement array
    this.bodyStart = -1;    // index range into prog[] (for CompileProgram-style two pass)
    this.bodyEnd = -1;
  }
}

class Compiler {
  constructor(prog, funcsByName) {
    this.prog = prog;                 // [{num, text}] sorted
    this.funcsByName = funcsByName;    // Map name -> FuncDef (already header-parsed)
    this.main = [];
    this.lineIndex = new Map();        // lineNum -> index in `main` of its LINE record
    this.gotoBackpatch = [];           // [{idx, arr, lineNum, field}]
    this.onBackpatch = [];             // [{targets, i, lineNum}]
    this.lineFixups = [];              // indices (into current `out`) to resolve to "end of this source line"
    this.whileStack = [];              // [{condIdx}]
    this.compInFunc = false;
    this.out = this.main;              // current target array
    this.firstErr = null;              // {msg, line}
  }

  compileAll() {
    // phase 1: header-parse all DEFN blocks (already done by caller into funcsByName);
    // just enumerate main-line ranges, skipping DEFN..ENDFN spans.
    let i = 0;
    while (i < this.prog.length) {
      const skip = this.funcBodySkip(i);
      if (skip >= 0) { i = skip; continue; }
      this.lineIndex.set(this.prog[i].num, this.main.length);
      this.compileLineBody(this.prog[i].text, this.prog[i].num);
      if (this.firstErr) return this.firstErr;
      i++;
    }
    this.main.push({ t: 'END' });

    for (const fd of this.funcsByName.values()) {
      this.compInFunc = true;
      this.out = fd.body;
      this.whileStack = [];
      for (let k = fd.bodyStart; k < fd.bodyEnd; k++) {
        this.compileLineBody(this.prog[k].text, this.prog[k].num);
        if (this.firstErr) return this.firstErr;
      }
      this.out.push({ t: 'FUNCRETURN', expr: null });
      this.compInFunc = false;
      this.out = this.main;
    }

    // resolve line-number backpatches against the now-complete lineIndex
    for (const bp of this.gotoBackpatch) {
      const idx = this.lineIndex.has(bp.lineNum) ? this.lineIndex.get(bp.lineNum) : -1;
      bp.rec[bp.field] = idx;
    }
    for (const bp of this.onBackpatch) {
      const idx = this.lineIndex.has(bp.lineNum) ? this.lineIndex.get(bp.lineNum) : -1;
      bp.targets[bp.i] = idx;
    }
    return null;
  }

  funcBodySkip(i) {
    if (!isDefnLine(this.prog[i].text)) return -1;
    let k = i + 1;
    while (k < this.prog.length && !isEndfnLine(this.prog[k].text)) k++;
    return k < this.prog.length ? k + 1 : this.prog.length;
  }

  fail(msg, lineNum) {
    if (!this.firstErr) this.firstErr = { msg, line: lineNum };
  }

  compileLineBody(text, lineNum) {
    const savedLen = this.out.length;
    const savedGBP = this.gotoBackpatch.length;
    const savedOBP = this.onBackpatch.length;
    const savedWT = this.whileStack.length;
    this.lineFixups = [];
    this.out.push({ t: 'LINE', num: lineNum });
    const tb = new Cur(tokenize(text));
    let lineErr = null;
    try {
      this.compileStmtSeq(tb);
    } catch (e) {
      if (e instanceof BasicError) lineErr = e.basicMsg; else throw e;
    }
    if (lineErr) {
      this.fail(lineErr, lineNum);
      this.out.length = savedLen;
      this.gotoBackpatch.length = savedGBP;
      this.onBackpatch.length = savedOBP;
      this.whileStack.length = savedWT;
      this.lineFixups = [];
    } else {
      for (const idx of this.lineFixups) this.out[idx].target = this.out.length;
      this.lineFixups = [];
    }
  }

  compileStmtSeq(tb) {
    while (tb.kind() !== TK.EOL) {
      this.compileStmt(tb);
      if (tb.kind() === TK.COLON) tb.adv(); else break;
    }
  }

  // ------------------------------------------------------------ statements

  compileStmt(tb) {
    if (tb.kind() !== TK.IDENT) err('SYNTAX ERROR');
    const name = tb.tok().s;

    if (name === 'PRINT') { tb.adv(); this.compilePrint(tb); }
    else if (name === 'INPUT') { tb.adv(); this.compileInput(tb); }
    else if (name === 'LET') { tb.adv(); this.compileAssign(tb); }
    else if (name === 'DIM') { tb.adv(); this.compileDim(tb); }
    else if (name === 'DATA') { tb.pos = tb.toks.length - 1; }
    else if (name === 'READ') { tb.adv(); this.compileRead(tb); }
    else if (name === 'RESTORE') { tb.adv(); this.compileRestore(tb); }
    else if (name === 'GOTO') { tb.adv(); this.compileGoto(tb); }
    else if (name === 'GOSUB') { tb.adv(); this.compileGosub(tb); }
    else if (name === 'RETURN') { tb.adv(); this.compileReturn(tb); }
    else if (name === 'ON') { tb.adv(); this.compileOn(tb); }
    else if (name === 'FOR') { tb.adv(); this.compileFor(tb); }
    else if (name === 'NEXT') {
      tb.adv();
      if (tb.kind() === TK.IDENT) tb.adv();
      this.out.push({ t: 'NEXT' });
    }
    else if (name === 'IF') { this.compileIf(tb); }
    else if (name === 'WHILE') { tb.adv(); this.compileWhile(tb); }
    else if (name === 'WEND') { tb.adv(); this.compileWend(); }
    else if (name === 'END' || name === 'STOP') { tb.pos = tb.toks.length - 1; this.out.push({ t: 'END' }); }
    else if (name === 'CLS' || name === 'HOME') { tb.adv(); this.out.push({ t: 'CLS' }); }
    else if (name === 'LOCATE') { tb.adv(); this.compileLocate(tb); }
    else if (name === 'RANDOMIZE') { tb.adv(); this.compileRandomize(tb); }
    else if (name === 'SCREEN') { tb.adv(); this.compileScreen(tb); }
    else if (name === 'COLOR') { tb.adv(); this.compileColor(tb); }
    else if (name === 'PSET') { tb.adv(); this.compilePset(tb); }
    else if (name === 'LINE') {
      tb.adv();
      if (tb.isIdent('INPUT')) { tb.adv(); this.compileLineInput(tb); }
      else this.compileDrawLine(tb);
    }
    else if (name === 'CIRCLE') { tb.adv(); this.compileCircle(tb, false); }
    else if (name === 'FCIRCLE') { tb.adv(); this.compileCircle(tb, true); }
    else if (name === 'RECT') { tb.adv(); this.compileRect(tb, false); }
    else if (name === 'FRECT') { tb.adv(); this.compileRect(tb, true); }
    else if (name === 'TEXT') { tb.adv(); this.compileText(tb); }
    else if (name === 'SOUND') { tb.adv(); this.compileSound(tb); }
    else if (name === 'BEEP') { tb.adv(); this.out.push({ t: 'BEEP' }); }
    else if (name === 'DELAY') { tb.adv(); this.compileDelay(tb); }
    else if (name === 'OPEN') { tb.adv(); this.compileOpen(tb); }
    else if (name === 'CLOSE') { tb.adv(); this.compileClose(tb); }
    else if (name === 'FILES') { tb.adv(); this.compileFiles(tb); }
    else if (name === 'DEFN' || name === 'ENDFN') { tb.pos = tb.toks.length - 1; }
    else {
      const fd = this.funcsByName.get(name);
      if (fd && tb.toks[tb.pos + 1].kind === TK.LP) {
        tb.adv();
        this.out.push(this.compileUserFuncCall(fd, tb));
      } else {
        this.compileAssign(tb);
      }
    }
  }

  compilePrint(tb) {
    const rec = { t: 'PRINT', fileExpr: null, segs: [], nl: true };
    if (tb.kind() === TK.HASH) {
      tb.adv();
      rec.fileExpr = this.compileExpr(tb);
      if (tb.kind() === TK.COMMA) tb.adv();
    }
    let trailing = false;
    for (;;) {
      if (tb.kind() === TK.EOL || tb.kind() === TK.COLON) break;
      if (tb.isIdent('TAB')) {
        tb.adv();
        if (tb.kind() === TK.LP) tb.adv();
        const e = this.compileExpr(tb);
        if (tb.kind() === TK.RP) tb.adv();
        rec.segs.push({ k: 'tab', expr: e });
      } else {
        rec.segs.push({ k: 'val', expr: this.compileExpr(tb) });
      }
      if (tb.kind() === TK.COMMA) { tb.adv(); rec.segs.push({ k: 'comma' }); trailing = true; }
      else if (tb.kind() === TK.SEMI) { tb.adv(); trailing = true; }
      else { trailing = false; break; }
    }
    rec.nl = !trailing;
    this.out.push(rec);
  }

  compileInput(tb) {
    const rec = { t: 'INPUT', fileExpr: null, promptStr: null, targets: [] };
    if (tb.kind() === TK.HASH) {
      tb.adv();
      rec.fileExpr = this.compileExpr(tb);
      if (tb.kind() === TK.COMMA) tb.adv();
    } else {
      if (tb.kind() === TK.STR) {
        rec.promptStr = tb.tok().s; tb.adv();
        if (tb.kind() === TK.SEMI || tb.kind() === TK.COMMA) tb.adv();
      }
    }
    for (;;) {
      if (tb.kind() !== TK.IDENT) break;
      const name = tb.tok().s; tb.adv();
      let idx1 = null, idx2 = null;
      if (tb.kind() === TK.LP) {
        tb.adv(); idx1 = this.compileExpr(tb);
        if (tb.kind() === TK.COMMA) { tb.adv(); idx2 = this.compileExpr(tb); }
        if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
      }
      rec.targets.push({ name, isStr: isStrName(name), idx1, idx2 });
      if (tb.kind() === TK.COMMA) tb.adv(); else break;
    }
    this.out.push(rec);
  }

  compileDim(tb) {
    const items = [];
    for (;;) {
      if (tb.kind() !== TK.IDENT) err('SYNTAX ERROR');
      const name = tb.tok().s; tb.adv();
      let d1 = null, d2 = null;
      if (tb.kind() === TK.LP) {
        tb.adv(); d1 = this.compileExpr(tb);
        if (tb.kind() === TK.COMMA) { tb.adv(); d2 = this.compileExpr(tb); }
        if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
      }
      items.push({ name, isStr: isStrName(name), d1, d2 });
      if (tb.kind() === TK.COMMA) tb.adv(); else break;
    }
    this.out.push({ t: 'DIM', items });
  }

  compileRead(tb) {
    const targets = [];
    for (;;) {
      if (tb.kind() !== TK.IDENT) break;
      const name = tb.tok().s; tb.adv();
      let idx1 = null, idx2 = null;
      if (tb.kind() === TK.LP) {
        tb.adv(); idx1 = this.compileExpr(tb);
        if (tb.kind() === TK.COMMA) { tb.adv(); idx2 = this.compileExpr(tb); }
        if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
      }
      targets.push({ name, isStr: isStrName(name), idx1, idx2 });
      if (tb.kind() === TK.COMMA) tb.adv(); else break;
    }
    this.out.push({ t: 'READ', targets });
  }

  compileRestore(tb) {
    if (tb.kind() === TK.NUM) this.out.push({ t: 'RESTORE', expr: this.compileExpr(tb) });
    else this.out.push({ t: 'RESTORE', expr: null });
  }

  compileGoto(tb) {
    if (tb.bareLineNumberAhead()) {
      const lineNum = Math.floor(tb.tok().num); tb.adv();
      if (!this.compInFunc) {
        const rec = { t: 'GOTO', target: -1 };
        this.out.push(rec);
        this.gotoBackpatch.push({ rec, field: 'target', lineNum });
      }
    } else {
      const e = this.compileExpr(tb);
      if (this.compInFunc) this.out.push({ t: 'EVALDISCARD', expr: e });
      else this.out.push({ t: 'GOTODYN', expr: e });
    }
  }

  compileGosub(tb) {
    if (tb.bareLineNumberAhead()) {
      const lineNum = Math.floor(tb.tok().num); tb.adv();
      if (!this.compInFunc) {
        const rec = { t: 'GOSUB', target: -1 };
        this.out.push(rec);
        this.gotoBackpatch.push({ rec, field: 'target', lineNum });
      }
    } else {
      const e = this.compileExpr(tb);
      if (this.compInFunc) this.out.push({ t: 'EVALDISCARD', expr: e });
      else this.out.push({ t: 'GOSUBDYN', expr: e });
    }
  }

  compileReturn(tb) {
    if (this.compInFunc) {
      const hasExpr = tb.kind() !== TK.EOL && tb.kind() !== TK.COLON;
      this.out.push({ t: 'FUNCRETURN', expr: hasExpr ? this.compileExpr(tb) : null });
    } else {
      this.out.push({ t: 'GOSUBRETURN' });
    }
  }

  compileOn(tb) {
    const expr = this.compileExpr(tb);
    let isGosub;
    if (tb.isIdent('GOTO')) { isGosub = false; tb.adv(); }
    else if (tb.isIdent('GOSUB')) { isGosub = true; tb.adv(); }
    else { err('SYNTAX ERROR'); return; }
    if (this.compInFunc) {
      this.out.push({ t: 'EVALDISCARD', expr });
      for (;;) {
        if (tb.kind() !== TK.NUM) break;
        tb.adv();
        if (tb.kind() === TK.COMMA) tb.adv(); else break;
      }
    } else {
      const targets = [];
      const rec = { t: 'ON', expr, isGosub, targets };
      for (;;) {
        if (tb.kind() !== TK.NUM) break;
        const lineNum = Math.floor(tb.tok().num); tb.adv();
        const i = targets.length;
        targets.push(-1);
        this.onBackpatch.push({ targets, i, lineNum });
        if (tb.kind() === TK.COMMA) tb.adv(); else break;
      }
      this.out.push(rec);
    }
  }

  compileFor(tb) {
    if (tb.kind() !== TK.IDENT) { err('SYNTAX ERROR'); return; }
    const name = tb.tok().s; tb.adv();
    if (tb.isOp('=')) tb.adv(); else { err('MISSING ='); return; }
    const fromExpr = this.compileExpr(tb);
    if (tb.isIdent('TO')) tb.adv(); else { err('MISSING TO'); return; }
    const toExpr = this.compileExpr(tb);
    let stepExpr;
    if (tb.isIdent('STEP')) { tb.adv(); stepExpr = this.compileExpr(tb); }
    else { stepExpr = { k: 'num', v: 1 }; }
    this.out.push({ t: 'FOR', name, isStr: isStrName(name), fromExpr, toExpr, stepExpr });
  }

  compileWhile(tb) {
    const condIdx = this.out.length;
    const cond = this.compileExpr(tb);
    const jf = { t: 'JUMPFALSE', cond, target: -1 };
    this.out.push(jf);
    this.whileStack.push({ condIdx, jf });
  }

  compileWend() {
    if (this.whileStack.length === 0) { err('WEND WITHOUT WHILE'); return; }
    const w = this.whileStack.pop();
    this.out.push({ t: 'JUMP', target: w.condIdx });
    w.jf.target = this.out.length;
  }

  compileIfBranch(tb) {
    if (tb.kind() === TK.NUM) {
      const lineNum = Math.floor(tb.tok().num); tb.adv();
      if (!this.compInFunc) {
        const rec = { t: 'GOTO', target: -1 };
        this.out.push(rec);
        this.gotoBackpatch.push({ rec, field: 'target', lineNum });
      }
    } else {
      this.compileStmtSeq(tb);
    }
  }

  compileIf(tb) {
    tb.adv();
    const cond = this.compileExpr(tb);
    if (tb.isIdent('THEN')) tb.adv();
    const jf = { t: 'JUMPFALSE', cond, target: -1 };
    this.out.push(jf);
    this.compileIfBranch(tb);
    if (tb.isIdent('ELSE')) {
      tb.adv();
      const jmp = { t: 'JUMP', target: -1 };
      this.out.push(jmp);
      jf.target = this.out.length;
      this.compileIfBranch(tb);
      jmp.target = this.out.length;
    } else {
      this.lineFixups.push(this.out.indexOf(jf));
    }
  }

  expectComma(tb) { if (tb.kind() === TK.COMMA) tb.adv(); else err('MISSING ,'); }

  optColor(tb, exprs) { if (tb.kind() === TK.COMMA) { tb.adv(); exprs.push(this.compileExpr(tb)); return true; } return false; }

  compileLocate(tb) {
    const rowExpr = this.compileExpr(tb);
    let colExpr = null;
    if (tb.kind() === TK.COMMA) { tb.adv(); colExpr = this.compileExpr(tb); }
    this.out.push({ t: 'LOCATE', rowExpr, colExpr });
  }

  compileRandomize(tb) {
    if (tb.kind() !== TK.EOL && tb.kind() !== TK.COLON) this.out.push({ t: 'RANDOMIZE', expr: this.compileExpr(tb) });
    else this.out.push({ t: 'RANDOMIZE', expr: null });
  }

  compileScreen(tb) {
    const wExpr = this.compileExpr(tb);
    let hExpr = null;
    if (tb.kind() === TK.COMMA) { tb.adv(); hExpr = this.compileExpr(tb); }
    this.out.push({ t: 'SCREEN', wExpr, hExpr });
  }

  compileColor(tb) {
    const fgExpr = this.compileExpr(tb);
    let bgExpr = null;
    if (tb.kind() === TK.COMMA) { tb.adv(); bgExpr = this.compileExpr(tb); }
    this.out.push({ t: 'COLOR', fgExpr, bgExpr });
  }

  compilePset(tb) {
    const xExpr = this.compileExpr(tb); this.expectComma(tb);
    const yExpr = this.compileExpr(tb);
    const exprs = [];
    this.optColor(tb, exprs);
    this.out.push({ t: 'PSET', xExpr, yExpr, cExpr: exprs[0] || null });
  }

  compileDrawLine(tb) {
    const x1 = this.compileExpr(tb); this.expectComma(tb);
    const y1 = this.compileExpr(tb); this.expectComma(tb);
    const x2 = this.compileExpr(tb); this.expectComma(tb);
    const y2 = this.compileExpr(tb);
    const exprs = [];
    this.optColor(tb, exprs);
    this.out.push({ t: 'DRAWLINE', x1, y1, x2, y2, cExpr: exprs[0] || null });
  }

  compileCircle(tb, filled) {
    const xExpr = this.compileExpr(tb); this.expectComma(tb);
    const yExpr = this.compileExpr(tb); this.expectComma(tb);
    const rExpr = this.compileExpr(tb);
    const exprs = [];
    this.optColor(tb, exprs);
    this.out.push({ t: 'CIRCLE', xExpr, yExpr, rExpr, cExpr: exprs[0] || null, filled });
  }

  compileRect(tb, filled) {
    const xExpr = this.compileExpr(tb); this.expectComma(tb);
    const yExpr = this.compileExpr(tb); this.expectComma(tb);
    const wExpr = this.compileExpr(tb); this.expectComma(tb);
    const hExpr = this.compileExpr(tb);
    const exprs = [];
    this.optColor(tb, exprs);
    this.out.push({ t: 'RECT', xExpr, yExpr, wExpr, hExpr, cExpr: exprs[0] || null, filled });
  }

  compileText(tb) {
    const xExpr = this.compileExpr(tb); this.expectComma(tb);
    const yExpr = this.compileExpr(tb); this.expectComma(tb);
    const sExpr = this.compileExpr(tb);
    let szExpr = null, cExpr = null;
    if (tb.kind() === TK.COMMA) {
      tb.adv(); szExpr = this.compileExpr(tb);
      if (tb.kind() === TK.COMMA) { tb.adv(); cExpr = this.compileExpr(tb); }
    }
    this.out.push({ t: 'TEXT', xExpr, yExpr, sExpr, szExpr, cExpr });
  }

  compileSound(tb) {
    const freqExpr = this.compileExpr(tb); this.expectComma(tb);
    const msExpr = this.compileExpr(tb);
    this.out.push({ t: 'SOUND', freqExpr, msExpr });
  }

  compileDelay(tb) { this.out.push({ t: 'DELAY', msExpr: this.compileExpr(tb) }); }

  compileOpen(tb) {
    const nameExpr = this.compileExpr(tb);
    if (tb.isIdent('FOR')) tb.adv(); else { err('MISSING FOR'); return; }
    let mode;
    if (tb.isIdent('INPUT')) { mode = 0; tb.adv(); }
    else if (tb.isIdent('OUTPUT')) { mode = 1; tb.adv(); }
    else if (tb.isIdent('APPEND')) { mode = 2; tb.adv(); }
    else { err('BAD OPEN MODE'); return; }
    if (tb.isIdent('AS')) tb.adv(); else { err('MISSING AS'); return; }
    if (tb.kind() === TK.HASH) tb.adv();
    const numExpr = this.compileExpr(tb);
    this.out.push({ t: 'OPEN', nameExpr, mode, numExpr });
  }

  compileClose(tb) {
    if (tb.kind() === TK.HASH) tb.adv();
    if (tb.kind() !== TK.EOL && tb.kind() !== TK.COLON) {
      let numExpr = this.compileExpr(tb);
      this.out.push({ t: 'CLOSEFILE', numExpr });
      while (tb.kind() === TK.COMMA) {
        tb.adv();
        if (tb.kind() === TK.HASH) tb.adv();
        numExpr = this.compileExpr(tb);
        this.out.push({ t: 'CLOSEFILE', numExpr });
      }
    } else {
      this.out.push({ t: 'CLOSEFILE', numExpr: null });
    }
  }

  compileLineInput(tb) {
    if (tb.kind() === TK.HASH) tb.adv(); else { err('MISSING #'); return; }
    const fileExpr = this.compileExpr(tb);
    if (tb.kind() === TK.COMMA) tb.adv();
    if (tb.kind() !== TK.IDENT) { err('SYNTAX ERROR'); return; }
    const name = tb.tok().s; tb.adv();
    this.out.push({ t: 'LINEINPUT', fileExpr, name, isStr: isStrName(name) });
  }

  compileFiles(tb) {
    if (tb.kind() !== TK.EOL && tb.kind() !== TK.COLON) this.out.push({ t: 'FILES', expr: this.compileExpr(tb) });
    else this.out.push({ t: 'FILES', expr: null });
  }

  compileAssign(tb) {
    if (tb.kind() !== TK.IDENT) { err('SYNTAX ERROR'); return; }
    const name = tb.tok().s; tb.adv();
    if (tb.kind() === TK.LP) {
      tb.adv();
      const idx1 = this.compileExpr(tb);
      let idx2 = null;
      if (tb.kind() === TK.COMMA) { tb.adv(); idx2 = this.compileExpr(tb); }
      if (tb.kind() === TK.RP) tb.adv(); else { err('MISSING )'); return; }
      if (tb.isOp('=')) tb.adv(); else { err('MISSING ='); return; }
      const expr = this.compileExpr(tb);
      this.out.push({ t: 'LET', name, isStr: isStrName(name), idx1, idx2, expr });
    } else {
      if (tb.isOp('=')) tb.adv(); else { err('SYNTAX ERROR'); return; }
      const expr = this.compileExpr(tb);
      this.out.push({ t: 'LET', name, isStr: isStrName(name), idx1: null, idx2: null, expr });
    }
  }

  // ----------------------------------------------------------- expressions

  compileExpr(tb) { return this.pOr(tb); }

  pOr(tb) {
    let l = this.pAnd(tb);
    while (tb.isIdent('OR')) { tb.adv(); const r = this.pAnd(tb); l = { k: 'bin', op: 'or', l, r }; }
    return l;
  }
  pAnd(tb) {
    let l = this.pNot(tb);
    while (tb.isIdent('AND')) { tb.adv(); const r = this.pNot(tb); l = { k: 'bin', op: 'and', l, r }; }
    return l;
  }
  pNot(tb) {
    if (tb.isIdent('NOT')) { tb.adv(); const e = this.pNot(tb); return { k: 'un', op: 'not', e }; }
    return this.pRel(tb);
  }
  pRel(tb) {
    const l = this.pAdd(tb);
    let op = null;
    if (tb.isOp('=')) op = 'eq';
    else if (tb.isOp('<>')) op = 'ne';
    else if (tb.isOp('<=')) op = 'le';
    else if (tb.isOp('>=')) op = 'ge';
    else if (tb.isOp('<')) op = 'lt';
    else if (tb.isOp('>')) op = 'gt';
    if (op) { tb.adv(); const r = this.pAdd(tb); return { k: 'bin', op, l, r }; }
    return l;
  }
  pAdd(tb) {
    let l = this.pMul(tb);
    for (;;) {
      if (tb.isOp('+')) { tb.adv(); const r = this.pMul(tb); l = { k: 'bin', op: 'add', l, r }; }
      else if (tb.isOp('-')) { tb.adv(); const r = this.pMul(tb); l = { k: 'bin', op: 'sub', l, r }; }
      else break;
    }
    return l;
  }
  pMul(tb) {
    let l = this.pUnary(tb);
    for (;;) {
      if (tb.isOp('*')) { tb.adv(); const r = this.pUnary(tb); l = { k: 'bin', op: 'mul', l, r }; }
      else if (tb.isOp('/')) { tb.adv(); const r = this.pUnary(tb); l = { k: 'bin', op: 'div', l, r }; }
      else if (tb.isIdent('MOD')) { tb.adv(); const r = this.pUnary(tb); l = { k: 'bin', op: 'mod', l, r }; }
      else break;
    }
    return l;
  }
  pUnary(tb) {
    if (tb.isOp('-')) { tb.adv(); const e = this.pUnary(tb); return { k: 'un', op: 'neg', e }; }
    if (tb.isOp('+')) { tb.adv(); return this.pUnary(tb); }
    return this.pPow(tb);
  }
  pPow(tb) {
    const l = this.pPrimary(tb);
    if (tb.isOp('^')) { tb.adv(); const r = this.pUnary(tb); return { k: 'bin', op: 'pow', l, r }; }
    return l;
  }

  compileBuiltinCall(name, tb) {
    const args = [];
    if (tb.kind() === TK.LP) {
      tb.adv();
      if (tb.kind() !== TK.RP) {
        args.push(this.compileExpr(tb));
        if (tb.kind() === TK.COMMA) {
          tb.adv(); args.push(this.compileExpr(tb));
          if (tb.kind() === TK.COMMA) { tb.adv(); args.push(this.compileExpr(tb)); }
        }
      }
      if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
    }
    return { k: 'call', name, args };
  }

  compileUserFuncCall(fd, tb) {
    const args = [];
    if (tb.kind() === TK.LP) {
      tb.adv();
      if (tb.kind() !== TK.RP) {
        for (;;) {
          if (args.length >= fd.params.length) err('TOO MANY ARGS');
          args.push(this.compileExpr(tb));
          if (tb.kind() === TK.COMMA) tb.adv(); else break;
        }
      }
      if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
    }
    if (args.length !== fd.params.length) err('WRONG ARG COUNT');
    return { t: 'CALLFUNC', k: 'ucall', name: fd.name, args };
  }

  pPrimary(tb) {
    if (tb.kind() === TK.NUM) { const v = tb.tok().num; tb.adv(); return { k: 'num', v }; }
    if (tb.kind() === TK.STR) { const v = tb.tok().s; tb.adv(); return { k: 'str', v }; }
    if (tb.kind() === TK.LP) {
      tb.adv(); const e = this.compileExpr(tb);
      if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
      return e;
    }
    if (tb.kind() === TK.IDENT) {
      const name = tb.tok().s; tb.adv();
      if (BUILTIN_NAMES.has(name)) return this.compileBuiltinCall(name, tb);
      const fd = this.funcsByName.get(name);
      if (fd && tb.kind() === TK.LP) return this.compileUserFuncCall(fd, tb);
      if (tb.kind() === TK.LP) {
        tb.adv();
        const idx1 = this.compileExpr(tb);
        let idx2 = null;
        if (tb.kind() === TK.COMMA) { tb.adv(); idx2 = this.compileExpr(tb); }
        if (tb.kind() === TK.RP) tb.adv(); else err('MISSING )');
        return { k: 'arr', name, isStr: isStrName(name), idx1, idx2 };
      }
      return { k: 'var', name, isStr: isStrName(name) };
    }
    err('SYNTAX ERROR');
    return { k: 'num', v: 0 };
  }
}

function isDefnLine(text) { return firstWord(text) === 'DEFN'; }
function isEndfnLine(text) { return firstWord(text) === 'ENDFN'; }
function firstWord(s) {
  let i = 0;
  while (s[i] === ' ' || s[i] === '\t') i++;
  let j = i;
  while (j < s.length && isAlnum(s[j]) && (j - i) < 15) j++;
  return s.slice(i, j).toUpperCase();
}

// -------------------------------------------------------------- interpreter

const MAX_CALL_DEPTH = 32;
const MAX_FOR_STACK = 500;
const MAX_GOSUB_STACK = 500;

export class BasicInterpreter {
  constructor(host) {
    this.host = host;
    this.prog = [];             // [{num, text}] sorted by num
    this.reset(true);
  }

  reset(clearProgram) {
    if (clearProgram) this.prog = [];
    this.numVars = new Map();
    this.strVars = new Map();
    this.arrays = new Map();    // name -> {isStr, dims, d1, d2, data}
    this.funcsByName = new Map();
    this.main = [];
    this.dataVals = [];
    this.dataLineOf = [];
    this.dataPtr = 0;
    this.running = false;
    this.stopRequested = false;
    this.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    this.startTime = Date.now();
    this.outCol = 0;
    this.filePrintTarget = 0;
    this.filePrintBuf = '';
    this.fileSlots = {};        // n -> {inUse, isInput, lines, pos, buf, name}
  }

  // ------------------------------------------------------------- program table

  findLinePos(num) {
    let lo = 0, hi = this.prog.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.prog[mid].num < num) lo = mid + 1; else hi = mid; }
    return lo;
  }
  hasLine(num) { const p = this.findLinePos(num); return p < this.prog.length && this.prog[p].num === num; }

  insertLine(num, text) {
    const pos = this.findLinePos(num);
    const empty = text.length === 0;
    const exists = pos < this.prog.length && this.prog[pos].num === num;
    if (exists) {
      if (empty) this.prog.splice(pos, 1);
      else this.prog[pos] = { num, text };
    } else if (!empty) {
      this.prog.splice(pos, 0, { num, text });
    }
  }

  nextAutoLine(start) {
    let n = start;
    while (this.hasLine(n)) n++;
    return n;
  }

  listing() { return this.prog.map((l) => `${l.num} ${l.text}`); }

  programText() { return this.listing().join('\n'); }

  // Parses "NUM rest text" lines like the Oberon LoadFile: numbered lines are
  // stored as-is; unnumbered lines are only accepted inside a DEFN block and
  // auto-numbered from 60000 up.
  loadProgramText(text) {
    this.prog = [];
    let autoNum = 60000;
    let inDefn = false;
    for (let raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      const m = line.match(/^(\d+)\s*(.*)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        const rest = expandQuestionMarks(m[2].trim());
        this.insertLine(num, rest);
        if (isDefnLine(rest)) inDefn = true; else if (isEndfnLine(rest)) inDefn = false;
      } else {
        const rest = expandQuestionMarks(line);
        if (isDefnLine(rest) || inDefn) {
          this.insertLine(autoNum, rest); autoNum++;
          if (isDefnLine(rest)) inDefn = true; else if (isEndfnLine(rest)) inDefn = false;
        }
      }
    }
  }

  // ---------------------------------------------------------------- compile

  compileProgram() {
    this.funcsByName = new Map();
    let i = 0;
    let headerErr = null;
    while (i < this.prog.length) {
      if (isDefnLine(this.prog[i].text)) {
        const fd = new FuncDef('');
        try {
          this.parseDefnHeader(this.prog[i].text, fd);
        } catch (e) {
          if (e instanceof BasicError) { headerErr = { msg: e.basicMsg, line: this.prog[i].num }; }
          else throw e;
        }
        fd.bodyStart = i + 1;
        let k = i + 1;
        while (k < this.prog.length && !isEndfnLine(this.prog[k].text)) k++;
        fd.bodyEnd = k;
        if (k >= this.prog.length && !headerErr) headerErr = { msg: 'DEFN WITHOUT ENDFN', line: this.prog[i].num };
        if (!headerErr) this.funcsByName.set(fd.name, fd);
        i = (k < this.prog.length) ? k + 1 : this.prog.length;
      } else {
        i++;
      }
    }
    if (headerErr) return headerErr;

    const compiler = new Compiler(this.prog, this.funcsByName);
    const compErr = compiler.compileAll();
    if (compErr) return compErr;
    this.main = compiler.main;
    this.lineIndex = compiler.lineIndex;
    return null;
  }

  parseDefnHeader(text, fd) {
    const tb = new Cur(tokenize(text));
    if (!tb.isIdent('DEFN')) err('SYNTAX ERROR');
    tb.adv();
    if (tb.kind() !== TK.IDENT) err('DEFN: EXPECTED NAME');
    fd.name = tb.tok().s; tb.adv();
    fd.isStr = isStrName(fd.name);
    if (tb.kind() === TK.LP) {
      tb.adv();
      if (tb.kind() !== TK.RP) {
        for (;;) {
          if (tb.kind() !== TK.IDENT) err('DEFN: BAD PARAM');
          if (fd.params.length >= 8) err('DEFN: TOO MANY PARAMS');
          const pname = tb.tok().s; tb.adv();
          fd.params.push({ name: pname, isStr: isStrName(pname) });
          if (tb.kind() === TK.COMMA) tb.adv(); else break;
        }
      }
      if (tb.kind() === TK.RP) tb.adv(); else err('DEFN: MISSING )');
    }
  }

  scanData() {
    this.dataVals = []; this.dataLineOf = []; this.dataPtr = 0;
    let i = 0;
    while (i < this.prog.length) {
      if (isDefnLine(this.prog[i].text)) {
        let k = i + 1;
        while (k < this.prog.length && !isEndfnLine(this.prog[k].text)) k++;
        i = (k < this.prog.length) ? k + 1 : this.prog.length;
        continue;
      }
      const tb = new Cur(tokenize(this.prog[i].text));
      while (tb.kind() !== TK.EOL) {
        if (tb.isIdent('DATA')) {
          tb.adv();
          for (;;) {
            let v;
            if (tb.kind() === TK.STR) { v = mkStr(tb.tok().s); tb.adv(); }
            else {
              let neg = false;
              if (tb.isOp('-')) { neg = true; tb.adv(); }
              if (tb.kind() === TK.NUM) { v = mkNum(neg ? -tb.tok().num : tb.tok().num); tb.adv(); }
              else if (tb.kind() === TK.IDENT) { v = mkStr(tb.tok().s); tb.adv(); }
              else break;
            }
            this.dataVals.push(v); this.dataLineOf.push(this.prog[i].num);
            if (tb.kind() === TK.COMMA) tb.adv(); else break;
          }
        } else {
          tb.adv();
        }
      }
      i++;
    }
  }

  // ------------------------------------------------------------------ vars

  getNum(name) { return this.numVars.has(name) ? this.numVars.get(name) : 0; }
  setNum(name, v) { this.numVars.set(name, v); }
  getStr(name) { return this.strVars.has(name) ? this.strVars.get(name) : ''; }
  setStr(name, v) { this.strVars.set(name, v); }

  assignScalar(name, isStr, v) {
    if (isStr) {
      if (!v.isStr) err('TYPE MISMATCH');
      this.setStr(name, v.s);
    } else {
      if (v.isStr) err('TYPE MISMATCH');
      this.setNum(name, v.num);
    }
  }

  dimArray(name, isStr, d1, d2) {
    const sz1 = d1 + 1;
    const sz2 = d2 >= 0 ? d2 + 1 : 1;
    const total = sz1 * sz2;
    if (isStr) { if (total > 20000) err('ARRAY TOO LARGE'); }
    else if (total > 400000) err('ARRAY TOO LARGE');
    const entry = {
      isStr, dims: d2 >= 0 ? 2 : 1, d1, d2,
      data: isStr ? new Array(total).fill('') : new Array(total).fill(0),
    };
    this.arrays.set(name, entry);
    return entry;
  }

  ensureArray(name, isStr) {
    let a = this.arrays.get(name);
    if (!a) a = this.dimArray(name, isStr, 10, -1);
    return a;
  }

  arrIndex(ae, i1, i2) {
    if (i1 < 0 || i1 > ae.d1) err('SUBSCRIPT OUT OF RANGE');
    if (ae.dims === 1) return i1;
    if (i2 < 0 || i2 > ae.d2) err('SUBSCRIPT OUT OF RANGE');
    return i1 * (ae.d2 + 1) + i2;
  }

  assignArrayElem(name, isStr, i1, i2, v) {
    const ae = this.ensureArray(name, isStr);
    const idx = this.arrIndex(ae, i1, i2);
    if (ae.isStr) { if (!v.isStr) err('TYPE MISMATCH'); ae.data[idx] = v.s; }
    else { if (v.isStr) err('TYPE MISMATCH'); ae.data[idx] = v.num; }
  }

  loadArrayElem(name, isStr, i1, i2) {
    const ae = this.ensureArray(name, isStr);
    let idx;
    try { idx = this.arrIndex(ae, i1, i2); }
    catch (e) { throw e; }
    return ae.isStr ? mkStr(ae.data[idx]) : mkNum(ae.data[idx]);
  }

  snapshotScalars() { return { num: new Map(this.numVars), str: new Map(this.strVars) }; }
  restoreScalars(snap) { this.numVars = snap.num; this.strVars = snap.str; }

  // -------------------------------------------------------------- expressions

  evalExpr(e) {
    switch (e.k) {
      case 'num': return mkNum(e.v);
      case 'str': return mkStr(e.v);
      case 'var': return e.isStr ? mkStr(this.getStr(e.name)) : mkNum(this.getNum(e.name));
      case 'arr': {
        const i1 = Math.floor(this.evalExpr(e.idx1).num);
        const i2 = e.idx2 ? Math.floor(this.evalExpr(e.idx2).num) : -1;
        return this.loadArrayElem(e.name, e.isStr, i1, i2);
      }
      case 'un': {
        const v = this.evalExpr(e.e);
        if (e.op === 'neg') return mkNum(-v.num);
        return mkBool(!truthy(v));
      }
      case 'bin': return this.evalBin(e);
      case 'call': return this.evalBuiltin(e.name, e.args.map((a) => this.evalExpr(a)));
      case 'ucall': return this.callUserFunc(e.name, e.args.map((a) => this.evalExpr(a)));
      default: err('SYNTAX ERROR'); return mkNum(0);
    }
  }

  evalBin(e) {
    if (e.op === 'and') return mkBool(truthy(this.evalExpr(e.l)) && truthy(this.evalExpr(e.r)));
    if (e.op === 'or') return mkBool(truthy(this.evalExpr(e.l)) || truthy(this.evalExpr(e.r)));
    const l = this.evalExpr(e.l), r = this.evalExpr(e.r);
    switch (e.op) {
      case 'add':
        if (l.isStr || r.isStr) return mkStr(l.s + r.s);
        return mkNum(l.num + r.num);
      case 'sub': return mkNum(l.num - r.num);
      case 'mul': return mkNum(l.num * r.num);
      case 'div':
        if (r.num === 0) err('DIVISION BY ZERO');
        return mkNum(l.num / r.num);
      case 'mod': {
        const rv = Math.floor(r.num);
        if (rv === 0) err('DIVISION BY ZERO');
        const lv = Math.floor(l.num);
        return mkNum(((lv % rv) + rv) % rv);
      }
      case 'pow': return mkNum(Math.pow(l.num, r.num));
      case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': {
        let c;
        if (l.isStr || r.isStr) c = l.s < r.s ? -1 : (l.s > r.s ? 1 : 0);
        else c = l.num < r.num ? -1 : (l.num > r.num ? 1 : 0);
        if (e.op === 'eq') return mkBool(c === 0);
        if (e.op === 'ne') return mkBool(c !== 0);
        if (e.op === 'lt') return mkBool(c < 0);
        if (e.op === 'gt') return mkBool(c > 0);
        if (e.op === 'le') return mkBool(c <= 0);
        return mkBool(c >= 0);
      }
      default: err('SYNTAX ERROR'); return mkNum(0);
    }
  }

  evalBuiltin(name, args) {
    const a1 = args[0] || mkNum(0), a2 = args[1] || mkNum(0), a3 = args[2];
    const host = this.host;
    switch (name) {
      case 'ABS': return mkNum(Math.abs(a1.num));
      case 'INT': return mkNum(Math.floor(a1.num));
      case 'SGN': return mkNum(a1.num > 0 ? 1 : (a1.num < 0 ? -1 : 0));
      case 'SQR': return mkNum(Math.sqrt(a1.num));
      case 'SIN': return mkNum(Math.sin(a1.num));
      case 'COS': return mkNum(Math.cos(a1.num));
      case 'TAN': return mkNum(Math.tan(a1.num));
      case 'ATN': return mkNum(Math.atan(a1.num));
      case 'LOG': return mkNum(Math.log(a1.num));
      case 'EXP': return mkNum(Math.exp(a1.num));
      case 'PI': return mkNum(Math.PI);
      case 'RND': return mkNum(this.rng());
      case 'TIMER': return mkNum((Date.now() - this.startTime) / 1000);
      case 'LEN': return mkNum(a1.s.length);
      case 'VAL': { const v = parseFloat(a1.s); return mkNum(Number.isNaN(v) ? 0 : v); }
      case 'ASC': return mkNum(a1.s.length > 0 ? a1.s.charCodeAt(0) : 0);
      case 'CHR$': return mkStr(String.fromCharCode(Math.floor(a1.num) & 0xffff));
      case 'STR$': return mkStr(numToStr(a1.num));
      case 'LEFT$': {
        let n = Math.floor(a2.num); if (n < 0) n = 0; if (n > a1.s.length) n = a1.s.length;
        return mkStr(a1.s.slice(0, n));
      }
      case 'RIGHT$': {
        let n = Math.floor(a2.num); if (n < 0) n = 0; if (n > a1.s.length) n = a1.s.length;
        return mkStr(n === 0 ? '' : a1.s.slice(-n));
      }
      case 'MID$': {
        let start = Math.floor(a2.num) - 1; if (start < 0) start = 0;
        let len = a3 !== undefined ? Math.floor(a3.num) : a1.s.length;
        if (start > a1.s.length) start = a1.s.length;
        if (start + len > a1.s.length) len = a1.s.length - start;
        if (len < 0) len = 0;
        return mkStr(a1.s.substr(start, len));
      }
      case 'INSTR': {
        if (a3 !== undefined) {
          const start = Math.max(0, Math.floor(a2.num) - 1);
          const pos = a1.s.indexOf(a3.s, start);
          return mkNum(pos + 1);
        }
        return mkNum(a1.s.indexOf(a2.s) + 1);
      }
      case 'INKEY$': return mkStr(host.inkey ? host.inkey() : '');
      case 'STRING$': {
        let n = Math.floor(a1.num); if (n < 0) n = 0; if (n > 255) n = 255;
        const ch = a2.isStr ? (a2.s.length > 0 ? a2.s[0] : ' ') : String.fromCharCode(Math.floor(a2.num) & 0xffff);
        return mkStr(ch.repeat(n));
      }
      case 'SPACE$': {
        let n = Math.floor(a1.num); if (n < 0) n = 0; if (n > 255) n = 255;
        return mkStr(' '.repeat(n));
      }
      case 'SCRW': return mkNum(host.scrw ? host.scrw() : 640);
      case 'SCRH': return mkNum(host.scrh ? host.scrh() : 480);
      case 'MOUSEX': return mkNum(host.mousex ? host.mousex() : 0);
      case 'MOUSEY': return mkNum(host.mousey ? host.mousey() : 0);
      case 'MOUSEB': return mkBool(host.mouseb ? host.mouseb() : false);
      case 'EOF': {
        const n = Math.floor(a1.num);
        const slot = this.fileSlots[n];
        if (slot && slot.inUse && slot.isInput) return mkBool(slot.pos >= slot.lines.length);
        return mkBool(true);
      }
      default: err('UNKNOWN FUNCTION'); return mkNum(0);
    }
  }

  // ------------------------------------------------------------------ print

  printOut(s) {
    if (this.filePrintTarget !== 0) { this.filePrintBuf += s; return; }
    this.host.print(s);
    for (const ch of s) { if (ch === '\n') this.outCol = 0; else this.outCol++; }
  }
  printCol() { return this.filePrintTarget !== 0 ? this.filePrintBuf.length : this.outCol; }
  printNL() {
    if (this.filePrintTarget !== 0) {
      const slot = this.fileSlots[this.filePrintTarget];
      if (slot && slot.inUse) slot.buf.push(this.filePrintBuf);
      else err('FILE NOT OPEN');
      this.filePrintTarget = 0; this.filePrintBuf = '';
    } else {
      this.host.print('\n'); this.outCol = 0;
    }
  }

  // -------------------------------------------------------------- file I/O

  async doOpen(name, mode, n) {
    if (n < 1 || n > 32) err('BAD FILE NUMBER');
    if (this.fileSlots[n] && this.fileSlots[n].inUse) await this.closeFileSlot(n);
    if (mode === 0) {
      const text = await this.host.fs.readFile(name);
      if (text === null || text === undefined) err('FILE NOT FOUND');
      this.fileSlots[n] = { inUse: true, isInput: true, lines: text.split(/\r\n|\r|\n/), pos: 0, name };
      if (this.fileSlots[n].lines.length && this.fileSlots[n].lines[this.fileSlots[n].lines.length - 1] === '') {
        this.fileSlots[n].lines.pop();
      }
    } else if (mode === 1) {
      this.fileSlots[n] = { inUse: true, isInput: false, buf: [], name };
    } else {
      const text = await this.host.fs.readFile(name);
      const buf = (text === null || text === undefined) ? [] : text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
      this.fileSlots[n] = { inUse: true, isInput: false, buf, name };
    }
  }

  async closeFileSlot(n) {
    const slot = this.fileSlots[n];
    if (!slot || !slot.inUse) return;
    if (!slot.isInput) await this.host.fs.writeFile(slot.name, slot.buf.join('\n') + (slot.buf.length ? '\n' : ''));
    slot.inUse = false;
  }

  async closeAllFiles() {
    for (const n of Object.keys(this.fileSlots)) await this.closeFileSlot(Number(n));
  }

  // -------------------------------------------------------------------- run

  async runProgram() {
    this.numVars.clear(); this.strVars.clear(); this.arrays.clear();
    const cerr = this.compileProgram();
    if (cerr) { this.reportError(cerr.msg, cerr.line); return; }
    this.scanData();
    this.startTime = Date.now();
    this.forStack = []; this.gosubStack = []; this.callStack = [];
    await this.execute(this.main, 0, -1);
  }

  // Note: unlike runProgram(), this deliberately leaves forStack/gosubStack
  // alone (only callStack is reset) so FOR/GOSUB state left behind by a
  // stopped program run, or by a previous immediate command, can still be
  // resumed from the prompt — matches the original REPL's `callTop := 0`
  // (and nothing else) before running an immediate-mode line.
  async runImmediate(text) {
    const cerr = this.compileProgram();
    if (cerr) { this.reportError(cerr.msg, cerr.line); return; }
    const compiler = new Compiler(this.prog, this.funcsByName);
    compiler.lineIndex = this.lineIndex;
    compiler.gotoBackpatch = [];
    compiler.onBackpatch = [];
    const out = [];
    compiler.out = out;
    compiler.main = this.main;
    try {
      compiler.compileStmtSeq(new Cur(tokenize(text)));
    } catch (e) {
      if (e instanceof BasicError) { this.reportError(e.basicMsg, -1); return; }
      throw e;
    }
    for (const idx of compiler.lineFixups) out[idx].target = out.length;
    out.push({ t: 'END' });
    for (const bp of compiler.gotoBackpatch) bp.rec[bp.field] = this.lineIndex.has(bp.lineNum) ? this.lineIndex.get(bp.lineNum) : -1;
    for (const bp of compiler.onBackpatch) bp.targets[bp.i] = this.lineIndex.has(bp.lineNum) ? this.lineIndex.get(bp.lineNum) : -1;
    if (!this.forStack) { this.forStack = []; this.gosubStack = []; }
    this.callStack = [];
    await this.execute(out, 0, -1);
  }

  reportError(msg, lineNum) {
    this.printNL();
    this.printOut('?' + msg + ' ERROR');
    if (lineNum >= 0) this.printOut(' IN ' + numToStr(lineNum));
    this.printNL();
  }

  stop() { this.stopRequested = true; }

  // The core statement loop. `arr` is the flat statement array to start in;
  // `pc` the starting index; `currentLine` seeds this.currentLineNum
  // (-1 for immediate-mode code, matching the original's REPL behavior).
  // Execution can cross from `arr` into `this.main` (and back) when GOTO/
  // GOSUB fire — e.g. an immediate-mode command that jumps into the stored
  // program — so which array is "current" is itself part of the loop state.
  async execute(arr, pc, currentLine) {
    this.running = true;
    this.stopRequested = false;
    this.currentLineNum = currentLine;
    let curArr = arr;
    let steps = 0;
    try {
      while (this.running) {
        if (pc < 0 || pc >= curArr.length) break;
        // Checked every iteration (cheap) so a Stop click takes effect on the
        // very next statement even in a DELAY/SOUND-heavy loop that executes
        // only a handful of statements per second. Yielding to the event
        // loop is throttled separately below since it's comparatively
        // expensive and only needed to keep a tight, non-awaiting loop from
        // starving the UI thread (and the Stop click that would end it).
        if (this.stopRequested) {
          this.printNL(); this.printOut('BREAK');
          if (this.currentLineNum >= 0) this.printOut(' IN ' + numToStr(this.currentLineNum));
          this.printNL();
          break;
        }
        steps++;
        if (steps >= 400) {
          steps = 0;
          await new Promise((r) => setTimeout(r, 0));
        }
        const st = curArr[pc];
        const next = await this.step(st, curArr, pc);
        if (next === undefined) { pc = pc + 1; } else { curArr = next.arr; pc = next.pc; }
      }
    } catch (e) {
      if (e instanceof BasicError) {
        this.reportError(e.basicMsg, this.currentLineNum);
      } else {
        throw e;
      }
    }
    this.running = false;
  }

  // Executes one statement record; returns the next pc, or undefined to fall
  // through to pc+1. `arr`/`pc` identify the statement's own position, used
  // by control-flow records that jump within the same array (IF/WHILE) vs.
  // records that jump by resolved line index into `this.main` (GOTO/GOSUB).
  async step(st, arr, pc) {
    const host = this.host;
    switch (st.t) {
      case 'LINE':
        this.currentLineNum = st.num;
        if (this.filePrintTarget !== 0) { this.filePrintTarget = 0; this.filePrintBuf = ''; }
        return;
      case 'END': this.running = false; return;
      case 'EVALDISCARD': this.evalExpr(st.expr); return;
      case 'LET': {
        const v = this.evalExpr(st.expr);
        if (st.idx1) {
          const i1 = Math.floor(this.evalExpr(st.idx1).num);
          const i2 = st.idx2 ? Math.floor(this.evalExpr(st.idx2).num) : -1;
          this.assignArrayElem(st.name, st.isStr, i1, i2, v);
        } else {
          this.assignScalar(st.name, st.isStr, v);
        }
        return;
      }
      case 'CALLFUNC': this.callUserFunc(st.name, st.args.map((a) => this.evalExpr(a))); return;
      case 'PRINT': {
        let fileN = 0;
        if (st.fileExpr) { fileN = Math.floor(this.evalExpr(st.fileExpr).num); this.filePrintTarget = fileN; this.filePrintBuf = ''; }
        for (const seg of st.segs) {
          if (seg.k === 'val') {
            const v = this.evalExpr(seg.expr);
            this.printOut(v.isStr ? v.s : numToStr(v.num));
          } else if (seg.k === 'tab') {
            const n = Math.floor(this.evalExpr(seg.expr).num);
            while (this.printCol() < n) this.printOut(' ');
          } else if (seg.k === 'comma') {
            const n = (Math.floor(this.printCol() / 14) + 1) * 14;
            while (this.printCol() < n) this.printOut(' ');
          }
        }
        if (st.nl) this.printNL();
        return;
      }
      case 'INPUT': {
        if (st.fileExpr) {
          const n = Math.floor(this.evalExpr(st.fileExpr).num);
          const slot = this.fileSlots[n];
          let raw = '';
          if (slot && slot.inUse && slot.isInput) raw = slot.lines[slot.pos++] ?? '';
          else err('FILE NOT OPEN');
          this.assignInputFields(st.targets, raw);
        } else {
          const prompt = (st.promptStr !== null ? st.promptStr : '') + '? ';
          const raw = await host.inputLine(prompt);
          if (raw === null) {
            this.running = false;
            this.printNL(); this.printOut('BREAK');
            if (this.currentLineNum >= 0) this.printOut(' IN ' + numToStr(this.currentLineNum));
            this.printNL();
            return;
          }
          this.assignInputFields(st.targets, raw);
        }
        return;
      }
      case 'LINEINPUT': {
        const n = Math.floor(this.evalExpr(st.fileExpr).num);
        const slot = this.fileSlots[n];
        let raw = '';
        if (slot && slot.inUse && slot.isInput) raw = slot.lines[slot.pos++] ?? '';
        else err('FILE NOT OPEN');
        this.assignScalar(st.name, st.isStr, mkStr(raw));
        return;
      }
      case 'DIM': {
        for (const it of st.items) {
          let d1 = 10, d2 = -1;
          if (it.d1) d1 = Math.floor(this.evalExpr(it.d1).num);
          if (it.d2) d2 = Math.floor(this.evalExpr(it.d2).num);
          this.dimArray(it.name, it.isStr, d1, d2);
        }
        return;
      }
      case 'READ': {
        for (const t of st.targets) {
          if (this.dataPtr >= this.dataVals.length) err('OUT OF DATA');
          let v = this.dataVals[this.dataPtr++];
          v = this.coerceDataValue(v, t.isStr);
          if (t.idx1) {
            const i1 = Math.floor(this.evalExpr(t.idx1).num);
            const i2 = t.idx2 ? Math.floor(this.evalExpr(t.idx2).num) : -1;
            this.assignArrayElem(t.name, t.isStr, i1, i2, v);
          } else {
            this.assignScalar(t.name, t.isStr, v);
          }
        }
        return;
      }
      case 'RESTORE': {
        if (st.expr) {
          const target = Math.floor(this.evalExpr(st.expr).num);
          let i = 0; while (i < this.dataLineOf.length && this.dataLineOf[i] < target) i++;
          this.dataPtr = i;
        } else this.dataPtr = 0;
        return;
      }
      case 'GOTO': if (st.target < 0) err('UNDEFINED LINE'); return { arr: this.main, pc: st.target };
      case 'GOTODYN': {
        const target = Math.floor(this.evalExpr(st.expr).num);
        if (!this.lineIndex.has(target)) err('UNDEFINED LINE');
        return { arr: this.main, pc: this.lineIndex.get(target) };
      }
      case 'GOSUB': {
        if (st.target < 0) err('UNDEFINED LINE');
        if (this.gosubStack.length >= MAX_GOSUB_STACK) err('GOSUB TOO DEEP');
        this.gosubStack.push({ arr, pc: pc + 1 });
        return { arr: this.main, pc: st.target };
      }
      case 'GOSUBDYN': {
        const target = Math.floor(this.evalExpr(st.expr).num);
        if (!this.lineIndex.has(target)) err('UNDEFINED LINE');
        if (this.gosubStack.length >= MAX_GOSUB_STACK) err('GOSUB TOO DEEP');
        this.gosubStack.push({ arr, pc: pc + 1 });
        return { arr: this.main, pc: this.lineIndex.get(target) };
      }
      case 'GOSUBRETURN': {
        if (this.gosubStack.length === 0) err('RETURN WITHOUT GOSUB');
        return this.gosubStack.pop();
      }
      case 'ON': {
        const idx = Math.floor(this.evalExpr(st.expr).num);
        if (idx >= 1 && idx <= st.targets.length) {
          const target = st.targets[idx - 1];
          if (target < 0) err('UNDEFINED LINE');
          if (st.isGosub) {
            if (this.gosubStack.length >= MAX_GOSUB_STACK) err('GOSUB TOO DEEP');
            this.gosubStack.push({ arr, pc: pc + 1 });
          }
          return { arr: this.main, pc: target };
        }
        return;
      }
      case 'FOR': {
        const from = this.evalExpr(st.fromExpr).num;
        const limit = this.evalExpr(st.toExpr).num;
        const step = this.evalExpr(st.stepExpr).num;
        if (this.forStack.length >= MAX_FOR_STACK) { err('FOR TOO DEEP'); return; }
        this.setNum(st.name, from);
        this.forStack.push({ varName: st.name, limit, step, loopArr: arr, loopPc: pc + 1 });
        return;
      }
      case 'NEXT': {
        if (this.forStack.length === 0) { err('NEXT WITHOUT FOR'); return; }
        const f = this.forStack[this.forStack.length - 1];
        this.setNum(f.varName, this.getNum(f.varName) + f.step);
        const v = this.getNum(f.varName);
        const cont = f.step >= 0 ? v <= f.limit + 1e-9 : v >= f.limit - 1e-9;
        if (cont) return { arr: f.loopArr, pc: f.loopPc };
        this.forStack.pop();
        return;
      }
      case 'JUMPFALSE': {
        const v = this.evalExpr(st.cond);
        if (!truthy(v)) return { arr, pc: st.target };
        return;
      }
      case 'JUMP': return { arr, pc: st.target };
      // FUNCRETURN never reaches this async loop: user-function calls are
      // dispatched synchronously via callUserFunc()/runFuncBodySync() below,
      // which run entirely inside a `fd.body` array of their own, so pc
      // never enters a function body through GOTO/GOSUB (main/immediate
      // code targets only line numbers, which resolve into `this.main`).
      case 'CLS': host.cls && host.cls(); return;
      case 'LOCATE': {
        const row = Math.floor(this.evalExpr(st.rowExpr).num);
        const col = st.colExpr ? Math.floor(this.evalExpr(st.colExpr).num) : 1;
        host.locate && host.locate(row, col);
        return;
      }
      case 'RANDOMIZE': {
        if (st.expr) this.rng = mulberry32(Math.floor(this.evalExpr(st.expr).num) >>> 0);
        else this.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
        return;
      }
      case 'SCREEN': {
        const w = Math.floor(this.evalExpr(st.wExpr).num);
        const h = st.hExpr ? Math.floor(this.evalExpr(st.hExpr).num) : 480;
        host.ensureGfx && host.ensureGfx(w, h);
        return;
      }
      case 'COLOR': {
        const fg = Math.floor(this.evalExpr(st.fgExpr).num);
        const bg = st.bgExpr ? Math.floor(this.evalExpr(st.bgExpr).num) : null;
        host.color && host.color(fg, bg);
        return;
      }
      case 'PSET': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.pset && host.pset(x, y, c);
        return;
      }
      case 'DRAWLINE': {
        const x1 = Math.floor(this.evalExpr(st.x1).num), y1 = Math.floor(this.evalExpr(st.y1).num);
        const x2 = Math.floor(this.evalExpr(st.x2).num), y2 = Math.floor(this.evalExpr(st.y2).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.line && host.line(x1, y1, x2, y2, c);
        return;
      }
      case 'CIRCLE': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const r = this.evalExpr(st.rExpr).num;
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.circle && host.circle(x, y, r, c, st.filled);
        return;
      }
      case 'RECT': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const w = Math.floor(this.evalExpr(st.wExpr).num), h = Math.floor(this.evalExpr(st.hExpr).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.rect && host.rect(x, y, w, h, c, st.filled);
        return;
      }
      case 'TEXT': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const v = this.evalExpr(st.sExpr);
        const s = v.isStr ? v.s : numToStr(v.num);
        const sz = st.szExpr ? Math.floor(this.evalExpr(st.szExpr).num) : 20;
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.text && host.text(x, y, s, sz, c);
        return;
      }
      case 'SOUND': {
        const freq = this.evalExpr(st.freqExpr).num;
        const ms = Math.floor(this.evalExpr(st.msExpr).num);
        if (host.sound) await host.sound(freq, ms);
        return;
      }
      case 'BEEP': if (host.beep) await host.beep(); return;
      case 'DELAY': {
        const ms = Math.floor(this.evalExpr(st.msExpr).num);
        if (ms > 0 && host.delay) await host.delay(ms);
        return;
      }
      case 'OPEN': {
        const name = this.evalExpr(st.nameExpr).s;
        const n = Math.floor(this.evalExpr(st.numExpr).num);
        await this.doOpen(name, st.mode, n);
        return;
      }
      case 'CLOSEFILE': {
        if (st.numExpr) await this.closeFileSlot(Math.floor(this.evalExpr(st.numExpr).num));
        else await this.closeAllFiles();
        return;
      }
      case 'FILES': {
        const arg = st.expr ? this.evalExpr(st.expr).s : '';
        await this.doFiles(arg);
        return;
      }
      default:
        err('SYNTAX ERROR');
    }
  }

  coerceDataValue(v, wantStr) {
    if (wantStr && !v.isStr) return mkStr(numToStr(v.num));
    if (!wantStr && v.isStr) { const n = parseFloat(v.s); return mkNum(Number.isNaN(n) ? 0 : n); }
    return v;
  }

  assignInputFields(targets, raw) {
    const parts = raw.split(',');
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const part = (parts[i] !== undefined ? parts[i] : '').trim();
      const v = t.isStr ? mkStr(part) : mkNum((() => { const n = parseFloat(part); return Number.isNaN(n) ? 0 : n; })());
      if (t.idx1) {
        const i1 = Math.floor(this.evalExpr(t.idx1).num);
        const i2 = t.idx2 ? Math.floor(this.evalExpr(t.idx2).num) : -1;
        this.assignArrayElem(t.name, t.isStr, i1, i2, v);
      } else {
        this.assignScalar(t.name, t.isStr, v);
      }
    }
  }

  async doFiles(arg) {
    const star = arg.indexOf('*');
    const filter = star >= 0 ? arg.slice(star + 1) : arg;
    const names = await this.host.fs.list();
    const shown = names.filter((n) => filter === '' || n.endsWith(filter));
    for (const n of shown) this.printOut(n), this.printNL();
    this.printOut(String(shown.length) + ' File(s)'); this.printNL();
  }

  // DEFN calls are synchronous with respect to the caller's expression
  // evaluation (matching the original opCallUserFuncExpr/Stmt), so this
  // recurses rather than round-tripping through `execute`'s pc loop. Nested
  // calls, recursion and RETURN-with-value are handled by re-entering
  // `execute` on the function's own body array and reading back the pushed
  // return value.
  callUserFunc(name, argVals) {
    const fd = this.funcsByName.get(name);
    if (!fd) err('UNKNOWN FUNCTION');
    if (this.callStack.length >= MAX_CALL_DEPTH) err('CALL DEPTH EXCEEDED');
    const snap = this.snapshotScalars();
    this.numVars = new Map(); this.strVars = new Map();
    for (let k = 0; k < fd.params.length; k++) {
      const p = fd.params[k];
      let v = argVals[k];
      if (p.isStr) { if (!v.isStr) v = mkStr(numToStr(v.num)); this.setStr(p.name, v.s); }
      else { if (v.isStr) { const n = parseFloat(v.s); v = mkNum(Number.isNaN(n) ? 0 : n); } this.setNum(p.name, v.num); }
    }
    const frame = {
      funcName: name, snap,
      savedForLen: this.forStack.length, savedGosubLen: this.gosubStack.length,
      result: fd.isStr ? mkStr('') : mkNum(0),
    };
    this.callStack.push(frame);
    // Re-entrant, synchronous mini-run over the function's body array. DEFN
    // bodies never touch async host calls that matter mid-expression (SOUND
    // etc. are statements, not expressions), so a blocking loop here is fine
    // and keeps expression evaluation (evalExpr) synchronous throughout.
    this.runFuncBodySync(fd.body, 0, frame);
    return frame.result;
  }

  runFuncBodySync(arr, pc, frame) {
    let steps = 0;
    while (pc >= 0 && pc < arr.length) {
      if (++steps > 5_000_000) err('CALL DEPTH EXCEEDED');
      const st = arr[pc];
      if (st.t === 'FUNCRETURN') {
        const fd = this.funcsByName.get(frame.funcName);
        let result;
        if (st.expr) {
          const v = this.evalExpr(st.expr);
          if (fd.isStr) result = v.isStr ? v : mkStr(numToStr(v.num));
          else result = v.isStr ? mkNum(parseFloat(v.s) || 0) : v;
        } else {
          result = fd.isStr ? mkStr('') : mkNum(0);
        }
        this.callStack.pop();
        this.restoreScalars(frame.snap);
        this.forStack.length = frame.savedForLen;
        this.gosubStack.length = frame.savedGosubLen;
        frame.result = result;
        return;
      }
      // stepSync's FOR/NEXT/IF/WHILE cases return {arr, pc}, but a DEFN body
      // never jumps outside its own array (GOTO/GOSUB by line number are
      // no-ops here — see stepSync), so `next.arr` is always `arr` itself.
      const next = this.stepSync(st, arr, pc);
      pc = (next === undefined) ? pc + 1 : next.pc;
    }
    // fell off the end without an explicit RETURN
    const fd = this.funcsByName.get(frame.funcName);
    this.callStack.pop();
    this.restoreScalars(frame.snap);
    this.forStack.length = frame.savedForLen;
    this.gosubStack.length = frame.savedGosubLen;
    frame.result = fd.isStr ? mkStr('') : mkNum(0);
  }

  stepSync(st, arr, pc) {
    // Synchronous subset of step(): DEFN bodies cannot contain PRINT#/INPUT
    // awaits that matter here because those statements themselves are fine
    // to run synchronously (host callbacks are cheap/non-blocking for text
    // I/O); only SOUND/BEEP/DELAY are truly async and are disallowed by the
    // grammar inside expressions, not statements, so a DEFN body calling
    // them would still work via the outer async `step` — but to keep this
    // path simple and matching the original (function bodies run inline
    // during expression evaluation), we special-case them out here.
    if (st.t === 'SOUND' || st.t === 'BEEP' || st.t === 'DELAY' || st.t === 'OPEN' ||
        st.t === 'CLOSEFILE' || st.t === 'FILES' || st.t === 'INPUT' && !st.fileExpr) {
      err('STATEMENT NOT ALLOWED IN DEFN');
    }
    const host = this.host;
    switch (st.t) {
      case 'LINE':
        this.currentLineNum = st.num;
        return;
      case 'EVALDISCARD': this.evalExpr(st.expr); return;
      case 'LET': {
        const v = this.evalExpr(st.expr);
        if (st.idx1) {
          const i1 = Math.floor(this.evalExpr(st.idx1).num);
          const i2 = st.idx2 ? Math.floor(this.evalExpr(st.idx2).num) : -1;
          this.assignArrayElem(st.name, st.isStr, i1, i2, v);
        } else {
          this.assignScalar(st.name, st.isStr, v);
        }
        return;
      }
      case 'CALLFUNC': this.callUserFunc(st.name, st.args.map((a) => this.evalExpr(a))); return;
      case 'PRINT': {
        let fileN = 0;
        if (st.fileExpr) { fileN = Math.floor(this.evalExpr(st.fileExpr).num); this.filePrintTarget = fileN; this.filePrintBuf = ''; }
        for (const seg of st.segs) {
          if (seg.k === 'val') {
            const v = this.evalExpr(seg.expr);
            this.printOut(v.isStr ? v.s : numToStr(v.num));
          } else if (seg.k === 'tab') {
            const n = Math.floor(this.evalExpr(seg.expr).num);
            while (this.printCol() < n) this.printOut(' ');
          } else if (seg.k === 'comma') {
            const n = (Math.floor(this.printCol() / 14) + 1) * 14;
            while (this.printCol() < n) this.printOut(' ');
          }
        }
        if (st.nl) this.printNL();
        return;
      }
      case 'INPUT': {
        // only the file-targeted, synchronous form reaches here
        const n = Math.floor(this.evalExpr(st.fileExpr).num);
        const slot = this.fileSlots[n];
        let raw = '';
        if (slot && slot.inUse && slot.isInput) raw = slot.lines[slot.pos++] ?? '';
        else err('FILE NOT OPEN');
        this.assignInputFields(st.targets, raw);
        return;
      }
      case 'LINEINPUT': {
        const n = Math.floor(this.evalExpr(st.fileExpr).num);
        const slot = this.fileSlots[n];
        let raw = '';
        if (slot && slot.inUse && slot.isInput) raw = slot.lines[slot.pos++] ?? '';
        else err('FILE NOT OPEN');
        this.assignScalar(st.name, st.isStr, mkStr(raw));
        return;
      }
      case 'DIM': {
        for (const it of st.items) {
          let d1 = 10, d2 = -1;
          if (it.d1) d1 = Math.floor(this.evalExpr(it.d1).num);
          if (it.d2) d2 = Math.floor(this.evalExpr(it.d2).num);
          this.dimArray(it.name, it.isStr, d1, d2);
        }
        return;
      }
      case 'READ': {
        for (const t of st.targets) {
          if (this.dataPtr >= this.dataVals.length) err('OUT OF DATA');
          let v = this.dataVals[this.dataPtr++];
          v = this.coerceDataValue(v, t.isStr);
          if (t.idx1) {
            const i1 = Math.floor(this.evalExpr(t.idx1).num);
            const i2 = t.idx2 ? Math.floor(this.evalExpr(t.idx2).num) : -1;
            this.assignArrayElem(t.name, t.isStr, i1, i2, v);
          } else {
            this.assignScalar(t.name, t.isStr, v);
          }
        }
        return;
      }
      case 'RESTORE': {
        if (st.expr) {
          const target = Math.floor(this.evalExpr(st.expr).num);
          let i = 0; while (i < this.dataLineOf.length && this.dataLineOf[i] < target) i++;
          this.dataPtr = i;
        } else this.dataPtr = 0;
        return;
      }
      case 'GOTO': case 'GOSUB': case 'GOTODYN': case 'GOSUBDYN':
        // no-ops inside DEFN bodies (matches the Oberon compiler's behavior
        // for bare/dynamic line-number jumps compiled with compInFunc set)
        return;
      case 'GOSUBRETURN': err('RETURN WITHOUT GOSUB'); return;
      case 'ON': return;
      case 'FOR': {
        const from = this.evalExpr(st.fromExpr).num;
        const limit = this.evalExpr(st.toExpr).num;
        const step = this.evalExpr(st.stepExpr).num;
        if (this.forStack.length >= MAX_FOR_STACK) { err('FOR TOO DEEP'); return; }
        this.setNum(st.name, from);
        this.forStack.push({ varName: st.name, limit, step, loopArr: arr, loopPc: pc + 1 });
        return;
      }
      case 'NEXT': {
        if (this.forStack.length === 0) { err('NEXT WITHOUT FOR'); return; }
        const f = this.forStack[this.forStack.length - 1];
        this.setNum(f.varName, this.getNum(f.varName) + f.step);
        const v = this.getNum(f.varName);
        const cont = f.step >= 0 ? v <= f.limit + 1e-9 : v >= f.limit - 1e-9;
        if (cont) return { arr: f.loopArr, pc: f.loopPc };
        this.forStack.pop();
        return;
      }
      case 'JUMPFALSE': {
        const v = this.evalExpr(st.cond);
        if (!truthy(v)) return { arr, pc: st.target };
        return;
      }
      case 'JUMP': return { arr, pc: st.target };
      case 'END': return { arr, pc: arr.length };
      case 'CLS': host.cls && host.cls(); return;
      case 'LOCATE': {
        const row = Math.floor(this.evalExpr(st.rowExpr).num);
        const col = st.colExpr ? Math.floor(this.evalExpr(st.colExpr).num) : 1;
        host.locate && host.locate(row, col);
        return;
      }
      case 'RANDOMIZE': {
        if (st.expr) this.rng = mulberry32(Math.floor(this.evalExpr(st.expr).num) >>> 0);
        else this.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
        return;
      }
      case 'SCREEN': {
        const w = Math.floor(this.evalExpr(st.wExpr).num);
        const h = st.hExpr ? Math.floor(this.evalExpr(st.hExpr).num) : 480;
        host.ensureGfx && host.ensureGfx(w, h);
        return;
      }
      case 'COLOR': {
        const fg = Math.floor(this.evalExpr(st.fgExpr).num);
        const bg = st.bgExpr ? Math.floor(this.evalExpr(st.bgExpr).num) : null;
        host.color && host.color(fg, bg);
        return;
      }
      case 'PSET': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.pset && host.pset(x, y, c);
        return;
      }
      case 'DRAWLINE': {
        const x1 = Math.floor(this.evalExpr(st.x1).num), y1 = Math.floor(this.evalExpr(st.y1).num);
        const x2 = Math.floor(this.evalExpr(st.x2).num), y2 = Math.floor(this.evalExpr(st.y2).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.line && host.line(x1, y1, x2, y2, c);
        return;
      }
      case 'CIRCLE': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const r = this.evalExpr(st.rExpr).num;
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.circle && host.circle(x, y, r, c, st.filled);
        return;
      }
      case 'RECT': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const w = Math.floor(this.evalExpr(st.wExpr).num), h = Math.floor(this.evalExpr(st.hExpr).num);
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.rect && host.rect(x, y, w, h, c, st.filled);
        return;
      }
      case 'TEXT': {
        const x = Math.floor(this.evalExpr(st.xExpr).num), y = Math.floor(this.evalExpr(st.yExpr).num);
        const v = this.evalExpr(st.sExpr);
        const s = v.isStr ? v.s : numToStr(v.num);
        const sz = st.szExpr ? Math.floor(this.evalExpr(st.szExpr).num) : 20;
        const c = st.cExpr ? Math.floor(this.evalExpr(st.cExpr).num) : null;
        host.text && host.text(x, y, s, sz, c);
        return;
      }
      default:
        err('SYNTAX ERROR');
    }
  }
}
