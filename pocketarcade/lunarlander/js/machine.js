'use strict';

// Lunar Lander (Atari, 1979) machine hardware: the same 6502 + DVG vector
// platform as Asteroids, but with a much smaller (unbanked, mirrored) RAM,
// a single-address direct-read IN0/THRUST instead of Asteroids' per-bit
// port scheme, and an analog thrust pedal instead of a binary thrust
// button. Independent reimplementation of the publicly documented
// hardware (MAME's src/mame/atari/asteroid.cpp llander_* functions), not
// a code port.
class LunarLander {
  constructor() {
    this.mem = new Uint8Array(0x8000);
    this.ram = new Uint8Array(0x100); // 256 bytes, mirrored across $0000-$1FFF
    this.cpu = new M6502();
    this.cpu.read = (addr) => this.read(addr);
    this.cpu.write = (addr, val) => this.write(addr, val);
    this.dvg = new DVG(this.mem, 0x4000);

    // IN1 bits: 0 start1, 1 coin1(active-low), 2 coin2, 3 coin3(active-low),
    // 4 start2/select, 5 abort, 6 right, 7 left. Rest state has the two
    // active-low coin bits high (not-inserted).
    this.in1 = 0x0A;
    // DSW1 default: right coin x1, English, normal coinage, 750 fuel/coin
    this.dsw1 = 0x80;
    this.thrustValue = 0; // 0-254, analog pedal position

    this.onSounds = null;      // (thrustVol0to7, explodeOn, tone3kOn, tone6kOn) => void
    this.onNoiseReset = null;

    this.cyclesPerFrame = 25200; // 1.512MHz / 60Hz
    this.nmiPeriod = 6144;
    this.nextNmiCycle = this.nmiPeriod;
    this.dvgDoneAtCycle = 0;
  }

  loadRoms() {
    decodeRoms(this.mem);
    this.dvg.loadProm(decodeDvgProm());
  }

  reset() {
    this.ram.fill(0);
    this.dvg.reset();
    this.cpu.reset();
    this.nextNmiCycle = this.nmiPeriod;
    this.dvgDoneAtCycle = 0;
  }

  read(addr) {
    addr &= 0x7FFF;
    if (addr < 0x2000) return this.ram[addr & 0xFF];
    if (addr === 0x2000) {
      // bit0: DVG done (1=done, direct polarity here, unlike Asteroids' inverted bit2)
      // bit6: 3KHz clock source; other fixed/unused bits read high at rest
      const done = this.getDvgBusy() ? 0 : 1;
      const clock = (this.cpu.cycles & 0x100) ? 1 : 0;
      return 0xBE | done | (clock << 6);
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
    if (addr === 0x2C00) return this.thrustValue & 0xFF;
    return this.mem[addr];
  }

  write(addr, val) {
    addr &= 0x7FFF;
    val &= 0xFF;
    if (addr < 0x2000) { this.ram[addr & 0xFF] = val; return; }
    if (addr === 0x3000) {
      this.dvg.go();
      this.dvgDoneAtCycle = this.cpu.cycles + this.dvg.busyCpuCycles;
      return;
    }
    if (addr === 0x3200) return; // output_latch: mission-select lamps only, no-op
    if (addr === 0x3400) return; // watchdog reset, no-op
    if (addr === 0x3C00) {
      if (this.onSounds) this.onSounds(val & 0x07, !!(val & 0x08), !!(val & 0x10), !!(val & 0x20));
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
        // NMI is suppressed only while the self-test/service switch is held
        // (IN0 bit1 low); we never simulate that switch being held, so it
        // always fires.
        cpu.nmi();
        this.nextNmiCycle += this.nmiPeriod;
      }
    }
    cpu.cycles -= this.cyclesPerFrame;
    this.nextNmiCycle -= this.cyclesPerFrame;
    this.dvgDoneAtCycle -= this.cyclesPerFrame;
  }

  // Named setters: IN1's coin1/coin3 bits are active-low, everything else
  // active-high, so a generic "set bit on" helper isn't safe here.
  setStart1(on) { this._setBit(0, on, false); }
  setCoin1(on) { this._setBit(1, on, true); }
  setCoin2(on) { this._setBit(2, on, false); }
  setCoin3(on) { this._setBit(3, on, true); }
  setSelect(on) { this._setBit(4, on, false); }
  setAbort(on) { this._setBit(5, on, false); }
  setRight(on) { this._setBit(6, on, false); }
  setLeft(on) { this._setBit(7, on, false); }

  _setBit(bit, on, activeLow) {
    const setHigh = activeLow ? !on : on;
    if (setHigh) this.in1 |= (1 << bit); else this.in1 &= ~(1 << bit);
  }
}
