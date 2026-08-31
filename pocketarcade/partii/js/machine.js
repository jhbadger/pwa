'use strict';

// Space Invaders Part II machine hardware (Taito, 1979)
// Same 8080 core and mb14241 shift register as the original board, plus a
// color PROM board: two 8x8-cell color maps (one per player) instead of the
// fixed cellophane-strip overlay the 1978 board used.
class SpaceInvadersPartII {
  constructor() {
    this.cpu = new I8080();
    this.cpu.onIn  = (port) => this.portIn(port);
    this.cpu.onOut = (port, val) => this.portOut(port, val);

    // pv05 (0x4000-0x47FF) is a second ROM bank sitting above the RAM
    // window; the stock wb() only protects addresses below 0x2000, so
    // guard this extra bank too or the game could scribble over its own code.
    this.cpu.wb = (a, v) => {
      a &= 0xFFFF;
      if (a >= 0x2000 && !(a >= 0x4000 && a < 0x4800)) this.cpu.mem[a] = v & 0xFF;
    };

    // Shift register hardware (mb14241, shared with the original board)
    this.shiftReg = 0;
    this.shiftAmt = 0;

    // I/O port state
    this.port1 = 0x08;
    this.port2 = 0x00;

    // Color board state, both driven by port 5 bit 5 on real hardware
    this.colorMap = false;  // false = pv06.1 (P1 map), true = pv07.2 (P2 map)
    this.screenRed = false; // forces every lit pixel red (hit-flash effect)

    // Sound callbacks
    this.onSound = null;
    this.prevSnd3 = 0;
    this.prevSnd5 = 0;

    // Timing
    this.cyclesPerFrame = 33333;
    this.halfCycles = this.cyclesPerFrame >> 1;
  }

  loadRoms() {
    decodeRoms(this.cpu.mem);
    this.colorProm = decodeColorProm();
  }

  portIn(port) {
    switch (port) {
      case 0: return 0xF4;  // IN0: fixed/DIP bits, nothing we expose is wired up
      case 1: return this.port1;
      case 2: return this.port2;
      case 3: return (this.shiftReg >> (8 - this.shiftAmt)) & 0xFF;
    }
    return 0;
  }

  portOut(port, val) {
    switch (port) {
      case 2: this.shiftAmt = val & 0x07; break;
      case 3:
        this.screenRed = !!(val & 0x04);
        this.fireSound(3, val);
        break;
      case 4:
        this.shiftReg = ((val << 8) | (this.shiftReg >> 8)) & 0xFFFF;
        break;
      case 5:
        this.colorMap = !!(val & 0x20);
        this.fireSound(5, val);
        break;
      case 6: break; // watchdog
    }
  }

  fireSound(port, val) {
    if (!this.onSound) return;
    const prev = port === 3 ? this.prevSnd3 : this.prevSnd5;
    const changed = (prev ^ val);
    for (let bit = 0; bit < 8; bit++) {
      if (changed & (1 << bit)) {
        const ch = port === 3 ? bit : (8 + bit);
        this.onSound(ch, !!(val & (1 << bit)));
      }
    }
    if (port === 3) this.prevSnd3 = val;
    else this.prevSnd5 = val;
  }

  reset() {
    // Clear work RAM + video RAM only — pv05 lives at 0x4000-0x47FF and
    // must survive a reset, so don't blanket-fill from 0x2000 like the
    // original board's memory map allows.
    this.cpu.mem.fill(0, 0x2000, 0x4000);
    this.cpu.mem.fill(0, 0x4800);
    this.cpu.pc = 0; this.cpu.sp = 0;
    this.cpu.halted = false; this.cpu.inte = false;
    this.cpu.cycles = 0;
    this.prevSnd3 = 0; this.prevSnd5 = 0;
    this.shiftReg = 0; this.shiftAmt = 0;
    this.port1 = 0x08; this.port2 = 0x00;
    this.colorMap = false; this.screenRed = false;
  }

  runFrame() {
    const cpu = this.cpu;
    const start = cpu.cycles;

    while ((cpu.cycles - start) < this.halfCycles) {
      if (!cpu.halted) cpu.step();
      else cpu.cycles += 4;
    }
    cpu.interrupt(0x08); // RST 1

    while ((cpu.cycles - start) < this.cyclesPerFrame) {
      if (!cpu.halted) cpu.step();
      else cpu.cycles += 4;
    }
    cpu.interrupt(0x10); // RST 2

    cpu.cycles -= this.cyclesPerFrame;
  }

  get vram() {
    return this.cpu.mem.subarray(0x2400, 0x4000);
  }

  // Render VRAM to ImageData (224x256, portrait). Pixel layout matches the
  // original board exactly (col = screen X, vram row = H-1-screenY); colors
  // come from the real color PROM instead of a hand-picked overlay: each
  // 8x8-pixel cell looks up a 3-bit RBG pen (R=bit0, B=bit1, G=bit2).
  render(imageData) {
    const vram = this.vram;
    const prom = this.colorProm;
    const promBase = this.colorMap ? 0x400 : 0x000;
    const data = imageData.data;
    const W = 224, H = 256;
    for (let cy = 0; cy < H; cy++) {
      const row = (H - 1) - cy;
      const byteIdx = row >> 3;
      const bitIdx = row & 7;
      for (let cx = 0; cx < W; cx++) {
        const col = cx;
        const base = col << 5;
        const lit = (vram[base | byteIdx] >> bitIdx) & 1;
        const off = (cy * W + cx) << 2;
        if (lit) {
          let pen;
          if (this.screenRed) {
            pen = 1; // hit-flash: everything red, ignore the color PROM
          } else {
            const colorAddr = promBase | (((col >> 3) + 4) << 5) | byteIdx;
            pen = prom[colorAddr] & 0x07;
          }
          data[off]   = (pen & 1) ? 255 : 0; // R
          data[off+1] = (pen & 4) ? 255 : 0; // G
          data[off+2] = (pen & 2) ? 255 : 0; // B
          data[off+3] = 255;
        } else {
          data[off] = 0; data[off+1] = 0; data[off+2] = 0; data[off+3] = 255;
        }
      }
    }
  }

  // Input helpers
  setPort1(bit, on) {
    if (on) this.port1 |= (1 << bit);
    else    this.port1 &= ~(1 << bit);
  }
  setPort2(bit, on) {
    if (on) this.port2 |= (1 << bit);
    else    this.port2 &= ~(1 << bit);
  }
}
