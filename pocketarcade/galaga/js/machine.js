'use strict';

// Galaga (Namco, 1981) machine hardware: three Z80 CPUs sharing one address
// bus and RAM (each with its own private 16K ROM window at $0000-$3fff, and
// otherwise seeing identical memory-mapped hardware), a Namco WSG 3-voice
// wavetable sound chip, a Namco 06XX bus controller relaying the main CPU to
// the 51XX (coin/credit/joystick I/O) and 54XX (sound-effect trigger) chips,
// and a Namco 05XX LFSR starfield generator layered under an 8x8 tile
// foreground and 16x16 sprites. Memory map, chip wiring, video decode, and
// the 05XX star algorithm are transcribed from MAME's
// src/mame/namco/galaga.cpp, galaga_v.cpp and starfield_05xx.cpp — an
// independent reimplementation of that publicly documented hardware, not a
// code port. The 51XX/54XX chips are real MB8843/MB8844 MCUs on actual
// silicon, but this exact "galaga" romset (a pre-2000s dump) never included
// their MCU ROMs, so — matching how period-accurate MAME ran this same
// romset before those dumps existed — they're implemented here as the
// documented command/response protocol rather than simulated silicon; see
// namco51.js/namco54.js for details.

// Reproduces MAME's compute_resistor_weights() closely enough for this
// board's two palette circuits: the main 32-color palette (no separate
// pulldown — each bit's own resistor doubles as the others' pulldown when
// off) and the 64-color starfield palette (red/green channels have an
// additional shared 1000-ohm pulldown that blue doesn't, per the "r/g low
// bit is n/c and effectively becomes a pulldown" comment in galaga_v.cpp).
function computeResistorWeights(maxval, channelResistances, channelPulldowns) {
  const pds = channelPulldowns || channelResistances.map(() => 0);
  const raw = channelResistances.map((resistances, ci) => {
    const n = resistances.length;
    const pd = pds[ci];
    const w = new Array(n);
    for (let i = 0; i < n; i++) {
      const r1 = resistances[i];
      let r0cond = pd ? 1 / pd : 0;
      for (let j = 0; j < n; j++) if (j !== i) r0cond += 1 / resistances[j];
      const r0 = r0cond ? 1 / r0cond : Infinity;
      w[i] = maxval * r0 / (r0 + r1);
    }
    return w;
  });
  const maxOut = Math.max(...raw.map(w => w.reduce((a, b) => a + b, 0)));
  const scale = maxval / maxOut;
  return raw.map(w => w.map(x => x * scale));
}

function combineWeights(weights, bits) {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) if (bits[i]) sum += weights[i];
  return Math.round(sum);
}

// gfx_layout bit-offset tables transcribed from galaga.cpp's charlayout_2bpp
// / spritelayout_galaga (see file header). Tiles use the same 2bpp nibble-
// pair layout as Pac-Man's tile ROM (identical offsets); sprites use a
// different pixel-column order than Pac-Man's.
const TILE_XOFF = [64, 65, 66, 67, 0, 1, 2, 3];
const TILE_YOFF = [0, 8, 16, 24, 32, 40, 48, 56];
const SPR_XOFF = [0, 1, 2, 3, 64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195];
const SPR_YOFF = [0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312];

function getBit(data, base, bitIndex) {
  return (data[base + (bitIndex >> 3)] >> (7 - (bitIndex & 7))) & 1;
}

// Plane order matches MAME's gfx_element::decode(): the FIRST listed plane
// (offset+0) contributes the HIGH bit of the pen, the second (offset+4) the
// low bit.
function decodeTile(data, base, out) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const bi0 = TILE_YOFF[row] + TILE_XOFF[col];
      const p0 = getBit(data, base, bi0);
      const p1 = getBit(data, base, bi0 + 4);
      out[row * 8 + col] = p1 | (p0 << 1);
    }
  }
}

function decodeSprite(data, base, out) {
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const bi0 = SPR_YOFF[row] + SPR_XOFF[col];
      const p0 = getBit(data, base, bi0);
      const p1 = getBit(data, base, bi0 + 4);
      out[row * 16 + col] = p1 | (p0 << 1);
    }
  }
}

