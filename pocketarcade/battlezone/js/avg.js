'use strict';

// Atari AVG (Analog Vector Generator), Battlezone variant — the vector-
// drawing coprocessor that walks a 6502-built display list in vector RAM
// ($2000-$2fff) plus fixed shapes in vector ROM ($3000-$3fff) and paints it
// to the vector monitor. Unlike Asteroids/Lunar Lander's DVG (a purely
// digital bit-rate-multiplier beam stepper), AVG drives the beam with an
// analog integrator: each vector instruction just says "run the X/Y DACs
// for N clock pulses", and the beam position is the running sum of those
// pulses — so a vector's length falls out of *how long* the strobe runs
// (via a shift-register "timer" built up by a normalization step) rather
// than an explicit distance field. Battlezone also adds dedicated clip-
// window hardware (the HST/LST latches below) that lets the display list
// cut vectors to a rectangle on the fly — that's what hides the distant
// mountains' vectors behind the scope bezel and the horizon.
//
// Same state-machine-PROM approach as this repo's dvg.js: real hardware
// drives an 8-state cycle per vector instruction off a 256x4 PROM (the same
// chip dumped in the ROM set, 036408-01.k7); we run that same state
// machine so instruction decoding matches hardware exactly, but each run()
// executes an entire display list synchronously instead of pacing it
// against a wall-clock timer. Independent reimplementation of the publicly
// documented hardware (MAME's src/devices/video/avgdvg.cpp avg_device and
// avg_bzone_device), not a code port.
//
// One documented simplification: `xpos`/`ypos` are plain JS numbers, not
// wraparound 32-bit integers like the real s32 registers. Real gameplay
// never drives the beam integrator anywhere near a 32-bit overflow (it's
// re-centered every frame), so this never observably differs.
class AVG {
  constructor(mem, membase) {
    this.mem = mem;
    this.membase = membase;
    this.prom = null;

    // Fixed geometry from bzone's VECTOR/AVG_BZONE machine config
    // (set_visarea(0, 580, 0, 400)) — set once, like real device_start().
    this.xcenter = 290 * 65536;
    this.ycenter = 200 * 65536;
    this.xdacXor = 0x200;
    this.ydacXor = 0x200;

    this.reset();
  }

  loadProm(bytes) { this.prom = bytes; }

  // Full power-on reset. hst/lst/clip/xpos/ypos/color/intensity are real
  // hardware latches that persist across frames (go()) and even across
  // mid-game resetStrobe() calls on real hardware — only cleared here, at
  // construction/machine-reset time.
  reset() {
    this.pc = 0; this.sp = 0;
    this.stack = [0, 0, 0, 0];
    this.dvx = 0; this.dvy = 0; this.dvy12 = 0;
    this.op = 0;
    this.intLatch = 0;
    this.timer = 0;
    this.scale = 0; this.binScale = 0;
    this.intensity = 0;
    this.color = 0;
    this.stateLatch = 0;
    this.halt = 1;
    this.xpos = 0; this.ypos = 0;
    this.hst = 0; this.lst = 0; this.izblank = 0;
    this.clipxMin = 0; this.clipyMin = 0; this.clipxMax = 0; this.clipyMax = 0;
    this.buf = [];
    this.segments = [];
    this.busyCpuCycles = 0;
  }

  // Triggered by a 6502 write to $1600 (avg reset_w): re-arm the state
  // machine and halt it, but — matching hardware — leave the beam position
  // and clip-window latches alone.
  resetStrobe() {
    this.stateLatch = 0;
    this.binScale = 0;
    this.scale = 0;
    this.color = 0;
    this.halt = 1;
  }

  stateAddr() {
    return ((((this.stateLatch >> 4) ^ 1) << 7) | (this.op << 4) | (this.stateLatch & 0xF)) & 0xFF;
  }

  addPoint(x, y, intensity) { this.buf.push({ v: true, x, y, intensity }); }
  addClip(xmin, ymin, xmax, ymax) { this.buf.push({ v: false, x: xmin, y: ymin, x1: xmax, y1: ymax }); }

  // latch0: low byte of DVY
  h0(data) { this.dvy = (this.dvy & 0x1F00) | data; this.pc = (this.pc + 1) & 0xFFFF; return 0; }

  // latch1: opcode + high nibble of DVY. Battlezone splices its clip-window
  // bookkeeping in here — it runs once per vector instruction, tracking the
  // beam position at the moment HST/LST last turned off.
  h1(data) {
    if (!this.hst) { this.clipxMax = this.xpos; this.clipyMin = this.ypos; }
    if (!this.lst) { this.clipxMin = this.xpos; this.clipyMax = this.ypos; }
    if (!this.lst || !this.hst) this.addClip(this.clipxMin, this.clipyMin, this.clipxMax, this.clipyMax);
    this.lst = this.hst = 1;

    this.dvy12 = (data >> 4) & 1;
    this.op = data >> 5;
    this.intLatch = 0;
    this.dvy = (this.dvy12 << 12) | ((data & 0xF) << 8);
    this.dvx = 0;
    this.pc = (this.pc + 1) & 0xFFFF;
    return 0;
  }

