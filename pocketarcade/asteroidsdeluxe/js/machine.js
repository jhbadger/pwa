'use strict';

// Asteroids Deluxe (Atari, 1980) machine hardware: same 6502+DVG vector
// platform as Asteroids, but with a POKEY sound chip added and a real EAROM
// (electrically-alterable ROM) chip for non-volatile high-score storage
// instead of Asteroids' plain (volatile) work RAM. Independent
// reimplementation of the publicly documented hardware, not a code port.
class AsteroidsDeluxe {
  constructor() {
    this.mem = new Uint8Array(0x8000);
    this.cpu = new M6502();
    this.cpu.read = (addr) => this.read(addr);
    this.cpu.write = (addr, val) => this.write(addr, val);
    this.dvg = new DVG(this.mem, 0x4000);

    this.ram1 = [new Uint8Array(0x100), new Uint8Array(0x100)];
    this.ram2 = [new Uint8Array(0x100), new Uint8Array(0x100)];
    this.ramsel = 0;

    this.in0 = 0;
    this.in1 = 0;
    this.dsw1 = 0x00; // English, 3-5 ships, 1-play minimum, easy first 30000, bonus @10000
    this.dsw2 = 0xFD; // 1 coin/1 credit, coin mechs x1, no bonus coins

    this.audiolatch = 0;
    this.onSoundGate = null;  // (bit, on) => void — only bit3 (thrust) is wired on Deluxe
    this.onExplode = null;
    this.onPokeyWrite = null; // (reg0to15, val) => void
    this.onNoiseReset = null;

    // EAROM: 64 bytes of real non-volatile storage (high scores + settings),
    // addressed by the last byte offset written via $3200-$323F and read
    // back (regardless of address) at $2C40-$2C7F.
    this.earom = new Uint8Array(0x40);
    this.earomAddr = 0;

    this.cyclesPerFrame = 25200;
    this.nmiPeriod = 6144;
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
      if (offset === 1) bit = (this.cpu.cycles & 0x100) ? 1 : 0;
      else if (offset === 2) bit = this.getDvgBusy() ? 1 : 0;
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
    if (addr >= 0x2C00 && addr < 0x2C10) return this.pokeyRead(addr - 0x2C00);
    if (addr >= 0x2C40 && addr < 0x2C80) return this.earom[this.earomAddr];
    return this.mem[addr];
  }

  write(addr, val) {
    addr &= 0x7FFF;
    val &= 0xFF;
    if (addr < 0x200) { this.mem[addr] = val; return; }
    if (addr < 0x300) { this.ram1[this.ramsel][addr - 0x200] = val; return; }
    if (addr < 0x400) { this.ram2[this.ramsel][addr - 0x300] = val; return; }
    if (addr >= 0x2C00 && addr < 0x2C10) { this.pokeyWrite(addr - 0x2C00, val); return; }
    if (addr === 0x3000) {
      this.dvg.go();
      this.dvgDoneAtCycle = this.cpu.cycles + this.dvg.busyCpuCycles;
      return;
    }
    if (addr >= 0x3200 && addr < 0x3240) {
      this.earomAddr = addr - 0x3200;
      this.earom[this.earomAddr] = val; // write-through (real chip needs a clocked commit; harmless here)
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
    if (addr === 0x3A00) return; // earom_control_w, no-op (we write EAROM through immediately)
    if (addr >= 0x3C00 && addr < 0x3C08) {
      const bitIndex = addr - 0x3C00;
      const newBit = (val >> 7) & 1;
      const oldBit = (this.audiolatch >> bitIndex) & 1;
      this.audiolatch = (this.audiolatch & ~(1 << bitIndex)) | (newBit << bitIndex);
      if (bitIndex === 4) this.ramsel = newBit; // RAMSEL lives on audiolatch bit4 on Deluxe
      else if (bitIndex === 3 && newBit !== oldBit && this.onSoundGate) {
        this.onSoundGate(3, !newBit); // thrust enable is inverted on Deluxe
      }
      return;
    }
    if (addr === 0x3E00) { if (this.onNoiseReset) this.onNoiseReset(); return; }
    this.mem[addr] = val;
  }

  pokeyRead(reg) {
    if (reg === 8) return this.dsw2; // ALLPOT reads the second DIP bank on this board
    if (reg === 10) return Math.floor(Math.random() * 256); // RANDOM
    return 0xFF; // SERIN/IRQST/SKSTAT etc. — report idle/no-pending
  }
  pokeyWrite(reg, val) {
    if (this.onPokeyWrite) this.onPokeyWrite(reg, val);
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
        if (!(this.in0 & 0x80)) cpu.nmi();
        this.nextNmiCycle += this.nmiPeriod;
      }
    }
    cpu.cycles -= this.cyclesPerFrame;
    this.nextNmiCycle -= this.cyclesPerFrame;
    this.dvgDoneAtCycle -= this.cyclesPerFrame;
  }

  setIn0(bit, on) { if (on) this.in0 |= (1 << bit); else this.in0 &= ~(1 << bit); }
  setIn1(bit, on) { if (on) this.in1 |= (1 << bit); else this.in1 &= ~(1 << bit); }
}
