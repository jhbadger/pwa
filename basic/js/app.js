import { BasicInterpreter, expandQuestionMarks } from './basic.js';

// ------------------------------------------------------------------ dom refs

const screenEl = document.getElementById('screen');
const inputEl = document.getElementById('cmdline');
const promptEl = document.getElementById('prompt');
const gfxWrap = document.getElementById('gfxWrap');
const gfxCanvas = document.getElementById('gfx');
const gfx = gfxCanvas.getContext('2d');
const stopBtn = document.getElementById('btnStop');
const toast = document.getElementById('toast');

// classic 16-color EGA/CGA palette, indices 0-15 (COLOR fg,bg / PSET,c / ...)
const PALETTE = [
  '#000000', '#0000AA', '#00AA00', '#00AAAA',
  '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF',
  '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
];
function colorOf(ix) { if (ix === null || ix === undefined) return null; return PALETTE[Math.max(0, Math.min(15, ix))]; }

// ------------------------------------------------------------------ terminal

function writeScreen(s) {
  screenEl.textContent += s;
  screenEl.scrollTop = screenEl.scrollHeight;
}

function scrollToBottom() { screenEl.scrollTop = screenEl.scrollHeight; }

// ------------------------------------------------------------- virtual fs
//
// A flat namespace of text "files" backed by localStorage, standing in for
// the Oberon runtime's real filesystem (OPEN/CLOSE/PRINT#/INPUT#/LOAD/SAVE
// all go through this). Keys are prefixed so they don't collide with the
// autosave slot below.

const FS_PREFIX = 'basic:fs:';

const vfs = {
  async readFile(name) {
    const v = localStorage.getItem(FS_PREFIX + name);
    return v === null ? null : v;
  },
  async writeFile(name, text) {
    try { localStorage.setItem(FS_PREFIX + name, text); }
    catch { throw new Error('STORAGE FULL'); }
  },
  async list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FS_PREFIX)) out.push(k.slice(FS_PREFIX.length));
    }
    return out.sort();
  },
  async deleteFile(name) {
    const key = FS_PREFIX + name;
    const existed = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    return existed;
  },
};

const AUTOSAVE_KEY = 'basic:autosave';
function autosave(interp) {
  try { localStorage.setItem(AUTOSAVE_KEY, interp.programText()); } catch { /* ignore quota errors */ }
}

// -------------------------------------------------------------- graphics host

let gfxOpen = false;
let curColorIx = 15;
let bgColorIx = 0;
let mouseX = 0, mouseY = 0, mouseDown = false;
const keyQueue = [];

function ensureGfx(w, h) {
  if (!gfxOpen) {
    gfxCanvas.width = w; gfxCanvas.height = h;
    gfx.fillStyle = PALETTE[bgColorIx];
    gfx.fillRect(0, 0, w, h);
    gfxWrap.hidden = false;
    gfxOpen = true;
  } else if (gfxCanvas.width !== w || gfxCanvas.height !== h) {
    gfxCanvas.width = w; gfxCanvas.height = h;
    gfx.fillStyle = PALETTE[bgColorIx];
    gfx.fillRect(0, 0, w, h);
  }
}

gfxCanvas.addEventListener('mousemove', (e) => {
  const r = gfxCanvas.getBoundingClientRect();
  mouseX = Math.round((e.clientX - r.left) * (gfxCanvas.width / r.width));
  mouseY = Math.round((e.clientY - r.top) * (gfxCanvas.height / r.height));
});
gfxCanvas.addEventListener('mousedown', () => { mouseDown = true; });
window.addEventListener('mouseup', () => { mouseDown = false; });
gfxCanvas.addEventListener('touchmove', (e) => {
  const t = e.touches[0]; if (!t) return;
  const r = gfxCanvas.getBoundingClientRect();
  mouseX = Math.round((t.clientX - r.left) * (gfxCanvas.width / r.width));
  mouseY = Math.round((t.clientY - r.top) * (gfxCanvas.height / r.height));
}, { passive: true });
gfxCanvas.addEventListener('touchstart', () => { mouseDown = true; }, { passive: true });
gfxCanvas.addEventListener('touchend', () => { mouseDown = false; }, { passive: true });

