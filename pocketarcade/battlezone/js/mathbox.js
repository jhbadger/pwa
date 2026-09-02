'use strict';

// Atari Math Box — the AM2901 bit-slice coprocessor Battlezone's 6502 offloads
// its 3D rotate/translate/perspective-divide arithmetic to. The original
// silicon runs real bit-slice microcode, but that microcode was reverse
// engineered into equivalent 16-bit fixed-point arithmetic long ago (Eric
// Smith's mathbox.c), and that's what's ported here: same 16-register file,
// same per-function math, no gate-level simulation needed. Independent
// reimplementation from that published algorithm, not a code port.
//
// Registers are 16-bit two's complement, and every store into `reg` must
// wrap the same way the real int16_t register file did — Int16Array does
// that truncation for us on every assignment, so register-to-register ops
// below are written as plain arithmetic. `mb_q`-style scratch values that
// were plain int16_t *locals* in the original (not registers) are instead
// tracked in a JS variable with an explicit `<<16>>16` truncation after
// every op that would have truncated in C, to reproduce the same overflow
// behavior.
class MathBox {
  constructor() {
    this.reg = new Int16Array(16);
    this.result = 0;
  }

  reset() {
    this.reg.fill(0);
    this.result = 0;
  }

  lo() { return this.result & 0xFF; }
  hi() { return (this.result >> 8) & 0xFF; }

  // step_048: shared tail of commands 0x0b (start divide-setup, multi-step)
  // and 0x11 (same, but reg[0xf]=0 short-circuits the "stop here" check
  // below so it always falls through into 0x12/0x13).
  step048() {
    const r = this.reg;
    let t = r[0] * r[4];
    r[0xc] = t >> 16;
    r[0xe] = t & 0xFFFF;

    t = (-r[1]) * r[5];
    r[7] = t >> 16;
    let q = t & 0xFFFF;

    r[7] += r[0xc];

    // rounding
    r[0xe] = (r[0xe] >> 1) & 0x7FFF;
    r[0xc] = (q >> 1) & 0x7FFF;
    q = r[0xc] + r[0xe];
    if (((q << 16) >> 16) < 0) r[7]++;

    this.result = r[7];

    if (r[0xf] < 0) return;

    r[7] += r[2];
    this.step012();
  }

  // step_012 (command 0x12, and fallthrough from step048)
  step012() {
    const r = this.reg;
    let t = r[1] * r[4];
    r[0xc] = t >> 16;
    r[9] = t & 0xFFFF;

    t = r[0] * r[5];
    r[8] = t >> 16;
    let q = t & 0xFFFF;

    r[8] += r[0xc];

    r[9] = (r[9] >> 1) & 0x7FFF;
    r[0xc] = (q >> 1) & 0x7FFF;
    r[9] += r[0xc];
    if (r[9] < 0) r[8]++;
    r[9] = r[9] << 1;

    this.result = r[8];

    if (r[0xf] < 0) return;

    r[8] += r[3];
    r[9] &= 0xFF00;
    this.step013();
  }

  // step_013 (command 0x13, and fallthrough from step012)
  step013() {
    const r = this.reg;
    r[0xc] = r[9];
    this.stepBf(r[8]);
  }

  // command 0x14 — same divide-loop tail as 0x13, different source regs
  step014() {
    const r = this.reg;
    r[0xc] = r[0xa];
    this.stepBf(r[0xb]);
  }

  // step_0bf: the shared long-division loop used by commands 0x13/0x14.
  // reg[0xc]-reg[0xf] are real mathbox registers here (not scratch locals);
  // only `q` (the original's `mb_q`) is a genuine int16_t local.
  stepBf(mbQ) {
    const r = this.reg;
    let q = (mbQ << 16) >> 16;

    r[0xe] = r[7] ^ q; // save sign of result
    r[0xd] = q;
    if (q >= 0) {
      q = r[0xc];
    } else {
      r[0xd] = -q - 1;
      q = (-r[0xc] - 1) << 16 >> 16;
      if (q < 0 && (((q + 1) << 16) >> 16) < 0) r[0xd]++;
      q = (q + 1) << 16 >> 16;
    }

    r[0xc] = r[7] >= 0 ? r[7] : -r[7];

    r[0xf] = r[6]; // step counter

    do {
      r[0xd] -= r[0xc];
      const msb = (q & 0x8000) !== 0 ? 1 : 0;
      q = (q << 1) << 16 >> 16;
      if (r[0xd] >= 0) q = (q + 1) << 16 >> 16;
      else r[0xd] += r[0xc];
      r[0xd] = r[0xd] << 1;
      r[0xd] += msb;
      r[0xf]--;
    } while (r[0xf] >= 0);

    this.result = r[0xe] >= 0 ? q : (-q) << 16 >> 16;
  }

