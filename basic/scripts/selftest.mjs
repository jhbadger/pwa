#!/usr/bin/env node
// Headless correctness check for the BASIC interpreter — not shipped to the
// app, dev-only. Runs a handful of programs through a fake host (in-memory
// screen + virtual filesystem) and asserts on captured output.

import { BasicInterpreter } from '../js/basic.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}`);
    console.log(`  got:      ${JSON.stringify(actual)}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function makeHost(files) {
  const events = [];
  let out = '';
  const host = {
    print(s) { out += s; },
    async inputLine() { return ''; },
    async sound(f, ms) { events.push(`SOUND ${f} ${ms}`); },
    async beep() { events.push('BEEP'); },
    async delay(ms) { events.push(`DELAY ${ms}`); },
    fs: {
      async readFile(n) { return files.has(n) ? files.get(n) : null; },
      async writeFile(n, t) { files.set(n, t); },
      async list() { return [...files.keys()]; },
    },
  };
  return { host, events, get out() { return out; } };
}

async function run(prog, files = new Map()) {
  const ctx = makeHost(files);
  const interp = new BasicInterpreter(ctx.host);
  interp.loadProgramText(prog);
  await interp.runProgram();
  return ctx.out;
}

// ---------- core control flow ----------

check('PRINT / FOR / IF-ELSE', await run(`
10 PRINT "HELLO"
20 FOR I = 1 TO 5
30 IF I = 3 THEN PRINT "THREE!" ELSE PRINT I
40 NEXT I
50 PRINT "DONE"
`), 'HELLO\n1\n2\nTHREE!\n4\n5\nDONE\n');

check('GOSUB/RETURN + DATA/READ', await run(`
10 GOSUB 100
20 FOR I = 1 TO 3
30 READ A$, B
40 PRINT A$; " = "; B
50 NEXT I
60 END
100 PRINT "starting"
110 RETURN
200 DATA "x", 1, "y", 2, "z", 3
`), 'starting\nx = 1\ny = 2\nz = 3\n');

check('DEFN recursion (fibonacci)', await run(`
10 DEFN FIB(N)
20   IF N < 2 THEN RETURN N
30   RETURN FIB(N-1) + FIB(N-2)
40 ENDFN
50 FOR I = 0 TO 9
60   PRINT FIB(I);
70 NEXT I
`), '0112358132134');

check('WHILE/WEND + string functions', await run(`
10 S$ = "banana"
20 I = 1
30 WHILE I <= LEN(S$)
40   PRINT MID$(S$, I, 1);
50   I = I + 1
60 WEND
`), 'banana');

check('2D arrays + ON GOTO', await run(`
10 DIM A(2,2)
20 FOR I = 0 TO 2
30 FOR J = 0 TO 2
40 A(I,J) = I*10+J
50 NEXT J
60 NEXT I
70 PRINT A(1,2); A(2,2)
80 X = 2
90 ON X GOTO 100,110,120
100 PRINT "one" : GOTO 130
110 PRINT "two" : GOTO 130
120 PRINT "three"
130 PRINT "after"
`), '1222\ntwo\nafter\n');

// ---------- errors ----------

check('type mismatch reports line number', await run(`10 A = "x" + 1`), '\n?TYPE MISMATCH ERROR IN 10\n');
check('undefined line GOTO', await run(`10 GOTO 999`), '\n?UNDEFINED LINE ERROR IN 10\n');
// A compile error is caught before any line runs (compile is a whole-program
// pass ahead of execution), so line 10's PRINT never actually fires.
check('compile error reports correct line', await run(`
10 PRINT "ok"
20 PRINT (
30 END
`), '\n?SYNTAX ERROR ERROR IN 20\n');

// ---------- immediate mode / GOTO into stored program ----------

{
  const files = new Map();
  const ctx = makeHost(files);
  const interp = new BasicInterpreter(ctx.host);
  interp.loadProgramText('10 PRINT "line10"\n20 PRINT "line20"\n30 END');
  await interp.runImmediate('GOTO 20');
  check('immediate-mode GOTO jumps into stored program', ctx.out, 'line20\n');
}

// ---------- file I/O (virtual filesystem) ----------

{
  const files = new Map();
  const out = await run(`
10 OPEN "test.txt" FOR OUTPUT AS #1
20 PRINT #1, "line one"
30 PRINT #1, "line two"
40 CLOSE #1
50 OPEN "test.txt" FOR INPUT AS #2
60 WHILE NOT EOF(2)
70   LINE INPUT #2, L$
80   PRINT "GOT: "; L$
90 WEND
100 CLOSE #2
`, files);
  check('file OPEN/PRINT#/LINE INPUT# round-trip', out, 'GOT: line one\nGOT: line two\n');
  check('virtual file contents', files.get('test.txt'), 'line one\nline two\n');
}

// ---------- PRINT column formatting ----------

check('comma zones + TAB + trailing suppress', await run(`
10 PRINT "A", "B"
20 PRINT TAB(5); "X"
30 PRINT "no newline",
40 PRINT "next"
`), 'A             B\n     X\nno newline    next\n');

// ---------- RANDOMIZE determinism ----------

{
  const a = await run('10 RANDOMIZE 42 : PRINT RND; RND; RND');
  const b = await run('10 RANDOMIZE 42 : PRINT RND; RND; RND');
  check('RANDOMIZE n is reproducible', a === b && a.length > 0, true);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('\nall selftests passed');
}