gfxCanvas.tabIndex = 0;
gfxCanvas.addEventListener('keydown', (e) => {
  const map = { Enter: 13, Backspace: 8, ' ': 32, Escape: 27, ArrowUp: 200, ArrowDown: 201, ArrowLeft: 202, ArrowRight: 203 };
  if (map[e.key] !== undefined) { keyQueue.push(map[e.key]); e.preventDefault(); }
  else if (e.key.length === 1) { keyQueue.push(e.key.charCodeAt(0)); }
});

const host = {
  print: writeScreen,

  async inputLine(prompt) {
    return requestLine(prompt, true);
  },

  cls() {
    if (gfxOpen) { gfx.fillStyle = PALETTE[bgColorIx]; gfx.fillRect(0, 0, gfxCanvas.width, gfxCanvas.height); }
    else { screenEl.textContent = ''; }
  },

  locate() { /* terminal cursor positioning has no meaningful equivalent in a scrollback pane; no-op */ },

  ensureGfx,

  color(fg, bg) {
    curColorIx = fg;
    if (bg !== null && bg !== undefined) bgColorIx = bg;
  },

  pset(x, y, c) {
    ensureGfx(gfxCanvas.width || 640, gfxCanvas.height || 480);
    gfx.fillStyle = colorOf(c !== null ? c : curColorIx);
    gfx.fillRect(x, y, 1, 1);
  },

  line(x1, y1, x2, y2, c) {
    ensureGfx(gfxCanvas.width || 640, gfxCanvas.height || 480);
    gfx.strokeStyle = colorOf(c !== null ? c : curColorIx);
    gfx.lineWidth = 1;
    gfx.beginPath(); gfx.moveTo(x1 + 0.5, y1 + 0.5); gfx.lineTo(x2 + 0.5, y2 + 0.5); gfx.stroke();
  },

  circle(x, y, r, c, filled) {
    ensureGfx(gfxCanvas.width || 640, gfxCanvas.height || 480);
    gfx.beginPath(); gfx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    if (filled) { gfx.fillStyle = colorOf(c !== null ? c : curColorIx); gfx.fill(); }
    else { gfx.strokeStyle = colorOf(c !== null ? c : curColorIx); gfx.lineWidth = 1; gfx.stroke(); }
  },

  rect(x, y, w, h, c, filled) {
    ensureGfx(gfxCanvas.width || 640, gfxCanvas.height || 480);
    if (filled) { gfx.fillStyle = colorOf(c !== null ? c : curColorIx); gfx.fillRect(x, y, w, h); }
    else { gfx.strokeStyle = colorOf(c !== null ? c : curColorIx); gfx.lineWidth = 1; gfx.strokeRect(x + 0.5, y + 0.5, w, h); }
  },

  text(x, y, s, sz, c) {
    ensureGfx(gfxCanvas.width || 640, gfxCanvas.height || 480);
    gfx.fillStyle = colorOf(c !== null ? c : curColorIx);
    gfx.font = `${sz}px "Courier New", monospace`;
    gfx.textBaseline = 'top';
    gfx.fillText(s, x, y);
  },

  async sound(freq, ms) { await playTone(freq, ms); },
  async beep() { await playTone(800, 150); },
  async delay(ms) { await new Promise((r) => setTimeout(r, ms)); },

  inkey() { return keyQueue.length ? String.fromCharCode(keyQueue.shift()) : ''; },
  scrw() { return gfxCanvas.width || 640; },
  scrh() { return gfxCanvas.height || 480; },
  mousex() { return mouseX; },
  mousey() { return mouseY; },
  mouseb() { return mouseDown; },

  fs: vfs,
};

// --------------------------------------------------------------- web audio

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq, ms) {
  return new Promise((resolve) => {
    if (ms <= 0 || !(freq > 0)) { resolve(); return; }
    try {
      const ctx = ensureAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
      osc.onended = () => resolve();
    } catch {
      setTimeout(resolve, ms);
    }
  });
}