// Galaga's videoram packs a 32-row-addressable space into a 36-wide
// tilemap the same way Pac-Man's does (see pacman/js/machine.js's
// pacmanTilemapIndex) — transcribed from galaga_v.cpp's tilemap_scan.
function galagaTilemapIndex(col, row) {
  row += 2; col -= 2;
  if (col & 0x20) return row + ((col & 0x1F) << 5);
  return col + (row << 5);
}

function setPixel(buf, stride, x, y, rgb) {
  const off = (y * stride + x) * 3;
  buf[off] = rgb[0]; buf[off + 1] = rgb[1]; buf[off + 2] = rgb[2];
}

// Namco 05XX starfield generator: a 16-bit Fibonacci LFSR (taps 0,3,5,10)
// clocked once per starfield pixel, with hits at a fixed bit pattern
// producing a star in one of 4 color/position "sets" (2 of which are active
// at a time). Ported directly from starfield_05xx.cpp's documented
// algorithm and constants — see that file's extensive header comment for
// the hardware rationale.
const LFSR_SEED = 0x7FFF;
const LFSR_HIT_MASK = 0xFA14;
const LFSR_HIT_VALUE = 0x7800;
const SPEED_X_OFFSET = [0, 1, 2, 3, -4, -3, -2, -1];
const PRE_VIS_CYCLES = [22, 23, 22, 23, 19, 20, 20, 22].map(n => n * 256);
const POST_VIS_CYCLES = [10, 10, 12, 12, 9, 9, 10, 9].map(n => n * 256);

class Starfield {
  constructor(offsetX, offsetY, limitX) {
    this.offsetX = offsetX; this.offsetY = offsetY; this.limitX = limitX;
    this.enable = 0;
    this.lfsr = LFSR_SEED;
    this.preVis = 0; this.postVis = 0;
    this.setA = 0; this.setB = 0;
  }

  setEnable(on) {
    if (!on) this.lfsr = LFSR_SEED; // _STARCLR resets the LFSR every time it's asserted
    this.enable = on ? 1 : 0;
  }

  setScrollSpeed(indexX, indexY) {
    this.preVis = PRE_VIS_CYCLES[indexY] + SPEED_X_OFFSET[indexX];
    this.postVis = POST_VIS_CYCLES[indexY];
  }

  setActiveSets(setA, setB) { this.setA = setA; this.setB = setB; }

  nextLfsr(lfsr) {
    const bit = ((lfsr >> 0) ^ (lfsr >> 3) ^ (lfsr >> 5) ^ (lfsr >> 10)) & 1;
    return ((lfsr >>> 1) | (bit << 15)) & 0xFFFF;
  }

  draw(native, stride, starColor) {
    if (!this.enable) return;
    let pre = this.preVis, post = this.postVis;
    while (pre-- > 0) this.lfsr = this.nextLfsr(this.lfsr);

    for (let y = this.offsetY; y < 224 + this.offsetY; y++) {
      for (let x = this.offsetX; x < 256 + this.offsetX; x++) {
        if ((this.lfsr & LFSR_HIT_MASK) === LFSR_HIT_VALUE) {
          const starSet = (((this.lfsr >> 10) & 1) << 1) | ((this.lfsr >> 8) & 1);
          if ((this.setA === starSet || this.setB === starSet) && x < this.limitX) {
            let color = (this.lfsr >> 5) & 0x7;
            color |= (this.lfsr << 3) & 0x18;
            color |= (this.lfsr << 2) & 0x20;
            color = (~color) & 0x3F;
            setPixel(native, stride, x, y, starColor[color]);
          }
        }
        this.lfsr = this.nextLfsr(this.lfsr);
      }
    }

    while (post-- > 0) this.lfsr = this.nextLfsr(this.lfsr);
  }
}

