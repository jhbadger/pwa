'use strict';

// Intel 8080 CPU emulator
class I8080 {
  constructor() {
    this.mem = new Uint8Array(0x10000);
    this.a = 0; this.b = 0; this.c = 0;
    this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0; this.pc = 0;
    this.fS = 0; this.fZ = 0; this.fAC = 0; this.fP = 0; this.fC = 0;
    this.halted = false;
    this.inte = false;
    this.cycles = 0;
    this.onIn = null;   // function(port) -> byte
    this.onOut = null;  // function(port, byte)
  }

  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }

  rb(a) { return this.mem[a & 0xFFFF]; }
  rw(a) { a &= 0xFFFF; return this.mem[a] | (this.mem[(a+1) & 0xFFFF] << 8); }
  wb(a, v) { a &= 0xFFFF; if (a >= 0x2000) this.mem[a] = v & 0xFF; }
  ww(a, v) { this.wb(a, v & 0xFF); this.wb((a+1) & 0xFFFF, (v >> 8) & 0xFF); }

  next8() { const v = this.rb(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  next16() { const v = this.rw(this.pc); this.pc = (this.pc + 2) & 0xFFFF; return v; }

  push(v) { this.sp = (this.sp - 2) & 0xFFFF; this.ww(this.sp, v); }
  pop() { const v = this.rw(this.sp); this.sp = (this.sp + 2) & 0xFFFF; return v; }

  par(v) {
    v = (v & 0xFF) ^ (v >> 4);
    v ^= v >> 2; v ^= v >> 1;
    return 1 - (v & 1);
  }

  szp(v) {
    const b = v & 0xFF;
    this.fZ = b === 0 ? 1 : 0;
    this.fS = (b & 0x80) ? 1 : 0;
    this.fP = this.par(b);
    return b;
  }

  add(x, y, cy = 0) {
    const r = x + y + cy;
    this.fC = r > 0xFF ? 1 : 0;
    this.fAC = ((x & 0xF) + (y & 0xF) + cy) > 0xF ? 1 : 0;
    return this.szp(r);
  }

  sub(x, y, cy = 0) {
    const r = x - y - cy;
    this.fC = r < 0 ? 1 : 0;
    this.fAC = ((x & 0xF) - (y & 0xF) - cy) < 0 ? 1 : 0;
    return this.szp(r);
  }

  ana(x) {
    this.fAC = ((this.a | x) & 0x08) ? 1 : 0;
    this.fC = 0;
    return this.szp(this.a & x);
  }

  xra(x) { this.fAC = 0; this.fC = 0; return this.szp(this.a ^ x); }
  ora(x) { this.fAC = 0; this.fC = 0; return this.szp(this.a | x); }

  cmp(x) {
    const r = this.a - x;
    this.fC = r < 0 ? 1 : 0;
    this.fAC = ((this.a & 0xF) - (x & 0xF)) < 0 ? 1 : 0;
    this.szp(r);
  }

  inr(x) {
    const r = (x + 1) & 0xFF;
    this.fAC = (x & 0xF) === 0xF ? 1 : 0;
    this.fZ = r === 0 ? 1 : 0;
    this.fS = (r & 0x80) ? 1 : 0;
    this.fP = this.par(r);
    return r;
  }

  dcr(x) {
    const r = (x - 1) & 0xFF;
    this.fAC = (x & 0xF) !== 0 ? 1 : 0;
    this.fZ = r === 0 ? 1 : 0;
    this.fS = (r & 0x80) ? 1 : 0;
    this.fP = this.par(r);
    return r;
  }

  dad(rp) {
    const r = this.hl + rp;
    this.fC = r > 0xFFFF ? 1 : 0;
    this.hl = r;
  }

  get psw() {
    return (this.a << 8) | (this.fS << 7) | (this.fZ << 6) |
      (this.fAC << 4) | (this.fP << 2) | 0x02 | this.fC;
  }
  set psw(v) {
    this.a = (v >> 8) & 0xFF;
    const f = v & 0xFF;
    this.fS = (f >> 7) & 1; this.fZ = (f >> 6) & 1;
    this.fAC = (f >> 4) & 1; this.fP = (f >> 2) & 1; this.fC = f & 1;
  }

  getReg(r) {
    switch (r) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d;
      case 3: return this.e; case 4: return this.h; case 5: return this.l;
      case 6: return this.rb(this.hl); case 7: return this.a;
    }
  }

  setReg(r, v) {
    switch (r) {
      case 0: this.b = v; break; case 1: this.c = v; break;
      case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break;
      case 6: this.wb(this.hl, v); break; case 7: this.a = v; break;
    }
  }

  interrupt(vec) {
    if (!this.inte) return;
    this.inte = false;
    this.halted = false;
    this.push(this.pc);
    this.pc = vec;
    this.cycles += 11;
  }

  step() {
    if (this.halted) { this.cycles += 4; return; }
    const op = this.next8();
    let c = 4;

    // MOV r1, r2 (0x40-0x7F, except 0x76=HLT)
    if (op >= 0x40 && op <= 0x7F) {
      if (op === 0x76) { this.halted = true; }
      else {
        const src = op & 7, dst = (op >> 3) & 7;
        const v = this.getReg(src);
        this.setReg(dst, v);
        c = (src === 6 || dst === 6) ? 7 : 5;
      }
      this.cycles += c; return;
    }

    // ADD/ADC/SUB/SBB/ANA/XRA/ORA/CMP r (0x80-0xBF)
    if (op >= 0x80 && op <= 0xBF) {
      const r = op & 7, v = this.getReg(r);
      c = (r === 6) ? 7 : 4;
      switch ((op >> 3) & 7) {
        case 0: this.a = this.add(this.a, v); break;
        case 1: this.a = this.add(this.a, v, this.fC); break;
        case 2: this.a = this.sub(this.a, v); break;
        case 3: this.a = this.sub(this.a, v, this.fC); break;
        case 4: this.a = this.ana(v); break;
        case 5: this.a = this.xra(v); break;
        case 6: this.a = this.ora(v); break;
        case 7: this.cmp(v); break;
      }
      this.cycles += c; return;
    }

    switch (op) {
      case 0x00: c = 4; break; // NOP
      case 0x01: this.bc = this.next16(); c = 10; break; // LXI B
      case 0x02: this.wb(this.bc, this.a); c = 7; break; // STAX B
      case 0x03: this.bc = (this.bc + 1) & 0xFFFF; c = 5; break; // INX B
      case 0x04: this.b = this.inr(this.b); c = 5; break;
      case 0x05: this.b = this.dcr(this.b); c = 5; break;
      case 0x06: this.b = this.next8(); c = 7; break;
      case 0x07: { // RLC
        this.fC = (this.a >> 7) & 1;
        this.a = ((this.a << 1) | this.fC) & 0xFF;
        c = 4; break;
      }
      case 0x09: this.dad(this.bc); c = 10; break;
      case 0x0A: this.a = this.rb(this.bc); c = 7; break; // LDAX B
      case 0x0B: this.bc = (this.bc - 1) & 0xFFFF; c = 5; break;
      case 0x0C: this.c = this.inr(this.c); c = 5; break;
      case 0x0D: this.c = this.dcr(this.c); c = 5; break;
      case 0x0E: this.c = this.next8(); c = 7; break;
      case 0x0F: { // RRC
        this.fC = this.a & 1;
        this.a = ((this.a >> 1) | (this.fC << 7)) & 0xFF;
        c = 4; break;
      }
      case 0x11: this.de = this.next16(); c = 10; break;
      case 0x12: this.wb(this.de, this.a); c = 7; break;
      case 0x13: this.de = (this.de + 1) & 0xFFFF; c = 5; break;
      case 0x14: this.d = this.inr(this.d); c = 5; break;
      case 0x15: this.d = this.dcr(this.d); c = 5; break;
      case 0x16: this.d = this.next8(); c = 7; break;
      case 0x17: { // RAL
        const b7 = (this.a >> 7) & 1;
        this.a = ((this.a << 1) | this.fC) & 0xFF;
        this.fC = b7; c = 4; break;
      }
      case 0x19: this.dad(this.de); c = 10; break;
      case 0x1A: this.a = this.rb(this.de); c = 7; break;
      case 0x1B: this.de = (this.de - 1) & 0xFFFF; c = 5; break;
      case 0x1C: this.e = this.inr(this.e); c = 5; break;
      case 0x1D: this.e = this.dcr(this.e); c = 5; break;
      case 0x1E: this.e = this.next8(); c = 7; break;
      case 0x1F: { // RAR
        const b0 = this.a & 1;
        this.a = ((this.a >> 1) | (this.fC << 7)) & 0xFF;
        this.fC = b0; c = 4; break;
      }
      case 0x21: this.hl = this.next16(); c = 10; break;
      case 0x22: { const a = this.next16(); this.ww(a, this.hl); c = 16; break; } // SHLD
      case 0x23: this.hl = (this.hl + 1) & 0xFFFF; c = 5; break;
      case 0x24: this.h = this.inr(this.h); c = 5; break;
      case 0x25: this.h = this.dcr(this.h); c = 5; break;
      case 0x26: this.h = this.next8(); c = 7; break;
      case 0x27: { // DAA
        let a = this.a, cy = this.fC, ac = 0;
        if ((a & 0xF) > 9 || this.fAC) { ac = 1; a += 6; if ((a & 0xFF) < 6) cy = 1; }
        if ((a >> 4) > 9 || this.fC) { a += 0x60; cy = 1; }
        this.fAC = ac; this.fC = cy; this.a = this.szp(a);
        c = 4; break;
      }
      case 0x29: this.dad(this.hl); c = 10; break;
      case 0x2A: { const a = this.next16(); this.hl = this.rw(a); c = 16; break; } // LHLD
      case 0x2B: this.hl = (this.hl - 1) & 0xFFFF; c = 5; break;
      case 0x2C: this.l = this.inr(this.l); c = 5; break;
      case 0x2D: this.l = this.dcr(this.l); c = 5; break;
      case 0x2E: this.l = this.next8(); c = 7; break;
      case 0x2F: this.a ^= 0xFF; c = 4; break; // CMA
      case 0x31: this.sp = this.next16(); c = 10; break;
      case 0x32: { const a = this.next16(); this.wb(a, this.a); c = 13; break; } // STA
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; c = 5; break;
      case 0x34: { const v = this.inr(this.rb(this.hl)); this.wb(this.hl, v); c = 10; break; }
      case 0x35: { const v = this.dcr(this.rb(this.hl)); this.wb(this.hl, v); c = 10; break; }
      case 0x36: this.wb(this.hl, this.next8()); c = 10; break;
      case 0x37: this.fC = 1; c = 4; break; // STC
      case 0x39: this.dad(this.sp); c = 10; break;
      case 0x3A: { const a = this.next16(); this.a = this.rb(a); c = 13; break; } // LDA
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; c = 5; break;
      case 0x3C: this.a = this.inr(this.a); c = 5; break;
      case 0x3D: this.a = this.dcr(this.a); c = 5; break;
      case 0x3E: this.a = this.next8(); c = 7; break;
      case 0x3F: this.fC ^= 1; c = 4; break; // CMC

      // Branches
      case 0xC0: c = this.fZ ? 5 : (this.pc = this.pop(), 11); break; // RNZ
      case 0xC1: this.bc = this.pop(); c = 10; break;
      case 0xC2: { const a = this.next16(); if (!this.fZ) this.pc = a; c = 10; break; }
      case 0xC3: case 0xCB: this.pc = this.next16(); c = 10; break; // JMP
      case 0xC4: { const a = this.next16(); if (!this.fZ) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xC5: this.push(this.bc); c = 11; break;
      case 0xC6: this.a = this.add(this.a, this.next8()); c = 7; break;
      case 0xC7: this.push(this.pc); this.pc = 0x00; c = 11; break; // RST 0
      case 0xC8: c = !this.fZ ? 5 : (this.pc = this.pop(), 11); break; // RZ
      case 0xC9: case 0xD9: this.pc = this.pop(); c = 10; break; // RET
      case 0xCA: { const a = this.next16(); if (this.fZ) this.pc = a; c = 10; break; }
      case 0xCC: { const a = this.next16(); if (this.fZ) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xCD: case 0xDD: case 0xED: case 0xFD: // CALL
        { const a = this.next16(); this.push(this.pc); this.pc = a; c = 17; break; }
      case 0xCE: this.a = this.add(this.a, this.next8(), this.fC); c = 7; break;
      case 0xCF: this.push(this.pc); this.pc = 0x08; c = 11; break; // RST 1
      case 0xD0: c = this.fC ? 5 : (this.pc = this.pop(), 11); break; // RNC
      case 0xD1: this.de = this.pop(); c = 10; break;
      case 0xD2: { const a = this.next16(); if (!this.fC) this.pc = a; c = 10; break; }
      case 0xD3: { const p = this.next8(); if (this.onOut) this.onOut(p, this.a); c = 10; break; } // OUT
      case 0xD4: { const a = this.next16(); if (!this.fC) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xD5: this.push(this.de); c = 11; break;
      case 0xD6: this.a = this.sub(this.a, this.next8()); c = 7; break;
      case 0xD7: this.push(this.pc); this.pc = 0x10; c = 11; break; // RST 2
      case 0xD8: c = !this.fC ? 5 : (this.pc = this.pop(), 11); break; // RC
      case 0xDA: { const a = this.next16(); if (this.fC) this.pc = a; c = 10; break; }
      case 0xDB: { const p = this.next8(); this.a = this.onIn ? this.onIn(p) : 0; c = 10; break; } // IN
      case 0xDC: { const a = this.next16(); if (this.fC) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xDE: this.a = this.sub(this.a, this.next8(), this.fC); c = 7; break;
      case 0xDF: this.push(this.pc); this.pc = 0x18; c = 11; break; // RST 3
      case 0xE0: c = this.fP ? 5 : (this.pc = this.pop(), 11); break; // RPO
      case 0xE1: this.hl = this.pop(); c = 10; break;
      case 0xE2: { const a = this.next16(); if (!this.fP) this.pc = a; c = 10; break; }
      case 0xE3: { const top = this.rw(this.sp); this.ww(this.sp, this.hl); this.hl = top; c = 18; break; } // XTHL
      case 0xE4: { const a = this.next16(); if (!this.fP) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xE5: this.push(this.hl); c = 11; break;
      case 0xE6: this.a = this.ana(this.next8()); c = 7; break;
      case 0xE7: this.push(this.pc); this.pc = 0x20; c = 11; break; // RST 4
      case 0xE8: c = !this.fP ? 5 : (this.pc = this.pop(), 11); break; // RPE
      case 0xE9: this.pc = this.hl; c = 5; break; // PCHL
      case 0xEA: { const a = this.next16(); if (this.fP) this.pc = a; c = 10; break; }
      case 0xEB: { const t = this.hl; this.hl = this.de; this.de = t; c = 5; break; } // XCHG
      case 0xEC: { const a = this.next16(); if (this.fP) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xEE: this.a = this.xra(this.next8()); c = 7; break;
      case 0xEF: this.push(this.pc); this.pc = 0x28; c = 11; break; // RST 5
      case 0xF0: c = this.fS ? 5 : (this.pc = this.pop(), 11); break; // RP
      case 0xF1: this.psw = this.pop(); c = 10; break;
      case 0xF2: { const a = this.next16(); if (!this.fS) this.pc = a; c = 10; break; }
      case 0xF3: this.inte = false; c = 4; break; // DI
      case 0xF4: { const a = this.next16(); if (!this.fS) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xF5: this.push(this.psw); c = 11; break;
      case 0xF6: this.a = this.ora(this.next8()); c = 7; break;
      case 0xF7: this.push(this.pc); this.pc = 0x30; c = 11; break; // RST 6
      case 0xF8: c = !this.fS ? 5 : (this.pc = this.pop(), 11); break; // RM
      case 0xF9: this.sp = this.hl; c = 5; break; // SPHL
      case 0xFA: { const a = this.next16(); if (this.fS) this.pc = a; c = 10; break; }
      case 0xFB: this.inte = true; c = 4; break; // EI
      case 0xFC: { const a = this.next16(); if (this.fS) { this.push(this.pc); this.pc = a; c = 17; } else c = 11; break; }
      case 0xFE: this.cmp(this.next8()); c = 7; break;
      case 0xFF: this.push(this.pc); this.pc = 0x38; c = 11; break; // RST 7
      default: c = 4; break; // treat unknown as NOP
    }
    this.cycles += c;
  }
}