// ------------------------------------------------------------- input line

// The single input line is shared between the REPL prompt ("> "), multi-line
// DEFN capture (". "), and BASIC's own INPUT/LINE INPUT statements (whatever
// prompt the program supplied) — only one of them is ever waiting on it.
let pendingResolve = null;
let pendingIsProgramInput = false;
let history = [];
let historyPos = 0;

function requestLine(prompt, isProgramInput = false) {
  promptEl.textContent = prompt;
  inputEl.disabled = false;
  inputEl.focus();
  pendingIsProgramInput = isProgramInput;
  return new Promise((resolve) => { pendingResolve = resolve; });
}

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = inputEl.value;
    inputEl.value = '';
    if (pendingResolve) {
      const r = pendingResolve; pendingResolve = null;
      writeScreen(promptEl.textContent + val + '\n');
      if (val.trim().length > 0) { history.push(val); historyPos = history.length; }
      r(val);
    }
  } else if (e.key === 'ArrowUp') {
    if (historyPos > 0) { historyPos--; inputEl.value = history[historyPos] || ''; }
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (historyPos < history.length) {
      historyPos++;
      inputEl.value = history[historyPos] || '';
    }
    e.preventDefault();
  } else if (e.key === 'Escape') {
    // Stop() alone only takes effect at the next periodic check inside the
    // interpreter's run loop, which never happens while it's blocked
    // awaiting this very input (an INPUT/LINE INPUT statement) — so also
    // resolve that wait directly with null, which basic.js treats as an
    // abort request.
    interp.stop();
    if (pendingIsProgramInput && pendingResolve) {
      const r = pendingResolve; pendingResolve = null;
      inputEl.value = '';
      r(null);
    }
  }
});

// ----------------------------------------------------------------- REPL

const interp = new BasicInterpreter(host);

function banner() {
  writeScreen('BASIC -- canvas graphics & sound, terminal otherwise.\n');
  writeScreen('Type HELP for commands, HELP topic for details, BYE to quit.\n');
}

function doList() {
  for (const l of interp.listing()) writeScreen(l + '\n');
}

function showHelp() {
  writeScreen('Commands   : RUN  LIST  NEW  LOAD file  SAVE file  DELETE file  CLEAR  BYE\n');
  writeScreen('Statements : PRINT(?) INPUT LET IF/THEN/ELSE WHILE/WEND FOR/TO/STEP/NEXT\n');
  writeScreen('             GOTO GOSUB/RETURN ON..GOTO/GOSUB END STOP DIM DATA/READ/RESTORE\n');
  writeScreen('             CLS LOCATE DEFN/ENDFN (user functions)\n');
  writeScreen('Files      : OPEN/CLOSE PRINT# INPUT# LINE INPUT# EOF() FILES  (browser storage)\n');
  writeScreen('Graphics   : SCREEN COLOR PSET LINE CIRCLE FCIRCLE RECT FRECT TEXT\n');
  writeScreen('Sound      : SOUND BEEP DELAY\n');
  writeScreen('Type a numbered line to add/replace/delete it; anything else runs\n');
  writeScreen('immediately, e.g. PRINT 2+2 (or ? 2+2).\n');
  writeScreen('Type HELP topic for details on one item, e.g. HELP DEFN, HELP FUNCTIONS.\n');
  writeScreen('Up/Down arrows recall previous input lines.\n');
}