class Galaga {
  constructor() {
    this.cpu1Rom = new Uint8Array(0x4000);
    this.cpu2Rom = new Uint8Array(0x4000);
    this.cpu3Rom = new Uint8Array(0x4000);

    this.videoram = new Uint8Array(0x800); // tile codes [0-0x3ff] + color attrs [0x400-0x7ff]
    this.ram1 = new Uint8Array(0x400);     // work RAM + sprite regs at 0x380-0x3ff
    this.ram2 = new Uint8Array(0x400);
    this.ram3 = new Uint8Array(0x400);

    this.dswA = 0xF7; // easy, demo sounds on, freeze/rack-test off, upright
    this.dswB = 0x97; // 1 coin 1 credit, 20k/70k/every 70k bonus, 3 lives

    // IN0L: bit0 fire1, 1 fire2, 2 start1, 3 start2 (active-low)
    // IN0H: bit0 coin1, 1 coin2, 2 service1, 3 service-dip (test switch)
    // IN1L: bit1 joyRight1, bit3 joyLeft1     IN1H: bit1 joyRight2, bit3 joyLeft2
    this.in0L = 0xF; this.in0H = 0xF; this.in1L = 0xF; this.in1H = 0xF;

    this.misclatch = 0;
    this.mainIrqMask = false;
    this.subIrqMask = false;
    this.sub2NmiMask = false;
    this.cpu23Held = true; // reset line held at power-on until the main CPU releases it

    this.videolatch = 0;

    this.wsgRegs = new Uint8Array(0x20);
    this.voice = [
      { freq: 0, waveform: 0, volume: 0 },
      { freq: 0, waveform: 0, volume: 0 },
      { freq: 0, waveform: 0, volume: 0 },
    ];
    this.onVoice = null;       // (ch, freq, waveform, volume) => void
    this.onSoundEffect = null; // (type: 'A'|'B'|'C', volume) => void

    this.io06Control = 0;
    this.io06NmiPeriod = 0; // in cpu1 Z80 cycles; 0 = disabled
    this.io06NextNmi = 0;
    this.cpu1Cycles = 0;

    this.frameCounter = 0;
    this.namco51 = new Namco51(
      (n) => [this.in0L, this.in0H, this.in1L, this.in1H][n],
      () => {}, // LED/coin-lockout outputs: cosmetic only, no physical equivalent here
      () => (this.frameCounter & 0x10) ? 1 : 0,
    );
    this.namco54 = new Namco54((type, volume) => { if (this.onSoundEffect) this.onSoundEffect(type, volume); });

    this.starfield = new Starfield(16, 0, 272);

    this.cyclesPerFrame = 50688; // (384*264)/2 — pixel clock is 2x Z80 clock, same as Pac-Man

    this.cpu1 = Z80({ mem_read: (a) => this.read(0, a), mem_write: (a, v) => this.write(0, a, v), io_read: () => 0xFF, io_write: () => {} });
    this.cpu2 = Z80({ mem_read: (a) => this.read(1, a), mem_write: (a, v) => this.write(1, a, v), io_read: () => 0xFF, io_write: () => {} });
    this.cpu3 = Z80({ mem_read: (a) => this.read(2, a), mem_write: (a, v) => this.write(2, a, v), io_read: () => 0xFF, io_write: () => {} });
  }

  loadRoms() {
    const d = decodeGalagaRoms();
    this.cpu1Rom = d.cpu1; this.cpu2Rom = d.cpu2; this.cpu3Rom = d.cpu3;

    this.tiles = new Uint8Array(256 * 64);
    for (let i = 0; i < 256; i++) decodeTile(d.gfxTiles, i * 16, this.tiles.subarray(i * 64, i * 64 + 64));
    this.sprites = new Uint8Array(128 * 256);
    for (let i = 0; i < 128; i++) decodeSprite(d.gfxSprites, i * 64, this.sprites.subarray(i * 256, i * 256 + 256));

    this.buildPalette(d.proms);
    this.wsgWave = d.wsgProm; // 8 waveforms x 32 4-bit samples, read by audio.js
  }

