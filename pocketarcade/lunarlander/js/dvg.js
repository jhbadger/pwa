'use strict';

// Atari DVG (Digital Vector Generator) — the vector-drawing coprocessor used
// by both Asteroids and Asteroids Deluxe. The 6502 builds a display list in
// vector RAM ($4000-$47FF) each frame, referencing fixed shapes in the vector
// ROM above it, then strobes GO ($3000) to have the DVG walk the list and
// paint it to the vector monitor.
//
// Real hardware executes this as a byte-serial state machine clocked by a
// 256x4 PROM (the same "034602-01.c8" chip dumped in the ROM set) — each
// micro-step re-addresses the PROM with the previous state, the current
// instruction's opcode nibble, and the halt flag, and the PROM's answer
// says which of 8 latch/strobe actions to perform next. We run that same
// state machine (driven by the real PROM bytes) so the instruction decoding
// is exactly what the hardware does, but collapse the analog "bit-rate
// multiplier" beam-stepping for VCTR into its closed-form total distance —
// the multiplier is a deterministic pulse counter, so summing its output
// over the instruction's duration in one step gives the same endpoint the
// real beam would reach, without walking every micro-pulse.
class DVG {
  constructor(mem, membase) {
    this.mem = mem;
    this.membase = membase;
    this.prom = null;
    this.reset();
  }

  loadProm(bytes) { this.prom = bytes; }

  reset() {
    this.pc = 0;
    this.sp = 0;
    this.stack = [0, 0, 0, 0];
    this.dvx = 0; this.dvy = 0;
    this.op = 0;
    this.scale = 0;
    this.intensity = 0;
    this.stateLatch = 0;
    this.halt = 1;          // idle at power-on, matches machine_reset()'s vg_set_halt(1)
    this.xpos = 0; this.ypos = 0;
    this.segments = [];     // flat [x0,y0,x1,y1,intensity, ...] from the last completed list
    this.busyCpuCycles = 0; // how many 6502 cycles the last list took to "draw"
  }

  stateAddr() {
    let addr = ((((this.stateLatch >> 4) ^ 1) & 1) << 7) | (this.stateLatch & 0xF);
    if (this.op & 8) addr |= (this.op & 7) << 4;
    return addr & 0xFF;
  }

  drawTo(x, y, intensity, out) {
    // Hardware never buffers a point outside the valid 0-1023 window — it
    // just drops it, leaving the pen at the last valid point. Real hardware
    // steps the beam one unit at a time, so it only ever overshoots the
    // window by a hair and a "bit 10 set" test is enough to catch it; our
    // closed-form VCTR can jump the position by a large amount in one go,
    // which can land back inside the low bits' "looks valid" pattern while
    // still being wildly out of range (e.g. 2992, which has bit 10 clear).
    // A direct range check catches both cases and avoids drawing a
    // spurious line across the screen to the wrapped-around coordinate.
    if (x > 1023 || y > 1023) return;
    if (intensity > 0) out.push(this.penX, this.penY, x, y, intensity);
    this.penX = x; this.penY = y;
  }