  // latch2: low byte of DVX
  h2(data) { this.dvx = (this.dvx & 0x1F00) | data; this.pc = (this.pc + 1) & 0xFFFF; return 0; }

  // latch3: intensity/CNTR-select nibble + high nibble of DVX
  h3(data) {
    this.intLatch = data >> 4;
    this.dvx = ((this.intLatch & 1) << 12) | ((data & 0xF) << 8) | (this.dvx & 0xFF);
    this.pc = (this.pc + 1) & 0xFFFF;
    return 0;
  }

  // strobe0: JSRL push, or beam-vector normalization (shifts DVX/DVY left
  // together until one hits full scale, building up `timer` — a shift
  // register that ends up encoding how long strobe3 should run the DACs).
  h4() {
    const op0 = this.op & 1, op1 = (this.op >> 1) & 1;
    if (op0) {
      this.stack[this.sp & 3] = this.pc;
    } else {
      let i = 0;
      while ((((this.dvy ^ (this.dvy << 1)) & 0x1000) === 0)
          && (((this.dvx ^ (this.dvx << 1)) & 0x1000) === 0)
          && (i++ < 16)) {
        this.dvy = (this.dvy & 0x1000) | ((this.dvy << 1) & 0x1FFF);
        this.dvx = (this.dvx & 0x1000) | ((this.dvx << 1) & 0x1FFF);
        this.timer = (this.timer >>> 1) & 0xFFFF;
        this.timer |= 0x4000 | (op1 << 7);
      }
      if (op1) this.timer &= 0xFF;
    }
    return 0;
  }

  // strobe1: SCALE latch, further folded into `timer`; or JSRL/RTSL stack pointer move.
  h5() {
    const op1 = (this.op >> 1) & 1, op2 = (this.op >> 2) & 1;
    if (!op2) {
      for (let i = this.binScale; i > 0; i--) {
        this.timer = (this.timer >>> 1) & 0xFFFF;
        this.timer |= 0x4000 | (op1 << 7);
      }
      if (op1) this.timer &= 0xFF;
    }
    return this.commonStrobe1();
  }
  commonStrobe1() {
    const op1 = (this.op >> 1) & 1, op2 = (this.op >> 2) & 1;
    if (op2) {
      if (op1) this.sp = (this.sp - 1) & 0xF;
      else this.sp = (this.sp + 1) & 0xF;
    }
    return 0;
  }

  // strobe2, Battlezone flavor: latches intensity and (unless masked off)
  // the HST/LST clip-window enable bits; or JMPL/RTSL; or latches SCALE.
  h6() {
    const op2 = (this.op >> 2) & 1;
    if (!op2 && !this.dvy12) {
      this.intensity = (this.dvy >> 4) & 0xF;
      if (!(this.dvy & 0x400)) {
        this.lst = this.dvy & 0x200;
        this.hst = this.lst ^ 0x200;
        this.izblank = this.dvy & 0x100;
      }
    }
    return this.commonStrobe2();
  }
  commonStrobe2() {
    const op0 = this.op & 1, op2 = (this.op >> 2) & 1;
    if (op2) {
      if (op0) this.pc = (this.dvy << 1) & 0xFFFF;
      else this.pc = this.stack[this.sp & 3];
    } else if (this.dvy12) {
      this.scale = this.dvy & 0xFF;
      this.binScale = (this.dvy >> 8) & 7;
    }
    return 0;
  }

  // strobe3, Battlezone flavor (monochrome — always full color): runs the
  // X/Y DAC integrators for the cycle count `timer` built up above, or
  // (CNTR) recenters the beam. HALT is decoded here too.
  h7() {
    const cycles = this.commonStrobe3();
    const op0 = this.op & 1, op2 = (this.op >> 2) & 1;
    if (!op0 && !op2) {
      this.addPoint(this.xpos, this.ypos, ((this.intLatch >> 1) === 1) ? this.intensity : (this.intLatch & 0xE));
    }
    return cycles;
  }
  commonStrobe3() {
    const op0 = this.op & 1, op1 = (this.op >> 1) & 1, op2 = (this.op >> 2) & 1;
    this.halt = op0;
    let cycles = 0;
    if (!op0 && !op2) {
      cycles = op1 ? (0x100 - (this.timer & 0xFF)) : (0x8000 - this.timer);
      this.timer = 0;

      const scaleFactor = this.scale ^ 0xFF;
      const xVal = (((this.dvx >> 3) ^ this.xdacXor) - 0x200) * cycles * scaleFactor;
      const yVal = (((this.dvy >> 3) ^ this.ydacXor) - 0x200) * cycles * scaleFactor;
      // >> forces the (possibly >32-bit) double product through ToInt32
      // first, matching the real 32-bit int overflow the C++ reference
      // relies on here.
      this.xpos += xVal >> 4;
      this.ypos -= yVal >> 4;
    }
    if (op2) {
      cycles = 0x8000 - this.timer;
      this.timer = 0;
      this.xpos = this.xcenter;
      this.ypos = this.ycenter;
      this.addPoint(this.xpos, this.ypos, 0);
    }
    return cycles;
  }

