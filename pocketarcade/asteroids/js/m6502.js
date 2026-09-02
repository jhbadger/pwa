'use strict';

// MOS 6502 CPU core (NMOS, documented opcodes only).
// Bus access goes through this.read()/this.write(), which the machine
// overrides to dispatch RAM, ROM and memory-mapped I/O.
class M6502 {
  constructor() {
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFD; this.pc = 0;
    this.N = 0; this.V = 0; this.D = 0; this.I = 1; this.Z = 0; this.C = 0;
    this.cycles = 0;
    this.halted = false; // unused (6502 has no HALT instruction); kept for machine.js symmetry
  }

  // Overridden by the machine to route to RAM/ROM/ports.
  read(addr) { return 0; }
  write(addr, val) {}

  read16(addr) {
    return this.read(addr) | (this.read((addr + 1) & 0xFFFF) << 8);
  }

  reset() {
    this.sp = 0xFD;
    this.I = 1; this.D = 0;
    this.pc = this.read16(0xFFFC);
    this.cycles = 0;
  }

  setZN(v) { this.Z = (v & 0xFF) === 0 ? 1 : 0; this.N = (v & 0x80) ? 1 : 0; return v & 0xFF; }

  push(v) { this.write(0x100 | this.sp, v & 0xFF); this.sp = (this.sp - 1) & 0xFF; }
  pull() { this.sp = (this.sp + 1) & 0xFF; return this.read(0x100 | this.sp); }

  getP(breakFlag) {
    return (this.N << 7) | (this.V << 6) | 0x20 | (breakFlag << 4) |
           (this.D << 3) | (this.I << 2) | (this.Z << 1) | this.C;
  }
  setP(p) {
    this.N = (p >> 7) & 1; this.V = (p >> 6) & 1; this.D = (p >> 3) & 1;
    this.I = (p >> 2) & 1; this.Z = (p >> 1) & 1; this.C = p & 1;
  }

  nmi() {
    this.push((this.pc >> 8) & 0xFF); this.push(this.pc & 0xFF);
    this.push(this.getP(0));
    this.I = 1;
    this.pc = this.read16(0xFFFA);
    this.cycles += 7;
  }
  irq() {
    if (this.I) return;
    this.push((this.pc >> 8) & 0xFF); this.push(this.pc & 0xFF);
    this.push(this.getP(0));
    this.I = 1;
    this.pc = this.read16(0xFFFE);
    this.cycles += 7;
  }

