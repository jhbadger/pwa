'use strict';

// Asteroids (Atari, 1979) machine hardware: 6502 CPU + DVG vector generator.
// See MAME's src/mame/atari/asteroid.cpp for the reference memory map — this
// is an independent reimplementation of the same publicly documented
// hardware behavior, not a port of that code.
class Asteroids {
  constructor() {
    this.mem = new Uint8Array(0x8000);
    this.cpu = new M6502();
    this.cpu.read = (addr) => this.read(addr);
    this.cpu.write = (addr, val) => this.write(addr, val);
    this.dvg = new DVG(this.mem, 0x4000);

    // Banked RAM at $0200-$03FF, swapped by RAMSEL (outlatch bit 2) so each
    // player's turn (in a 2-player cabinet) keeps separate scratch state.
    this.ram1 = [new Uint8Array(0x100), new Uint8Array(0x100)];
    this.ram2 = [new Uint8Array(0x100), new Uint8Array(0x100)];
    this.ramsel = 0;

    // IN0/IN1 button state (bit layout matches the real cabinet's wiring)
    this.in0 = 0; // bit3 hyperspace, bit4 fire, bit5 service, bit6 tilt, bit7 self-test
    this.in1 = 0; // bit0-2 coins, bit3/4 start1/2, bit5 thrust, bit6 right, bit7 left
    // DSW1 default: English, 3 ships, coin mechs x1, 1 coin/1 credit
    this.dsw1 = 0x84;

    this.audiolatch = 0;   // 6 sound-gate bits (LS259 @ $3C00-$3C07)
    this.onSoundGate = null; // (bit, on) => void
    this.onExplode = null;   // (volume0to15, pitchDivider) => void
    this.onThump = null;     // (enabled, data0to15) => void
    this.onNoiseReset = null;

    this.cyclesPerFrame = 25200; // 1.512MHz / 60Hz
    this.nmiPeriod = 6144;       // exact: (12.096MHz/4096/12) divides 1.512MHz every 6144 cycles
    this.nextNmiCycle = this.nmiPeriod;
    this.dvgDoneAtCycle = 0;
  }

  loadRoms() {
    decodeRoms(this.mem);
    this.dvg.loadProm(decodeDvgProm());
  }

  reset() {
    this.ram1[0].fill(0); this.ram1[1].fill(0);
    this.ram2[0].fill(0); this.ram2[1].fill(0);
    this.mem.fill(0, 0, 0x200);
    this.ramsel = 0;
    this.audiolatch = 0;
    this.dvg.reset();
    this.cpu.reset();
    this.nextNmiCycle = this.nmiPeriod;
    this.dvgDoneAtCycle = 0;
  }

  read(addr) {
    addr &= 0x7FFF;
    if (addr < 0x200) return this.mem[addr];
    if (addr < 0x300) return this.ram1[this.ramsel][addr - 0x200];
    if (addr < 0x400) return this.ram2[this.ramsel][addr - 0x300];
    if (addr >= 0x2000 && addr < 0x2008) {
      const offset = addr - 0x2000;
      let bit;
      if (offset === 1) bit = (this.cpu.cycles & 0x100) ? 1 : 0;       // 3KHz clock source
      else if (offset === 2) bit = this.getDvgBusy() ? 1 : 0;          // DVG busy
      else bit = (this.in0 >> offset) & 1;
      return bit ? 0x80 : 0x7F;
    }
    if (addr >= 0x2400 && addr < 0x2408) {
      const bit = (this.in1 >> (addr - 0x2400)) & 1;
      return bit ? 0x80 : 0x7F;
    }
    if (addr >= 0x2800 && addr < 0x2804) {
      const v = this.dsw1;
      const bitn = (n) => (v >> n) & 1;
      let za, zb;
      switch (addr & 3) {
        case 0: za = bitn(6); zb = bitn(7); break;
        case 1: za = bitn(4); zb = bitn(5); break;
        case 2: za = bitn(2); zb = bitn(3); break;
        default: za = bitn(0); zb = bitn(1); break;
      }
      return 0xFC | (zb << 1) | za;
    }
    return this.mem[addr];
  }

  write(addr, val) {
    addr &= 0x7FFF;
    val &= 0xFF;
    if (addr < 0x200) { this.mem[addr] = val; return; }
    if (addr < 0x300) { this.ram1[this.ramsel][addr - 0x200] = val; return; }
    if (addr < 0x400) { this.ram2[this.ramsel][addr - 0x300] = val; return; }
    if (addr === 0x3000) {
      this.dvg.go();
      this.dvgDoneAtCycle = this.cpu.cycles + this.dvg.busyCpuCycles;
      return;
    }
    if (addr === 0x3200) { // output_latch (LS174): start lamps, RAMSEL, coin counters
      this.ramsel = (val >> 2) & 1;
      return;
    }
    if (addr === 0x3400) return; // watchdog reset, no-op
    if (addr === 0x3600) {
      if (this.onExplode) {
        const volume = (val & 0x3C) >> 2;
        const pitch = { 0x00: 12, 0x40: 6, 0x80: 3, 0xC0: 5 }[val & 0xC0];
        this.onExplode(volume, pitch);
      }
      return;
    }
    if (addr === 0x3A00) {
      if (this.onThump) this.onThump(!!(val & 0x10), val & 0x0F);
      return;
    }
    if (addr >= 0x3C00 && addr < 0x3C08) {
      const bitIndex = addr - 0x3C00;
      const newBit = (val >> 7) & 1;
      const oldBit = (this.audiolatch >> bitIndex) & 1;
      this.audiolatch = (this.audiolatch & ~(1 << bitIndex)) | (newBit << bitIndex);
      if (newBit !== oldBit && this.onSoundGate) this.onSoundGate(bitIndex, !!newBit);
      return;
    }
    if (addr === 0x3E00) { if (this.onNoiseReset) this.onNoiseReset(); return; }
    this.mem[addr] = val; // vector RAM / ROM (ROM writes are harmless no-ops)
  }

  getDvgBusy() {
    return this.cpu.cycles < this.dvgDoneAtCycle;
  }

  runFrame() {
    const cpu = this.cpu;
    const target = cpu.cycles + this.cyclesPerFrame;
    while (cpu.cycles < target) {
      cpu.step();
      if (cpu.cycles >= this.nextNmiCycle) {
        if (!(this.in0 & 0x80)) cpu.nmi(); // suppressed only while self-test is held
        this.nextNmiCycle += this.nmiPeriod;
      }
    }
    cpu.cycles -= this.cyclesPerFrame;
    this.nextNmiCycle -= this.cyclesPerFrame;
    this.dvgDoneAtCycle -= this.cyclesPerFrame;
  }

  // Input helpers
  setIn0(bit, on) { if (on) this.in0 |= (1 << bit); else this.in0 &= ~(1 << bit); }
  setIn1(bit, on) { if (on) this.in1 |= (1 << bit); else this.in1 &= ~(1 << bit); }
}