  // Walk the buffered point/clip stream into final on-screen line segments,
  // applying Battlezone's dynamic clip-window rectangle exactly as the
  // hardware's vg_flush does: each vector is clipped against whichever
  // window was most recently pushed by a `addClip` (state persists across
  // vectors until the next clip entry), and the window itself defaults to
  // "no clipping" (an enormous rectangle) until the display list sets one.
  flush() {
    const buf = this.buf;
    let cx0 = 0, cy0 = 0, cx1 = 0x5000000, cy1 = 0x5000000;
    let i = 0;
    while (i < buf.length && !buf[i].v) i++;
    let xs = i < buf.length ? buf[i].x : 0;
    let ys = i < buf.length ? buf[i].y : 0;
    const out = [];
    for (i = 0; i < buf.length; i++) {
      const e = buf[i];
      if (e.v) {
        let x0 = xs, y0 = ys, x1 = e.x, y1 = e.y;
        xs = e.x; ys = e.y;
        if ((x0 < cx0 && x1 < cx0) || (x0 > cx1 && x1 > cx1)) continue;
        if (x0 < cx0) { y0 += (cx0 - x0) * (y1 - y0) / (x1 - x0); x0 = cx0; }
        else if (x0 > cx1) { y0 += (cx1 - x0) * (y1 - y0) / (x1 - x0); x0 = cx1; }
        if (x1 < cx0) { y1 += (cx0 - x1) * (y1 - y0) / (x1 - x0); x1 = cx0; }
        else if (x1 > cx1) { y1 += (cx1 - x1) * (y1 - y0) / (x1 - x0); x1 = cx1; }
        if ((y0 < cy0 && y1 < cy0) || (y0 > cy1 && y1 > cy1)) continue;
        if (y0 < cy0) { x0 += (cy0 - y0) * (x1 - x0) / (y1 - y0); y0 = cy0; }
        else if (y0 > cy1) { x0 += (cy1 - y0) * (x1 - x0) / (y1 - y0); y0 = cy1; }
        if (y1 < cy0) { x1 += (cy0 - y1) * (x1 - x0) / (y1 - y0); y1 = cy0; }
        else if (y1 > cy1) { x1 += (cy1 - y1) * (x1 - x0) / (y1 - y0); y1 = cy1; }
        if (e.intensity > 0) out.push(x0 / 65536, y0 / 65536, x1 / 65536, y1 / 65536, e.intensity);
      } else {
        cx0 = e.x; cy0 = e.y; cx1 = e.x1; cy1 = e.y1;
        if (cx0 > cx1) { const t = cx0; cx0 = cx1; cx1 = t; }
        if (cy0 > cy1) { const t = cy0; cy0 = cy1; cy1 = t; }
      }
    }
    this.segments = out;
  }

  // Triggered by a 6502 write to $1200 (avg go_w). Runs the whole display
  // list synchronously, exactly like this repo's dvg.js — real hardware
  // runs this against a wall clock, but nothing observes the vector RAM in
  // between, so collapsing it to "run to halt, then flush" is equivalent.
  go() {
    this.pc = 0; this.sp = 0; this.halt = 0;
    this.buf = [];
    let masterCycles = 0;
    let steps = 0;
    while (!this.halt && steps++ < 20000) {
      this.stateLatch = (this.stateLatch & 0x10) | (this.prom[this.stateAddr()] & 0xF);
      if (this.stateLatch & 8) {
        const data = this.mem[(this.membase + (this.pc ^ 1)) & 0x7FFF];
        switch (this.stateLatch & 7) {
          case 0: masterCycles += this.h0(data); break;
          case 1: masterCycles += this.h1(data); break;
          case 2: masterCycles += this.h2(data); break;
          case 3: masterCycles += this.h3(data); break;
          case 4: masterCycles += this.h4(); break;
          case 5: masterCycles += this.h5(); break;
          case 6: masterCycles += this.h6(); break;
          case 7: masterCycles += this.h7(); break;
        }
      }
      this.stateLatch = (this.halt << 4) | (this.stateLatch & 0xF);
      masterCycles += 8;
    }
    this.flush();
    // AVG runs off the 12.096MHz master clock; the 6502 runs at master/8.
    this.busyCpuCycles = Math.ceil(masterCycles / 8);
  }
}
