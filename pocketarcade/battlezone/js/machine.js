'use strict';

// Battlezone (Atari, 1980) machine hardware: 6502 + AVG (Analog Vector
// Generator — a different beast from the DVG that Asteroids/Lunar Lander
// use, see js/avg.js) + the Math Box 3D coprocessor + POKEY + a discrete
// sound board for the tank engine/cannon/explosion. Same 1.512MHz 6502 and
// NMI cadence as Lunar Lander — both are built on the same Atari vector
// platform generation. Independent reimplementation of the publicly
// documented hardware (MAME's src/mame/atari/bzone.cpp bzone_map and
// bzone_interrupt), not a code port.
class Battlezone {
  constructor() {
    this.mem = new Uint8Array(0x8000); // vector RAM ($2000) + vector/program ROM ($3000-$7fff)
    this.ram = new Uint8Array(0x400);  // 1KB main RAM, $0000-$03ff
    this.cpu = new M6502();
    this.cpu.read = (addr) => this.read(addr);
    this.cpu.write = (addr, val) => this.write(addr, val);
    this.avg = new AVG(this.mem, 0x2000);
    this.mathbox = new MathBox();
    this.pokey = new Pokey();

    this.coin1 = false;
    this.coin2 = false;
    // IN3 bits: 0 rightDown, 1 rightUp, 2 leftDown, 3 leftUp, 4 fire,
    // 5 start1, 6 start2, 7 unused. All active-high.
    this.in3 = 0;
    this.dsw0 = 0x15; // 3 lives, missile at 10000, bonus 15k/100k, English
    this.dsw1 = 0x03; // 1 coin 1 credit (see bzone.cpp's dip table)

    this.onSoundReg = null; // (bits) => void — bzone_sounds_w, see bzone_a.cpp
    this.onStartLed = null; // (on) => void

    this.cyclesPerFrame = 25200; // 1.512MHz / 60Hz — same clock as Lunar Lander
    this.nmiPeriod = 6144;
    this.nextNmiCycle = this.nmiPeriod;
    this.avgDoneAtCycle = 0;
  }

  loadRoms() {
    decodeRoms(this.mem);
    this.avg.loadProm(decodeAvgProm());
  }

  reset() {
    this.ram.fill(0);
    this.avg.reset();
    this.mathbox.reset();
    this.pokey.reset();
    this.cpu.reset();
    this.nextNmiCycle = this.nmiPeriod;
    this.avgDoneAtCycle = 0;
  }

  read(addr) {
    addr &= 0x7FFF;
    if (addr < 0x400) return this.ram[addr];
    if (addr === 0x0800) return this.readIN0();
    if (addr === 0x0a00) return this.dsw0;
    if (addr === 0x0c00) return this.dsw1;
    if (addr === 0x1800) return 0x00; // mathbox status: always done (pure HLE, no busy-wait)
    if (addr === 0x1810) return this.mathbox.lo();
    if (addr === 0x1818) return this.mathbox.hi();
    if (addr >= 0x1820 && addr <= 0x182F) {
      this.pokey.in3 = this.in3;
      return this.pokey.read(addr - 0x1820);
    }
    if (addr >= 0x2000) return this.mem[addr];
    return 0xFF;
  }

  write(addr, val) {
    addr &= 0x7FFF;
    val &= 0xFF;
    if (addr < 0x400) { this.ram[addr] = val; return; }
    if (addr === 0x1000) return; // coin counter, no gameplay effect
    if (addr === 0x1200) {
      this.avg.go();
      this.avgDoneAtCycle = this.cpu.cycles + this.avg.busyCpuCycles;
      return;
    }
    if (addr === 0x1400) return; // watchdog reset, no-op
    if (addr === 0x1600) {
      this.avg.resetStrobe();
      this.avgDoneAtCycle = this.cpu.cycles; // done immediately, unlike go
      return;
    }
    if (addr >= 0x1820 && addr <= 0x182F) { this.pokey.write(addr - 0x1820, val); return; }
    if (addr === 0x1840) {
      if (this.onStartLed) this.onStartLed(!!(val & 0x40));
      if (this.onSoundReg) this.onSoundReg(val);
      return;
    }
    if (addr >= 0x1860 && addr <= 0x187F) { this.mathbox.go(addr - 0x1860, val); return; }
    if (addr >= 0x2000 && addr <= 0x2FFF) { this.mem[addr] = val; return; }
    // $3000-$7fff is ROM; writes are harmless no-ops
  }

  readIN0() {
    let v = 0xFF; // coin bits active-low (default not-inserted=1); rest idle-high
    if (this.coin1) v &= ~0x01;
    if (this.coin2) v &= ~0x02;
    if (this.getAvgBusy()) v &= ~0x40;      // bit6: AVG done (low while busy)
    if (!(this.cpu.cycles & 0x100)) v &= ~0x80; // bit7: 3kHz clock source
    return v & 0xFF;
  }

  getAvgBusy() { return this.cpu.cycles < this.avgDoneAtCycle; }

  runFrame() {
    const cpu = this.cpu;
    const target = cpu.cycles + this.cyclesPerFrame;
    while (cpu.cycles < target) {
      cpu.step();
      if (cpu.cycles >= this.nextNmiCycle) {
        // NMI is suppressed only while the self-test/service switch is held;
        // we never simulate that switch being held, so it always fires.
        cpu.nmi();
        this.nextNmiCycle += this.nmiPeriod;
      }
    }
    cpu.cycles -= this.cyclesPerFrame;
    this.nextNmiCycle -= this.cyclesPerFrame;
    this.avgDoneAtCycle -= this.cyclesPerFrame;
  }

  setCoin1(on) { this.coin1 = on; }
  setCoin2(on) { this.coin2 = on; }
  _setIn3Bit(bit, on) { if (on) this.in3 |= (1 << bit); else this.in3 &= ~(1 << bit); }
  setRightDown(on) { this._setIn3Bit(0, on); }
  setRightUp(on) { this._setIn3Bit(1, on); }
  setLeftDown(on) { this._setIn3Bit(2, on); }
  setLeftUp(on) { this._setIn3Bit(3, on); }
  setFire(on) { this._setIn3Bit(4, on); }
  setStart1(on) { this._setIn3Bit(5, on); }
  setStart2(on) { this._setIn3Bit(6, on); }
}