const HELP_TOPICS = {
  PRINT: 'PRINT expr[,expr|;expr]...        (also spelled: ? expr...)\nPRINT #n, expr[,expr|;expr]...    (writes one record to file #n)\n  \';\' joins with no space; \',\' pads to the next 14-column zone.\n  TAB(n) moves to column n. Ending in \',\' or \';\' suppresses the\n  trailing newline.',
  '?': 'Shorthand for PRINT — rewritten to PRINT wherever it appears.',
  INPUT: 'INPUT [prompt$;] var[,var]...      INPUT #n, var[,var]...\n  Reads a comma-separated line from the keyboard, or from open file #n.',
  LET: '[LET] var = expr          [LET] arr(i[,j]) = expr',
  IF: 'IF expr THEN stmt[:stmt...] [ELSE stmt[:stmt...]]\nIF expr THEN linenum [ELSE linenum]',
  THEN: 'See HELP IF.', ELSE: 'See HELP IF.',
  WHILE: 'WHILE expr ... WEND  (loops while expr is true; may span lines)', WEND: 'See HELP WHILE.',
  FOR: 'FOR var = start TO limit [STEP step] ... NEXT [var]',
  TO: 'See HELP FOR.', STEP: 'See HELP FOR.', NEXT: 'See HELP FOR.',
  GOTO: 'GOTO linenum',
  GOSUB: 'GOSUB linenum   ...   RETURN',
  RETURN: 'RETURN            (in a GOSUB, jumps back to the caller)\nRETURN [expr]     (inside DEFN..ENDFN, exits the function with a value)',
  ON: 'ON expr GOTO n1[,n2...]        ON expr GOSUB n1[,n2...]',
  END: 'END / STOP -- halt the program.', STOP: 'See HELP END.',
  DIM: 'DIM name(d1[,d2])[, ...]',
  DATA: 'DATA val[,...]      READ var[,...]      RESTORE [linenum]',
  READ: 'See HELP DATA.', RESTORE: 'See HELP DATA.',
  CLS: 'CLS / HOME -- clear the screen.', HOME: 'See HELP CLS.',
  LOCATE: 'LOCATE row[,col]  (no-op here — scrollback has no cursor to place)',
  RANDOMIZE: 'RANDOMIZE [expr]  (reseed RND)',
  SCREEN: 'SCREEN width[,height]  (open the graphics canvas)',
  COLOR: 'COLOR fg[,bg]  (0-15)',
  PSET: 'PSET x,y[,color]',
  LINE: 'LINE x1,y1,x2,y2[,color]\nLINE INPUT #n, var$    (reads one whole line, no comma-splitting)',
  CIRCLE: 'CIRCLE / FCIRCLE x,y,r[,color]', FCIRCLE: 'See HELP CIRCLE.',
  RECT: 'RECT / FRECT x,y,w,h[,color]', FRECT: 'See HELP RECT.',
  TEXT: 'TEXT x,y,expr[,size[,color]]',
  SOUND: 'SOUND freq,ms  (blocking tone)',
  BEEP: 'BEEP  (short 800Hz tone)',
  DELAY: 'DELAY ms',
  OPEN: 'OPEN name$ FOR INPUT|OUTPUT|APPEND AS #n   (n = 1..32, files live in browser storage)',
  CLOSE: 'CLOSE [#n[,#n...]]   (no args closes every open file)',
  EOF: 'EOF(n)  -- TRUE once file #n has no more lines to read',
  FILES: 'FILES ["*.ext"]  -- list files in browser storage',
  DEFN: 'DEFN name[$](p1[,p2,...])\n  <statements>\n  RETURN expr           (optional; falls through returns 0/"")\nENDFN\n\n  Defines a user function. Trailing $ in the name makes it a\n  string function; otherwise numeric. Parameters are locals; the\n  caller\'s scalars are saved and restored (arrays are global).\n  Call as an expression:  y = square(5)  or as a statement:\n  greet("world")  (return value, if any, is discarded).\n  SOUND/BEEP/DELAY/OPEN/CLOSE/FILES and keyboard INPUT are not\n  allowed inside a DEFN body (file INPUT/LINE INPUT are fine).\n  In a source file, body lines under DEFN may be unnumbered.\n  At the REPL, keep typing lines until ENDFN is entered.\n\nBuilt-in functions:\n  ABS INT SGN SQR SIN COS TAN ATN LOG EXP PI RND TIMER\n  LEN VAL ASC CHR$ STR$ LEFT$ RIGHT$ MID$ INSTR INKEY$ STRING$ SPACE$\n  SCRW SCRH MOUSEX MOUSEY MOUSEB EOF\n  Type HELP name for details on any one of these, e.g. HELP RND.',
  ENDFN: 'See HELP DEFN.', FUNCTION: 'See HELP DEFN.', FUNCTIONS: 'See HELP DEFN.',
  ABS: 'ABS(x)  -- absolute value',
  INT: 'INT(x)  -- largest integer <= x (floor, not truncation)',
  SGN: 'SGN(x)  -- -1, 0, or 1 for the sign of x',
  SQR: 'SQR(x)  -- square root',
  SIN: 'SIN(x) / COS(x) / TAN(x)  -- trig functions, x in radians', COS: 'See HELP SIN.', TAN: 'See HELP SIN.',
  ATN: 'ATN(x)  -- arctangent of x, result in radians',
  LOG: 'LOG(x)  -- natural logarithm',
  EXP: 'EXP(x)  -- e raised to the power x',
  PI: 'PI  -- 3.14159265...  (no arguments, no parens)',
  RND: 'RND  -- random number in [0,1)  (no arguments, no parens)\n  See also HELP RANDOMIZE to reseed the sequence.',
  TIMER: 'TIMER  -- seconds elapsed since the program started',
  LEN: 'LEN(s$)  -- number of characters in s$',
  VAL: 'VAL(s$)  -- numeric value of s$, e.g. VAL("3.5") = 3.5',
  ASC: 'ASC(s$)  -- ASCII code of the first character of s$',
  'CHR$': 'CHR$(n)  -- one-character string for ASCII code n',
  'STR$': 'STR$(x)  -- string representation of the number x',
  'LEFT$': 'LEFT$(s$,n)  -- leftmost n characters of s$',
  'RIGHT$': 'RIGHT$(s$,n)  -- rightmost n characters of s$',
  'MID$': 'MID$(s$,start[,len])  -- substring starting at start (1-based)',
  INSTR: 'INSTR([start,]s$,sub$)  -- 1-based position of sub$ in s$, 0 if not found',
  'INKEY$': 'INKEY$  -- one pending keypress as a 1-char string, or "" if none\n  (graphics canvas only; needs SCREEN first, and canvas must have focus)',
  'STRING$': 'STRING$(n,x)  -- n copies of a character: x is an ASCII code or a\n  string (its first character is repeated)',
  'SPACE$': 'SPACE$(n)  -- a string of n space characters',
  SCRW: 'SCRW / SCRH  -- graphics canvas width/height in pixels (no arguments)', SCRH: 'See HELP SCRW.',
  MOUSEX: 'MOUSEX / MOUSEY  -- mouse (or touch) position within the graphics canvas', MOUSEY: 'See HELP MOUSEX.',
  MOUSEB: 'MOUSEB  -- TRUE while the left mouse button (or a touch) is held down',
  RUN: 'RUN  (clears vars, scans DEFNs and DATA, runs from lowest line)',
  LIST: 'LIST  (show the stored program)',
  NEW: 'NEW  (erase program and variables)',
  CLEAR: 'CLEAR  (erase variables, keep program)',
  LOAD: 'LOAD file        SAVE file  (stored in browser storage)', SAVE: 'See HELP LOAD.',
  DELETE: 'DELETE file  -- removes a file from browser storage (see also FILES).\n  Aliases: KILL.', KILL: 'See HELP DELETE.',
  BYE: 'BYE / QUIT / EXIT / SYSTEM  (there is nothing to exit in a browser tab —\n  just close it, or type NEW to start fresh)',
  QUIT: 'See HELP BYE.', EXIT: 'See HELP BYE.', SYSTEM: 'See HELP BYE.',
};