  // ── Addressing modes: return effective address, advancing pc past operands ──
  aImm() { const a = this.pc; this.pc = (this.pc + 1) & 0xFFFF; return a; }
  aZp()  { const a = this.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return a; }
  aZpx() { const a = (this.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return a; }
  aZpy() { const a = (this.read(this.pc) + this.y) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return a; }
  aAbs() {
    const lo = this.read(this.pc), hi = this.read((this.pc + 1) & 0xFFFF);
    this.pc = (this.pc + 2) & 0xFFFF;
    return lo | (hi << 8);
  }
  aAbsx() { return (this.aAbs() + this.x) & 0xFFFF; }
  aAbsy() { return (this.aAbs() + this.y) & 0xFFFF; }
  aInd() {
    const ptr = this.aAbs();
    const lo = this.read(ptr);
    // NMOS page-wrap bug: high byte fetched from start of same page.
    const hi = this.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF));
    return lo | (hi << 8);
  }
  aIndx() {
    const zp = (this.read(this.pc) + this.x) & 0xFF;
    this.pc = (this.pc + 1) & 0xFFFF;
    const lo = this.read(zp), hi = this.read((zp + 1) & 0xFF);
    return lo | (hi << 8);
  }
  aIndy() {
    const zp = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    const lo = this.read(zp), hi = this.read((zp + 1) & 0xFF);
    return ((lo | (hi << 8)) + this.y) & 0xFFFF;
  }
  aRel() {
    let off = this.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
    if (off & 0x80) off -= 0x100;
    return (this.pc + off) & 0xFFFF;
  }

  adc(v) {
    const c = this.C;
    if (this.D) {
      let lo = (this.a & 0xF) + (v & 0xF) + c;
      let hi = (this.a >> 4) + (v >> 4);
      if (lo > 9) { lo += 6; hi++; }
      const binSum = (this.a + v + c) & 0xFF;
      this.Z = binSum === 0 ? 1 : 0;
      this.N = (hi & 8) ? 1 : 0;
      this.V = ((~(this.a ^ v)) & (this.a ^ (hi << 4)) & 0x80) ? 1 : 0;
      if (hi > 9) hi += 6;
      this.C = hi > 15 ? 1 : 0;
      this.a = ((hi << 4) | (lo & 0xF)) & 0xFF;
    } else {
      const sum = this.a + v + c;
      this.V = ((~(this.a ^ v)) & (this.a ^ sum) & 0x80) ? 1 : 0;
      this.C = sum > 0xFF ? 1 : 0;
      this.a = this.setZN(sum);
    }
  }
  sbc(v) {
    const c = this.C;
    const sum = this.a - v - (1 - c);
    this.V = ((this.a ^ v) & (this.a ^ sum) & 0x80) ? 1 : 0;
    this.C = sum >= 0 ? 1 : 0;
    this.Z = (sum & 0xFF) === 0 ? 1 : 0;
    this.N = (sum & 0x80) ? 1 : 0;
    if (this.D) {
      let lo = (this.a & 0xF) - (v & 0xF) - (1 - c);
      let hi = (this.a >> 4) - (v >> 4);
      if (lo < 0) { lo -= 6; hi--; }
      if (hi < 0) hi -= 6;
      this.a = ((hi << 4) | (lo & 0xF)) & 0xFF;
    } else {
      this.a = sum & 0xFF;
    }
  }

  branch(cond) {
    const target = this.aRel();
    if (cond) { this.cycles += 1; this.pc = target; }
  }

  step() {
    const op = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    let a, v, t;

    switch (op) {
      // ── ADC ──
      case 0x69: this.adc(this.read(this.aImm())); this.cycles += 2; break;
      case 0x65: this.adc(this.read(this.aZp())); this.cycles += 3; break;
      case 0x75: this.adc(this.read(this.aZpx())); this.cycles += 4; break;
      case 0x6D: this.adc(this.read(this.aAbs())); this.cycles += 4; break;
      case 0x7D: this.adc(this.read(this.aAbsx())); this.cycles += 4; break;
      case 0x79: this.adc(this.read(this.aAbsy())); this.cycles += 4; break;
      case 0x61: this.adc(this.read(this.aIndx())); this.cycles += 6; break;
      case 0x71: this.adc(this.read(this.aIndy())); this.cycles += 5; break;
      // ── SBC ──
      case 0xE9: this.sbc(this.read(this.aImm())); this.cycles += 2; break;
      case 0xE5: this.sbc(this.read(this.aZp())); this.cycles += 3; break;
      case 0xF5: this.sbc(this.read(this.aZpx())); this.cycles += 4; break;
      case 0xED: this.sbc(this.read(this.aAbs())); this.cycles += 4; break;
      case 0xFD: this.sbc(this.read(this.aAbsx())); this.cycles += 4; break;
      case 0xF9: this.sbc(this.read(this.aAbsy())); this.cycles += 4; break;
      case 0xE1: this.sbc(this.read(this.aIndx())); this.cycles += 6; break;
      case 0xF1: this.sbc(this.read(this.aIndy())); this.cycles += 5; break;
      // ── AND ──
      case 0x29: this.a = this.setZN(this.a & this.read(this.aImm())); this.cycles += 2; break;
      case 0x25: this.a = this.setZN(this.a & this.read(this.aZp())); this.cycles += 3; break;
      case 0x35: this.a = this.setZN(this.a & this.read(this.aZpx())); this.cycles += 4; break;
      case 0x2D: this.a = this.setZN(this.a & this.read(this.aAbs())); this.cycles += 4; break;
      case 0x3D: this.a = this.setZN(this.a & this.read(this.aAbsx())); this.cycles += 4; break;
      case 0x39: this.a = this.setZN(this.a & this.read(this.aAbsy())); this.cycles += 4; break;
      case 0x21: this.a = this.setZN(this.a & this.read(this.aIndx())); this.cycles += 6; break;
      case 0x31: this.a = this.setZN(this.a & this.read(this.aIndy())); this.cycles += 5; break;
      // ── ORA ──
      case 0x09: this.a = this.setZN(this.a | this.read(this.aImm())); this.cycles += 2; break;
      case 0x05: this.a = this.setZN(this.a | this.read(this.aZp())); this.cycles += 3; break;
      case 0x15: this.a = this.setZN(this.a | this.read(this.aZpx())); this.cycles += 4; break;
      case 0x0D: this.a = this.setZN(this.a | this.read(this.aAbs())); this.cycles += 4; break;
      case 0x1D: this.a = this.setZN(this.a | this.read(this.aAbsx())); this.cycles += 4; break;
      case 0x19: this.a = this.setZN(this.a | this.read(this.aAbsy())); this.cycles += 4; break;
      case 0x01: this.a = this.setZN(this.a | this.read(this.aIndx())); this.cycles += 6; break;
      case 0x11: this.a = this.setZN(this.a | this.read(this.aIndy())); this.cycles += 5; break;
      // ── EOR ──
      case 0x49: this.a = this.setZN(this.a ^ this.read(this.aImm())); this.cycles += 2; break;
      case 0x45: this.a = this.setZN(this.a ^ this.read(this.aZp())); this.cycles += 3; break;
      case 0x55: this.a = this.setZN(this.a ^ this.read(this.aZpx())); this.cycles += 4; break;
      case 0x4D: this.a = this.setZN(this.a ^ this.read(this.aAbs())); this.cycles += 4; break;
      case 0x5D: this.a = this.setZN(this.a ^ this.read(this.aAbsx())); this.cycles += 4; break;
      case 0x59: this.a = this.setZN(this.a ^ this.read(this.aAbsy())); this.cycles += 4; break;
      case 0x41: this.a = this.setZN(this.a ^ this.read(this.aIndx())); this.cycles += 6; break;
      case 0x51: this.a = this.setZN(this.a ^ this.read(this.aIndy())); this.cycles += 5; break;
      // ── CMP ──
      case 0xC9: t = this.a - this.read(this.aImm()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 2; break;
      case 0xC5: t = this.a - this.read(this.aZp()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 3; break;
      case 0xD5: t = this.a - this.read(this.aZpx()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      case 0xCD: t = this.a - this.read(this.aAbs()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      case 0xDD: t = this.a - this.read(this.aAbsx()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      case 0xD9: t = this.a - this.read(this.aAbsy()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      case 0xC1: t = this.a - this.read(this.aIndx()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 6; break;
      case 0xD1: t = this.a - this.read(this.aIndy()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 5; break;
      // ── CPX / CPY ──
      case 0xE0: t = this.x - this.read(this.aImm()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 2; break;
      case 0xE4: t = this.x - this.read(this.aZp()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 3; break;
      case 0xEC: t = this.x - this.read(this.aAbs()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      case 0xC0: t = this.y - this.read(this.aImm()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 2; break;
      case 0xC4: t = this.y - this.read(this.aZp()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 3; break;
      case 0xCC: t = this.y - this.read(this.aAbs()); this.C = t >= 0 ? 1 : 0; this.setZN(t); this.cycles += 4; break;
      // ── LDA ──
      case 0xA9: this.a = this.setZN(this.read(this.aImm())); this.cycles += 2; break;
      case 0xA5: this.a = this.setZN(this.read(this.aZp())); this.cycles += 3; break;
      case 0xB5: this.a = this.setZN(this.read(this.aZpx())); this.cycles += 4; break;
      case 0xAD: this.a = this.setZN(this.read(this.aAbs())); this.cycles += 4; break;
      case 0xBD: this.a = this.setZN(this.read(this.aAbsx())); this.cycles += 4; break;
      case 0xB9: this.a = this.setZN(this.read(this.aAbsy())); this.cycles += 4; break;
      case 0xA1: this.a = this.setZN(this.read(this.aIndx())); this.cycles += 6; break;
      case 0xB1: this.a = this.setZN(this.read(this.aIndy())); this.cycles += 5; break;
      // ── LDX ──
      case 0xA2: this.x = this.setZN(this.read(this.aImm())); this.cycles += 2; break;
      case 0xA6: this.x = this.setZN(this.read(this.aZp())); this.cycles += 3; break;
      case 0xB6: this.x = this.setZN(this.read(this.aZpy())); this.cycles += 4; break;
      case 0xAE: this.x = this.setZN(this.read(this.aAbs())); this.cycles += 4; break;
      case 0xBE: this.x = this.setZN(this.read(this.aAbsy())); this.cycles += 4; break;
      // ── LDY ──
      case 0xA0: this.y = this.setZN(this.read(this.aImm())); this.cycles += 2; break;
      case 0xA4: this.y = this.setZN(this.read(this.aZp())); this.cycles += 3; break;
      case 0xB4: this.y = this.setZN(this.read(this.aZpx())); this.cycles += 4; break;
      case 0xAC: this.y = this.setZN(this.read(this.aAbs())); this.cycles += 4; break;
      case 0xBC: this.y = this.setZN(this.read(this.aAbsx())); this.cycles += 4; break;
      // ── STA ──
      case 0x85: this.write(this.aZp(), this.a); this.cycles += 3; break;
      case 0x95: this.write(this.aZpx(), this.a); this.cycles += 4; break;
      case 0x8D: this.write(this.aAbs(), this.a); this.cycles += 4; break;
      case 0x9D: this.write(this.aAbsx(), this.a); this.cycles += 5; break;
      case 0x99: this.write(this.aAbsy(), this.a); this.cycles += 5; break;
      case 0x81: this.write(this.aIndx(), this.a); this.cycles += 6; break;
      case 0x91: this.write(this.aIndy(), this.a); this.cycles += 6; break;
      // ── STX / STY ──
      case 0x86: this.write(this.aZp(), this.x); this.cycles += 3; break;
      case 0x96: this.write(this.aZpy(), this.x); this.cycles += 4; break;
      case 0x8E: this.write(this.aAbs(), this.x); this.cycles += 4; break;
      case 0x84: this.write(this.aZp(), this.y); this.cycles += 3; break;
      case 0x94: this.write(this.aZpx(), this.y); this.cycles += 4; break;
      case 0x8C: this.write(this.aAbs(), this.y); this.cycles += 4; break;
      // ── Transfers ──
      case 0xAA: this.x = this.setZN(this.a); this.cycles += 2; break; // TAX
      case 0xA8: this.y = this.setZN(this.a); this.cycles += 2; break; // TAY
      case 0x8A: this.a = this.setZN(this.x); this.cycles += 2; break; // TXA
      case 0x98: this.a = this.setZN(this.y); this.cycles += 2; break; // TYA
      case 0xBA: this.x = this.setZN(this.sp); this.cycles += 2; break; // TSX
      case 0x9A: this.sp = this.x; this.cycles += 2; break; // TXS (no flags)
      // ── INC / DEC (memory) ──
      case 0xE6: a = this.aZp(); this.write(a, this.setZN(this.read(a) + 1)); this.cycles += 5; break;
      case 0xF6: a = this.aZpx(); this.write(a, this.setZN(this.read(a) + 1)); this.cycles += 6; break;
      case 0xEE: a = this.aAbs(); this.write(a, this.setZN(this.read(a) + 1)); this.cycles += 6; break;
      case 0xFE: a = this.aAbsx(); this.write(a, this.setZN(this.read(a) + 1)); this.cycles += 7; break;
      case 0xC6: a = this.aZp(); this.write(a, this.setZN(this.read(a) - 1)); this.cycles += 5; break;
      case 0xD6: a = this.aZpx(); this.write(a, this.setZN(this.read(a) - 1)); this.cycles += 6; break;
      case 0xCE: a = this.aAbs(); this.write(a, this.setZN(this.read(a) - 1)); this.cycles += 6; break;
      case 0xDE: a = this.aAbsx(); this.write(a, this.setZN(this.read(a) - 1)); this.cycles += 7; break;
      // ── INX/INY/DEX/DEY ──
      case 0xE8: this.x = this.setZN(this.x + 1); this.cycles += 2; break;
      case 0xC8: this.y = this.setZN(this.y + 1); this.cycles += 2; break;
      case 0xCA: this.x = this.setZN(this.x - 1); this.cycles += 2; break;
      case 0x88: this.y = this.setZN(this.y - 1); this.cycles += 2; break;
      // ── Shifts/rotates (accumulator) ──
      case 0x0A: this.C = (this.a >> 7) & 1; this.a = this.setZN(this.a << 1); this.cycles += 2; break; // ASL A
      case 0x4A: this.C = this.a & 1; this.a = this.setZN(this.a >> 1); this.cycles += 2; break; // LSR A
      case 0x2A: t = (this.a << 1) | this.C; this.C = (this.a >> 7) & 1; this.a = this.setZN(t); this.cycles += 2; break; // ROL A
      case 0x6A: t = (this.a >> 1) | (this.C << 7); this.C = this.a & 1; this.a = this.setZN(t); this.cycles += 2; break; // ROR A
      // ── Shifts/rotates (memory) ──
      case 0x06: a = this.aZp(); v = this.read(a); this.C = (v >> 7) & 1; this.write(a, this.setZN(v << 1)); this.cycles += 5; break;
      case 0x16: a = this.aZpx(); v = this.read(a); this.C = (v >> 7) & 1; this.write(a, this.setZN(v << 1)); this.cycles += 6; break;
      case 0x0E: a = this.aAbs(); v = this.read(a); this.C = (v >> 7) & 1; this.write(a, this.setZN(v << 1)); this.cycles += 6; break;
      case 0x1E: a = this.aAbsx(); v = this.read(a); this.C = (v >> 7) & 1; this.write(a, this.setZN(v << 1)); this.cycles += 7; break;
      case 0x46: a = this.aZp(); v = this.read(a); this.C = v & 1; this.write(a, this.setZN(v >> 1)); this.cycles += 5; break;
      case 0x56: a = this.aZpx(); v = this.read(a); this.C = v & 1; this.write(a, this.setZN(v >> 1)); this.cycles += 6; break;
      case 0x4E: a = this.aAbs(); v = this.read(a); this.C = v & 1; this.write(a, this.setZN(v >> 1)); this.cycles += 6; break;
      case 0x5E: a = this.aAbsx(); v = this.read(a); this.C = v & 1; this.write(a, this.setZN(v >> 1)); this.cycles += 7; break;
      case 0x26: a = this.aZp(); v = this.read(a); t = (v << 1) | this.C; this.C = (v >> 7) & 1; this.write(a, this.setZN(t)); this.cycles += 5; break;
      case 0x36: a = this.aZpx(); v = this.read(a); t = (v << 1) | this.C; this.C = (v >> 7) & 1; this.write(a, this.setZN(t)); this.cycles += 6; break;
      case 0x2E: a = this.aAbs(); v = this.read(a); t = (v << 1) | this.C; this.C = (v >> 7) & 1; this.write(a, this.setZN(t)); this.cycles += 6; break;
      case 0x3E: a = this.aAbsx(); v = this.read(a); t = (v << 1) | this.C; this.C = (v >> 7) & 1; this.write(a, this.setZN(t)); this.cycles += 7; break;
      case 0x66: a = this.aZp(); v = this.read(a); t = (v >> 1) | (this.C << 7); this.C = v & 1; this.write(a, this.setZN(t)); this.cycles += 5; break;
      case 0x76: a = this.aZpx(); v = this.read(a); t = (v >> 1) | (this.C << 7); this.C = v & 1; this.write(a, this.setZN(t)); this.cycles += 6; break;
      case 0x6E: a = this.aAbs(); v = this.read(a); t = (v >> 1) | (this.C << 7); this.C = v & 1; this.write(a, this.setZN(t)); this.cycles += 6; break;
      case 0x7E: a = this.aAbsx(); v = this.read(a); t = (v >> 1) | (this.C << 7); this.C = v & 1; this.write(a, this.setZN(t)); this.cycles += 7; break;
      // ── BIT ──
      case 0x24: v = this.read(this.aZp()); this.Z = (this.a & v) === 0 ? 1 : 0; this.N = (v >> 7) & 1; this.V = (v >> 6) & 1; this.cycles += 3; break;
      case 0x2C: v = this.read(this.aAbs()); this.Z = (this.a & v) === 0 ? 1 : 0; this.N = (v >> 7) & 1; this.V = (v >> 6) & 1; this.cycles += 4; break;
      // ── Branches ──
      case 0x10: this.branch(!this.N); this.cycles += 2; break; // BPL
      case 0x30: this.branch(!!this.N); this.cycles += 2; break; // BMI
      case 0x50: this.branch(!this.V); this.cycles += 2; break; // BVC
      case 0x70: this.branch(!!this.V); this.cycles += 2; break; // BVS
      case 0x90: this.branch(!this.C); this.cycles += 2; break; // BCC
      case 0xB0: this.branch(!!this.C); this.cycles += 2; break; // BCS
      case 0xD0: this.branch(!this.Z); this.cycles += 2; break; // BNE
      case 0xF0: this.branch(!!this.Z); this.cycles += 2; break; // BEQ
      // ── Jumps / calls ──
      case 0x4C: this.pc = this.aAbs(); this.cycles += 3; break; // JMP abs
      case 0x6C: this.pc = this.aInd(); this.cycles += 5; break; // JMP (ind)
      case 0x20: { // JSR
        const target = this.aAbs();
        const ret = (this.pc - 1) & 0xFFFF;
        this.push((ret >> 8) & 0xFF); this.push(ret & 0xFF);
        this.pc = target;
        this.cycles += 6;
        break;
      }
      case 0x60: { // RTS
        const lo = this.pull(), hi = this.pull();
        this.pc = (((hi << 8) | lo) + 1) & 0xFFFF;
        this.cycles += 6;
        break;
      }
      case 0x00: { // BRK
        this.pc = (this.pc + 1) & 0xFFFF;
        this.push((this.pc >> 8) & 0xFF); this.push(this.pc & 0xFF);
        this.push(this.getP(1));
        this.I = 1;
        this.pc = this.read16(0xFFFE);
        this.cycles += 7;
        break;
      }
      case 0x40: { // RTI
        this.setP(this.pull());
        const lo = this.pull(), hi = this.pull();
        this.pc = (hi << 8) | lo;
        this.cycles += 6;
        break;
      }
      // ── Stack ──
      case 0x48: this.push(this.a); this.cycles += 3; break; // PHA
      case 0x68: this.a = this.setZN(this.pull()); this.cycles += 4; break; // PLA
      case 0x08: this.push(this.getP(1)); this.cycles += 3; break; // PHP
      case 0x28: this.setP(this.pull()); this.cycles += 4; break; // PLP
      // ── Flags ──
      case 0x18: this.C = 0; this.cycles += 2; break; // CLC
      case 0x38: this.C = 1; this.cycles += 2; break; // SEC
      case 0x58: this.I = 0; this.cycles += 2; break; // CLI
      case 0x78: this.I = 1; this.cycles += 2; break; // SEI
      case 0xB8: this.V = 0; this.cycles += 2; break; // CLV
      case 0xD8: this.D = 0; this.cycles += 2; break; // CLD
      case 0xF8: this.D = 1; this.cycles += 2; break; // SED
      // ── NOP ──
      case 0xEA: this.cycles += 2; break;
      default:
        // Unimplemented/illegal opcode: treat as a 1-cycle NOP so a stray
        // fetch can't wedge the emulator.
        this.cycles += 2;
        break;
    }
  }
}