  buildPalette(proms) {
    // proms layout matches MAME's ROM_REGION load order: palette(0x20) +
    // char lookup(0x100) + sprite lookup(0x100)
    const [rw, gw, bw] = computeResistorWeights(255, [[1000, 470, 220], [1000, 470, 220], [470, 220]]);
    this.palette = [];
    for (let i = 0; i < 32; i++) {
      const byte = proms[i];
      this.palette.push([
        combineWeights(rw, [byte & 1, (byte >> 1) & 1, (byte >> 2) & 1]),
        combineWeights(gw, [(byte >> 3) & 1, (byte >> 4) & 1, (byte >> 5) & 1]),
        combineWeights(bw, [(byte >> 6) & 1, (byte >> 7) & 1]),
      ]);
    }

    this.charColorTable = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.charColorTable[i] = (proms[0x20 + i] & 0x0F) | 0x10;
    this.spriteColorTable = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.spriteColorTable[i] = proms[0x120 + i] & 0x0F;

    const [rsw, gsw, bsw] = computeResistorWeights(255, [[470, 220], [470, 220], [470, 220]], [1000, 1000, 0]);
    this.starColor = [];
    for (let i = 0; i < 64; i++) {
      this.starColor.push([
        combineWeights(rsw, [i & 1, (i >> 1) & 1]),
        combineWeights(gsw, [(i >> 2) & 1, (i >> 3) & 1]),
        combineWeights(bsw, [(i >> 4) & 1, (i >> 5) & 1]),
      ]);
    }
  }

  reset() {
    this.videoram.fill(0);
    this.ram1.fill(0);
    this.ram2.fill(0);
    this.ram3.fill(0);
    this.wsgRegs.fill(0);
    this.misclatch = 0;
    this.mainIrqMask = false;
    this.subIrqMask = false;
    this.sub2NmiMask = false;
    this.cpu23Held = true;
    this.videolatch = 0;
    this.io06Control = 0;
    this.io06NmiPeriod = 0;
    this.io06NextNmi = 0;
    this.cpu1Cycles = 0;
    this.frameCounter = 0;
    this.namco51.reset();
    this.namco54.reset();
    this.starfield.lfsr = LFSR_SEED;
    this.starfield.enable = 0;
    this.cpu1.reset();
    this.cpu2.reset();
    this.cpu3.reset();
  }

  // ── Shared memory/IO decode — identical for all 3 CPUs except the
  // $0000-$3fff ROM window, exactly matching galaga_map being reused
  // verbatim for all three CPU configs in the real hardware. ──
  romFor(cpu) { return cpu === 0 ? this.cpu1Rom : (cpu === 1 ? this.cpu2Rom : this.cpu3Rom); }

  read(cpu, addr) {
    addr &= 0xFFFF;
    if (addr < 0x4000) return this.romFor(cpu)[addr];
    if (addr >= 0x6800 && addr <= 0x6807) {
      const bit0 = (this.dswB >> (addr & 7)) & 1;
      const bit1 = (this.dswA >> (addr & 7)) & 1;
      return bit0 | (bit1 << 1);
    }
    // Mirrored across 8 addresses like the other 06xx-adjacent chip
    // selects on this bus (DSW, WSG, misclatch, videolatch) — the ROM's
    // namco51/54 multi-byte transfers use LDI, which walks DE across
    // consecutive addresses on every pulse, so the real decode can't be
    // wired to a single exact address or every byte past the first would
    // land outside the chip select and be dropped.
    if (addr >= 0x7000 && addr <= 0x7007) return this.io06DataRead();
    if (addr >= 0x7100 && addr <= 0x7107) return this.io06Control;
    if (addr >= 0x8000 && addr < 0x8800) return this.videoram[addr - 0x8000];
    if (addr >= 0x8800 && addr < 0x8C00) return this.ram1[addr - 0x8800];
    if (addr >= 0x9000 && addr < 0x9400) return this.ram2[addr - 0x9000];
    if (addr >= 0x9800 && addr < 0x9C00) return this.ram3[addr - 0x9800];
    return 0xFF;
  }

