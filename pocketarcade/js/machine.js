'use strict';

// Space Invaders machine hardware
class SpaceInvaders {
  constructor() {
    this.cpu = new I8080();
    this.cpu.onIn  = (port) => this.portIn(port);
    this.cpu.onOut = (port, val) => this.portOut(port, val);

    // Shift register hardware
    this.shiftReg = 0;     // 16-bit shift register
    this.shiftAmt = 0;     // bits 0-2 from port 2

    // I/O port state
    this.port1 = 0x08;     // bit 3 always 1; starts with no buttons
    this.port2 = 0x00;

    // Sound callbacks
    this.onSound = null;   // function(channel, on)
    this.prevSnd3 = 0;
    this.prevSnd5 = 0;

    // Timing
    this.cyclesPerFrame = 33333;
    this.halfCycles = this.cyclesPerFrame >> 1;
  }

  loadRoms() {
    decodeRoms(this.cpu.mem);
  }

  portIn(port) {
    switch (port) {
      case 0: return 0x0E;  // port 0: mostly unused
      case 1: return this.port1;
      case 2: return this.port2;
      case 3: return (this.shiftReg >> (8 - this.shiftAmt)) & 0xFF;
    }
    return 0;
  }

  portOut(port, val) {
    switch (port) {
      case 2: this.shiftAmt = val & 0x07; break;
      case 3: this.fireSound(3, val); break;
      case 4:
        this.shiftReg = ((val << 8) | (this.shiftReg >> 8)) & 0xFFFF;
        break;
      case 5: this.fireSound(5, val); break;
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

  // Override wb to handle RAM mirror
  reset() {
    this.cpu.mem.fill(0, 0x2000);
    this.cpu.pc = 0; this.cpu.sp = 0;
    this.cpu.halted = false; this.cpu.inte = false;
    this.cpu.cycles = 0;
    this.prevSnd3 = 0; this.prevSnd5 = 0;
    this.shiftReg = 0; this.shiftAmt = 0;
    this.port1 = 0x08; this.port2 = 0x00;
  }

  // Run one full frame (2 half-frames with RST interrupts)
  runFrame() {
    const cpu = this.cpu;
    const start = cpu.cycles;

    // First half: run until half-frame, fire RST 1
    while ((cpu.cycles - start) < this.halfCycles) {
      if (!cpu.halted) cpu.step();
      else cpu.cycles += 4;
    }
    cpu.interrupt(0x08); // RST 1

    // Second half: run until full frame, fire RST 2
    while ((cpu.cycles - start) < this.cyclesPerFrame) {
      if (!cpu.halted) cpu.step();
      else cpu.cycles += 4;
    }
    cpu.interrupt(0x10); // RST 2

    // Normalize cycles counter to prevent overflow
    cpu.cycles -= this.cyclesPerFrame;
  }

  get vram() {
    // VRAM starts at 0x2400, 7168 bytes
    return this.cpu.mem.subarray(0x2400, 0x4000);
  }

  // Render VRAM to ImageData (256x224, landscape)
  // VRAM col = screen Y, VRAM row = screen X
  render(imageData) {
    const vram = this.vram;
    const data = imageData.data;
    const W = 256, H = 224;
    for (let cy = 0; cy < H; cy++) {
      const col = cy;           // VRAM column = screen Y
      const base = col << 5;   // col * 32
      for (let cx = 0; cx < W; cx++) {
        const row = cx;         // VRAM row = screen X
        const lit = (vram[base | (row >> 3)] >> (row & 7)) & 1;
        const off = (cy * W + cx) << 2;
        if (lit) {
          // Color overlay matching original cabinet cellophane strips
          let r = 255, g = 255, b = 255;
          if (cy >= 32 && cy < 64) { r = 255; g = 50; b = 50; }   // red: UFO row
          else if (cy >= 64 && cy < 184) { r = 50; g = 255; b = 80; } // green: invaders
          data[off] = r; data[off+1] = g; data[off+2] = b; data[off+3] = 255;
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