  // command 0x1c: "window test" — clips a line segment against a bound,
  // used by the 3D pipeline for visibility/clip testing.
  windowTest(data) {
    const r = this.reg;
    r[5] = (r[5] & 0x00FF) | (data << 8);
    do {
      r[0xe] = (r[4] + r[7]) >> 1;
      r[0xf] = (r[5] + r[8]) >> 1;
      if (r[0xb] < r[0xe] && r[0xf] < r[0xe] && (r[0xe] + r[0xf]) >= 0) {
        r[7] = r[0xe]; r[8] = r[0xf];
      } else {
        r[4] = r[0xe]; r[5] = r[0xf];
      }
      r[6]--;
    } while (r[6] >= 0);
    this.result = r[8];
  }

  // command 0x1e (and fallthrough from 0x1d): result = max(reg2,reg3) +
  // 3/8 * min(reg2,reg3) — a fast 2D-distance approximation.
  distanceApprox() {
    const r = this.reg;
    if (r[3] >= r[2]) { r[0xc] = r[2]; r[0xd] = r[3]; }
    else { r[0xd] = r[2]; r[0xc] = r[3]; }
    r[0xc] = r[0xc] >> 2;
    r[0xd] = r[0xd] + r[0xc];
    r[0xc] = r[0xc] >> 1;
    r[0xd] = r[0xc] + r[0xd];
    this.result = r[0xd];
  }

  // Triggered by a 6502 write to $1860-$187f. `offset` is addr-$1860
  // (the math box "function select"), `data` is the byte written.
  go(offset, data) {
    const r = this.reg;
    switch (offset) {
      case 0x00: this.result = r[0] = (r[0] & 0xFF00) | data; break;
      case 0x01: this.result = r[0] = (r[0] & 0x00FF) | (data << 8); break;
      case 0x02: this.result = r[1] = (r[1] & 0xFF00) | data; break;
      case 0x03: this.result = r[1] = (r[1] & 0x00FF) | (data << 8); break;
      case 0x04: this.result = r[2] = (r[2] & 0xFF00) | data; break;
      case 0x05: this.result = r[2] = (r[2] & 0x00FF) | (data << 8); break;
      case 0x06: this.result = r[3] = (r[3] & 0xFF00) | data; break;
      case 0x07: this.result = r[3] = (r[3] & 0x00FF) | (data << 8); break;
      case 0x08: this.result = r[4] = (r[4] & 0xFF00) | data; break;
      case 0x09: this.result = r[4] = (r[4] & 0x00FF) | (data << 8); break;

      case 0x0A: this.result = r[5] = (r[5] & 0xFF00) | data; break;
      // note: no function loads the low part of reg5 without also
      // performing a computation (see 0x0b/0x11)

      case 0x0C: this.result = r[6] = data; break;
      // note: no function loads the high part of reg6

      case 0x15: this.result = r[7] = (r[7] & 0xFF00) | data; break;
      case 0x16: this.result = r[7] = (r[7] & 0x00FF) | (data << 8); break;

      case 0x1A: this.result = r[8] = (r[8] & 0xFF00) | data; break;
      case 0x1B: this.result = r[8] = (r[8] & 0x00FF) | (data << 8); break;

      case 0x0D: this.result = r[0xa] = (r[0xa] & 0xFF00) | data; break;
      case 0x0E: this.result = r[0xa] = (r[0xa] & 0x00FF) | (data << 8); break;
      case 0x0F: this.result = r[0xb] = (r[0xb] & 0xFF00) | data; break;
      case 0x10: this.result = r[0xb] = (r[0xb] & 0x00FF) | (data << 8); break;

      case 0x17: this.result = r[7]; break;
      case 0x19: this.result = r[8]; break;
      case 0x18: this.result = r[9]; break;

      case 0x0B:
        r[5] = (r[5] & 0x00FF) | (data << 8);
        r[0xf] = -1; // 0xffff as int16_t
        r[4] -= r[2];
        r[5] -= r[3];
        this.step048();
        break;

      case 0x12: this.step012(); break;
      case 0x13: this.step013(); break;
      case 0x14: this.step014(); break;

      case 0x11:
        r[5] = (r[5] & 0x00FF) | (data << 8);
        r[0xf] = 0; // do everything in one step
        this.step048();
        break;

      case 0x1C: this.windowTest(data); break;

      case 0x1D:
        r[3] = (r[3] & 0x00FF) | (data << 8);
        r[2] -= r[0];
        if (r[2] < 0) r[2] = -r[2];
        r[3] -= r[1];
        if (r[3] < 0) r[3] = -r[3];
        this.distanceApprox();
        break;

      case 0x1E: this.distanceApprox(); break;

      case 0x1F: break; // self-test/signature analysis, not needed here

      default: break;
    }
  }
}