  write(_cpu, addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    if (addr < 0x4000) return; // ROM
    if (addr >= 0x6800 && addr <= 0x681F) { this.wsgWrite(addr - 0x6800, val); return; }
    if (addr >= 0x6820 && addr <= 0x6827) { this.misclatchWrite(addr - 0x6820, val); return; }
    if (addr === 0x6830) return; // watchdog, no-op
    if (addr >= 0x7000 && addr <= 0x7007) { this.io06DataWrite(val); return; }
    if (addr >= 0x7100 && addr <= 0x7107) { this.io06ControlWrite(val); return; }
    if (addr >= 0x8000 && addr < 0x8800) { this.videoram[addr - 0x8000] = val; return; }
    if (addr >= 0x8800 && addr < 0x8C00) { this.ram1[addr - 0x8800] = val; return; }
    if (addr >= 0x9000 && addr < 0x9400) { this.ram2[addr - 0x9000] = val; return; }
    if (addr >= 0x9800 && addr < 0x9C00) { this.ram3[addr - 0x9800] = val; return; }
    if (addr >= 0xA000 && addr <= 0xA007) { this.videolatchWrite(addr - 0xA000, val); return; }
  }

  // 74LS259-style addressable latch: writes D0 to the bit selected by
  // (addr & 7); side effects only fire on an actual change.
  misclatchWrite(bit, val) {
    const newBit = val & 1;
    const oldBit = (this.misclatch >> bit) & 1;
    this.misclatch = (this.misclatch & ~(1 << bit)) | (newBit << bit);
    if (newBit === oldBit) return;
    if (bit === 0) this.mainIrqMask = !!newBit;
    else if (bit === 1) this.subIrqMask = !!newBit;
    else if (bit === 2) this.sub2NmiMask = !newBit; // inverted, per nmion_w
    else if (bit === 3) {
      if (newBit) { this.cpu23Held = false; }
      else {
        this.cpu23Held = true;
        this.cpu2.reset(); this.cpu3.reset();
        this.namco51.reset(); this.namco54.reset();
      }
    }
  }

  videolatchWrite(bit, val) {
    const newBit = val & 1;
    const oldBit = (this.videolatch >> bit) & 1;
    this.videolatch = (this.videolatch & ~(1 << bit)) | (newBit << bit);
    if (newBit === oldBit) return;
    if (bit === 5) this.starfield.setEnable(newBit); // _STARCLR
    // bits 0-2 (scroll speed) and 3-4 (active star sets) are read fresh at
    // render time; bit 7 (flip screen) isn't supported (upright only).
  }

  // ── Namco 06XX bus controller: relays the main CPU to 51XX (select 0)
  // and 54XX (select 3), and drives a periodic NMI back to the main CPU
  // while a chip is selected, at a rate set by the control register's
  // divisor bits. See namco06.cpp's header comment for the wire protocol
  // this reproduces. ──
  io06ControlWrite(data) {
    this.io06Control = data;
    const divBits = (data >> 5) & 7;
    if (divBits === 0) {
      this.io06NmiPeriod = 0;
    } else {
      // Base NMI clock is cpu1_clock/64; the control register's top 3 bits
      // further divide it. One full pulse cycle takes 64*divisor cpu1
      // cycles (see file header for the derivation).
      this.io06NmiPeriod = 64 * (1 << divBits);
      this.io06NextNmi = this.cpu1Cycles + this.io06NmiPeriod;
    }
  }

  io06DataRead() {
    if (!(this.io06Control & 0x10)) return 0; // write mode; reading is invalid
    let result = 0xFF;
    if (this.io06Control & 0x01) result &= this.namco51.read();
    return result;
  }

  io06DataWrite(data) {
    if (this.io06Control & 0x10) return; // read mode; writing is invalid
    if (this.io06Control & 0x01) this.namco51.write(data);
    if (this.io06Control & 0x08) this.namco54.write(data);
  }

  checkIo06Nmi() {
    if (this.io06NmiPeriod === 0) return;
    if (this.cpu1Cycles >= this.io06NextNmi) {
      this.cpu1.interrupt(true);
      this.io06NextNmi += this.io06NmiPeriod;
    }
  }