function showHelpTopic(topic) {
  const t = HELP_TOPICS[topic];
  if (t) writeScreen(t + '\n');
  else writeScreen('No help for ' + topic + '. Type HELP for the topic list.\n');
}

async function readReplDefn(firstLine) {
  let autoNum = interp.nextAutoLine(60000);
  interp.insertLine(autoNum, firstLine); autoNum++;
  for (;;) {
    const line = (await requestLine('. ')).trim();
    if (line.length === 0) continue;
    const expanded = expandQuestionMarks(line);
    interp.insertLine(autoNum, expanded); autoNum++;
    if (/^ENDFN(?![A-Za-z0-9_$])/i.test(expanded.trim())) break;
  }
  autosave(interp);
}

async function handleLine(raw) {
  const line = raw.trim();
  if (line.length === 0) return;
  const m = line.match(/^(\d+)\s*(.*)$/);
  if (m) {
    const num = parseInt(m[1], 10);
    const rest = expandQuestionMarks(m[2].trim());
    interp.insertLine(num, rest);
    autosave(interp);
    return;
  }
  const sp = line.indexOf(' ');
  const cmd = (sp >= 0 ? line.slice(0, sp) : line).toUpperCase();
  const argStr = (sp >= 0 ? line.slice(sp + 1) : '').trim();

  if (cmd === 'RUN') { setRunning(true); try { await interp.runProgram(); } finally { setRunning(false); } }
  else if (cmd === 'LIST') { doList(); }
  else if (cmd === 'NEW') { interp.reset(true); autosave(interp); }
  else if (cmd === 'CLEAR') { interp.numVars.clear(); interp.strVars.clear(); interp.arrays.clear(); }
  else if (cmd === 'HELP') { if (argStr.length === 0) showHelp(); else showHelpTopic(argStr.toUpperCase()); }
  else if (cmd === 'BYE' || cmd === 'QUIT' || cmd === 'EXIT' || cmd === 'SYSTEM') {
    writeScreen('Nothing to exit in a browser tab -- close it, or type NEW to start fresh.\n');
  } else if (cmd === 'LOAD') {
    const name = stripQuotes(argStr);
    const text = await vfs.readFile(name);
    if (text === null) { writeScreen('CANNOT OPEN ' + name + '\n'); }
    else { interp.loadProgramText(text); autosave(interp); writeScreen('LOADED\n'); }
  } else if (cmd === 'SAVE') {
    const name = stripQuotes(argStr);
    try { await vfs.writeFile(name, interp.programText()); writeScreen('SAVED\n'); }
    catch { writeScreen('SAVE FAILED\n'); }
  } else if (cmd === 'DELETE' || cmd === 'KILL') {
    const name = stripQuotes(argStr);
    const existed = await vfs.deleteFile(name);
    writeScreen(existed ? 'DELETED\n' : 'CANNOT FIND ' + name + '\n');
  } else if (cmd === 'DEFN') {
    await readReplDefn(expandQuestionMarks(line));
  } else {
    setRunning(true);
    try { await interp.runImmediate(expandQuestionMarks(line)); }
    finally { setRunning(false); }
    autosave(interp);
  }
}

function stripQuotes(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

function setRunning(v) {
  stopBtn.hidden = !v;
}

async function main() {
  banner();
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved && saved.trim().length > 0) {
    interp.loadProgramText(saved);
    writeScreen('(restored previous session -- LIST to see it, NEW to clear)\n');
  }
  for (;;) {
    const raw = await requestLine('> ');
    try {
      await handleLine(raw);
    } catch (e) {
      writeScreen('?INTERNAL ERROR: ' + (e && e.message ? e.message : String(e)) + '\n');
    }
    scrollToBottom();
  }
}

stopBtn.addEventListener('click', () => interp.stop());

// -------------------------------------------------------------- toast + sw

function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('New version available -- tap to refresh');
        }
      });
    });
  }).catch(() => {});

  let currentController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const nextController = navigator.serviceWorker.controller;
    if (currentController && nextController && currentController.scriptURL === nextController.scriptURL) {
      // same worker script re-activated (a real update), not just a scope handover
      window.location.reload();
    }
    currentController = nextController;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r && r.update());
  });
  setInterval(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()), 60 * 60 * 1000);
}

toast.addEventListener('click', () => window.location.reload());

main();