  // JSRL push
  h0() {
    if (!(this.op & 1)) { this.sp = (this.sp + 1) & 0xF; this.stack[this.sp & 3] = this.pc; }
    return 0;
  }
  // RTSL / JMPL
  h1() {
    if (this.op & 1) { this.pc = this.stack[this.sp & 3]; this.sp = (this.sp - 1) & 0xF; }
    else this.pc = this.dvy;
    return 0;
  }
  // VCTR: draw a scaled vector to a new relative position. The beam moves
  // via two cascaded 7497 bit-rate multipliers (one per axis): over `fin`
  // clock pulses, each axis fires floor-ish pulse counts spaced as evenly
  // as the classic bit-reversal DDA algorithm allows — NOT simply
  // fin*rate/4096 (tried that as a closed form; it disagrees with the real
  // pulse schedule on the large majority of fin/rate pairs, since the
  // pulse *timing* within the window matters, not just the total count).
  // So this steps the same way hardware does. Worst case (fin=1024) is
  // ~12k cheap iterations — trivial for one instruction, one frame.
  h2(out) {
    let scale;
    if (this.op === 0xF) {
      scale = (this.scale +
        (((this.dvy & 0x800) >> 11) |
         (((this.dvx & 0x800) ^ 0x800) >> 10) |
         ((this.dvx & 0x800) >> 9))) & 0xF;
      this.dvy &= 0xF00;
      this.dvx &= 0xF00;
    } else {
      scale = (this.scale + this.op) & 0xF;
    }
    let fin = 0xFFF - (((2 << scale) & 0x7FF) ^ 0xFFF);
    const cycles = 8 * fin;
    const dx = (this.dvx & 0x400) ? -1 : 1;
    const dy = (this.dvy & 0x400) ? -1 : 1;
    const mx = (this.dvx << 2) & 0xFFF;
    const my = (this.dvy << 2) & 0xFFF;
    let c = 0;
    while (fin--) {
      let countx = 0, county = 0;
      for (let bit = 0; bit < 12; bit++) {
        if ((c & ((1 << (bit + 1)) - 1)) === ((1 << bit) - 1)) {
          if (mx & (1 << (11 - bit))) countx = 1;
          if (my & (1 << (11 - bit))) county = 1;
        }
      }
      c = (c + 1) & 0xFFF;

      // As soon as either axis crosses the valid/invalid boundary, finish
      // the vector up to that edge (or resume from it) instead of jumping
      // straight through — matching real hardware's beam-blanking.
      if (countx) {
        if (!(this.ypos & 0x400) && ((this.xpos ^ (this.xpos + dx)) & 0x400)) {
          if ((this.xpos + dx) & 0x400) this.drawTo(this.xpos, this.ypos, this.intensity, out);
          else this.drawTo((this.xpos + dx) & 0xFFF, this.ypos, 0, out);
        }
        this.xpos = (this.xpos + dx) & 0xFFF;
      }
      if (county) {
        if (!(this.xpos & 0x400) && ((this.ypos ^ (this.ypos + dy)) & 0x400)) {
          if (!(this.xpos & 0x400)) {
            if ((this.ypos + dy) & 0x400) this.drawTo(this.xpos, this.ypos, this.intensity, out);
            else this.drawTo(this.xpos, (this.ypos + dy) & 0xFFF, 0, out);
          }
        }
        this.ypos = (this.ypos + dy) & 0xFFF;
      }
    }
    this.drawTo(this.xpos, this.ypos, this.intensity, out);
    return cycles;
  }
  // HALT / absolute reposition (LABS-style), selected by opcode bit 0
  h3(out) {
    this.halt = this.op & 1;
    if (!(this.op & 1)) {
      this.xpos = this.dvx & 0xFFF;
      this.ypos = this.dvy & 0xFFF;
      this.drawTo(this.xpos, this.ypos, 0, out);
    }
    return 0;
  }
  // latch0 (low byte of DVY, or delegates to latch3 for the special op-0xF form)
  h4(data) {
    this.dvy &= 0xF00;
    if (this.op === 0xF) this.h7(data);
    else this.dvy = (this.dvy & 0xF00) | data;
    this.pc = (this.pc + 1) & 0xFFFF;
    return 0;
  }
  // latch1 (high nibble of DVY + opcode)
  h5(data) {
    this.dvy = (this.dvy & 0xFF) | ((data & 0xF) << 8);
    this.op = data >> 4;
    if (this.op === 0xF) { this.dvx &= 0xF00; this.dvy &= 0xF00; }
    return 0;
  }
  // latch2 (low byte of DVX, may also latch persistent scale)
  h6(data) {
    this.dvx &= 0xF00;
    if (this.op !== 0xF) this.dvx = (this.dvx & 0xF00) | data;
    if ((this.op & 2) && (this.op & 8)) this.scale = this.intensity;
    this.pc = (this.pc + 1) & 0xFFFF;
    return 0;
  }
  // latch3 (high nibble of DVX + intensity)
  h7(data) {
    this.dvx = (this.dvx & 0xFF) | ((data & 0xF) << 8);
    this.intensity = data >> 4;
    return 0;
  }

  // Triggered by a 6502 write to $3000 (dvg go_w). Runs the whole display
  // list synchronously and stashes the resulting line segments + how many
  // 6502 cycles the real hardware would have taken to draw them.
  go() {
    this.dvy = 0; this.op = 0;
    this.pc = 0;
    this.stateLatch = 0;
    this.halt = 0;
    this.penX = this.xpos; this.penY = this.ypos;
    const out = [];
    let masterCycles = 0;
    let steps = 0;
    while (!this.halt && steps++ < 20000) {
      this.stateLatch = (this.stateLatch & 0x10) | (this.prom[this.stateAddr()] & 0xF);
      if (this.stateLatch & 8) {
        const bit = this.stateLatch & 1;
        const data = this.mem[(this.membase + (this.pc << 1) + bit) & 0x7FFF];
        switch (this.stateLatch & 7) {
          case 0: masterCycles += this.h0(); break;
          case 1: masterCycles += this.h1(); break;
          case 2: masterCycles += this.h2(out); break;
          case 3: masterCycles += this.h3(out); break;
          case 4: masterCycles += this.h4(data); break;
          case 5: masterCycles += this.h5(data); break;
          case 6: masterCycles += this.h6(data); break;
          case 7: masterCycles += this.h7(data); break;
        }
      }
      this.stateLatch = (this.halt << 4) | (this.stateLatch & 0xF);
      masterCycles += 8;
    }
    this.segments = out;
    // DVG runs off the 12.096MHz master clock; the 6502 runs at master/8.
    this.busyCpuCycles = Math.ceil(masterCycles / 8);
  }
}