  // Same register layout as Pac-Man's WSG (see pacman/js/machine.js's
  // wsgWrite) — Galaga uses the identical namco_wsg_device::pacman_sound_w.
  wsgWrite(offset, val) {
    val &= 0x0F;
    if (this.wsgRegs[offset] === val) return;
    this.wsgRegs[offset] = val;
    let ch;
    if (offset < 0x10) ch = Math.floor((offset - 5) / 5);
    else if (offset === 0x10) ch = 0;
    else ch = Math.floor((offset - 0x11) / 5);
    if (ch < 0 || ch >= 3) return;
    const rel = offset - ch * 5;
    const v = this.voice[ch];
    if (rel === 5) {
      v.waveform = val & 7;
    } else if (rel >= 0x10 && rel <= 0x14) {
      let freq = (ch === 0) ? this.wsgRegs[0x10] : 0;
      freq += this.wsgRegs[ch * 5 + 0x11] << 4;
      freq += this.wsgRegs[ch * 5 + 0x12] << 8;
      freq += this.wsgRegs[ch * 5 + 0x13] << 12;
      freq += this.wsgRegs[ch * 5 + 0x14] << 16;
      v.freq = freq;
    } else if (rel === 0x15) {
      v.volume = val;
    } else {
      return;
    }
    if (this.onVoice) this.onVoice(ch, v.freq, v.waveform, v.volume);
  }

  // ── Frame execution: round-robin the 3 CPUs in small slices (matching
  // MAME's set_maximum_quantum(6000Hz) ≈ 512 cpu1-cycle slices) so their
  // shared-RAM mailbox protocols resolve within the frame the same way
  // they would running near-simultaneously on real hardware — running each
  // CPU serially to completion for a whole frame at a time can leave one
  // CPU spin-waiting on a flag another hasn't set yet. CPU2/3 stay parked
  // (not run at all) while held in reset. One simplification: unlike the
  // persistent cycle counters elsewhere in this app, each CPU's per-frame
  // budget here is a fresh local value — any cycle overshoot past the
  // frame boundary is simply dropped rather than carried into next frame,
  // a small timing looseness that doesn't affect correctness at this
  // grain. ──
  runFrame() {
    const SLICE = 512;
    const budget = [this.cyclesPerFrame, this.cyclesPerFrame, this.cyclesPerFrame];
    const cpus = [this.cpu1, this.cpu2, this.cpu3];
    let cpu3FrameCycles = 0;
    let cpu3Nmi1Fired = false, cpu3Nmi2Fired = false;

    let active = true;
    while (active) {
      active = false;
      for (let i = 0; i < 3; i++) {
        if (budget[i] <= 0) continue;
        if (i !== 0 && this.cpu23Held) continue;
        active = true;
        let r = SLICE;
        while (r > 0 && budget[i] > 0) {
          const c = cpus[i].run_instruction();
          r -= c; budget[i] -= c;
          if (i === 0) {
            this.cpu1Cycles += c;
            this.checkIo06Nmi();
          } else if (i === 2) {
            cpu3FrameCycles += c;
            // CPU3's own NMI: pulses at scanlines 64 and 192 of 264 (128
            // apart), driven by a screen-relative timer independent of the
            // 06xx — see galaga.cpp's cpu3_interrupt_callback.
            if (!cpu3Nmi1Fired && cpu3FrameCycles >= 12288) {
              cpu3Nmi1Fired = true;
              if (this.sub2NmiMask) this.cpu3.interrupt(true);
            }
            if (!cpu3Nmi2Fired && cpu3FrameCycles >= 36864) {
              cpu3Nmi2Fired = true;
              if (this.sub2NmiMask) this.cpu3.interrupt(true);
            }
          }
        }
      }
    }

    this.cpu1Cycles -= this.cyclesPerFrame;
    this.io06NextNmi -= this.cyclesPerFrame;

    if (this.mainIrqMask) this.cpu1.interrupt(false);
    if (this.subIrqMask) this.cpu2.interrupt(false);

    this.frameCounter++;
  }

  // ── Input helpers (all active-low: 0 = pressed) ──
  _setBit(which, bit, pressed) {
    this[which] = pressed ? (this[which] & ~(1 << bit)) & 0xF : (this[which] | (1 << bit)) & 0xF;
  }
  setFire1(p) { this._setBit('in0L', 0, p); }
  setFire2(p) { this._setBit('in0L', 1, p); }
  setStart1(p) { this._setBit('in0L', 2, p); }
  setStart2(p) { this._setBit('in0L', 3, p); }
  setCoin1(p) { this._setBit('in0H', 0, p); }
  setCoin2(p) { this._setBit('in0H', 1, p); }
  setService1(p) { this._setBit('in0H', 2, p); }
  setJoyRight1(p) { this._setBit('in1L', 1, p); }
  setJoyLeft1(p) { this._setBit('in1L', 3, p); }
  setJoyRight2(p) { this._setBit('in1H', 1, p); }
  setJoyLeft2(p) { this._setBit('in1H', 3, p); }

  // ── Video: render into a 288x224 native (landscape) RGB framebuffer ──
  drawTilemap(native) {
    const vram = this.videoram, tiles = this.tiles, palette = this.palette, ctab = this.charColorTable;
    for (let ty = 0; ty < 28; ty++) {
      for (let tx = 0; tx < 36; tx++) {
        const idx = galagaTilemapIndex(tx, ty);
        const code = vram[idx] & 0x7F;
        const color = vram[idx + 0x400] & 0x3F;
        const tile = tiles.subarray(code * 64, code * 64 + 64);
        const ctabBase = color * 4;
        const baseX = tx * 8, baseY = ty * 8;
        for (let py = 0; py < 8; py++) {
          const rowOff = (baseY + py) * 288 + baseX;
          for (let px = 0; px < 8; px++) {
            const pen = tile[py * 8 + px];
            if (pen === 0) continue; // transparent — lets sprites/stars show through
            const rgb = palette[ctab[ctabBase + pen]];
            const o = (rowOff + px) * 3;
            native[o] = rgb[0]; native[o + 1] = rgb[1]; native[o + 2] = rgb[2];
          }
        }
      }
    }
  }

  drawSprites(native) {
    const ram1 = this.ram1, ram2 = this.ram2, ram3 = this.ram3, base = 0x380;
    const sprites = this.sprites, palette = this.palette, ctab = this.spriteColorTable;
    const gfxOffs = [[0, 1], [2, 3]];
    for (let offs = 0; offs < 0x80; offs += 2) {
      const spriteCode = ram1[base + offs] & 0x7F;
      const color = ram1[base + offs + 1] & 0x3F;
      const sx0 = ram2[base + offs + 1] - 40 + 0x100 * (ram3[base + offs + 1] & 3);
      let sy0 = 256 - ram2[base + offs] + 1;
      const flipx = ram3[base + offs] & 1;
      const flipy = (ram3[base + offs] >> 1) & 1;
      const sizex = (ram3[base + offs] >> 2) & 1;
      const sizey = (ram3[base + offs] >> 3) & 1;
      sy0 -= 16 * sizey;
      sy0 = (sy0 & 0xFF) - 32;
      const ctabBase = color * 4;
      for (let yy = 0; yy <= sizey; yy++) {
        for (let xx = 0; xx <= sizex; xx++) {
          const code = spriteCode + gfxOffs[yy ^ (sizey * flipy)][xx ^ (sizex * flipx)];
          const sprite = sprites.subarray(code * 256, code * 256 + 256);
          const baseX = sx0 + 16 * xx, baseY = sy0 + 16 * yy;
          for (let py = 0; py < 16; py++) {
            const ny = baseY + py;
            if (ny < 0 || ny >= 224) continue;
            const srcY = flipy ? 15 - py : py;
            for (let px = 0; px < 16; px++) {
              const nx = baseX + px;
              if (nx < 0 || nx >= 288) continue;
              const srcX = flipx ? 15 - px : px;
              const pen = sprite[srcY * 16 + srcX];
              if (pen === 0) continue;
              const rgb = palette[ctab[ctabBase + pen]];
              setPixel(native, 288, nx, ny, rgb);
            }
          }
        }
      }
    }
  }

  render(native) {
    native.fill(0);
    const q = this.videolatch;
    this.starfield.setScrollSpeed(q & 0x7, 0); // Galaga only scrolls X — SCROLL_Y pins tied to ground
    this.starfield.setActiveSets((q >> 3) & 1, ((q >> 4) & 1) | 2);
    this.starfield.draw(native, 288, this.starColor);
    this.drawSprites(native);
    this.drawTilemap(native); // drawn last — text/HUD sits on top
  }
}
