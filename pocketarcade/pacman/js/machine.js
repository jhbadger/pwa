'use strict';

// Pac-Man (Namco, 1980) machine hardware: Z80 CPU, an 8x8 tile background
// (36x28 tiles) plus up to 8 16x16 sprites, and a 3-voice Namco WSG
// wavetable sound chip. Memory map, tile/sprite ROM layout, palette decode,
// and sound register semantics are transcribed from MAME's
// src/mame/pacman/pacman.cpp, pacman_v.cpp and devices/sound/namco.cpp —
// an independent reimplementation of that publicly documented hardware,
// not a code port.

function millmanVoltage(activeResistances, pulldown) {
  let conductance = 1 / pulldown;
  let current = 0;
  for (const r of activeResistances) { conductance += 1 / r; current += 1 / r; }
  return current / conductance;
}

function buildResistorTable(resistances, pulldown) {
  const n = resistances.length;
  const maxVolt = millmanVoltage(resistances, pulldown);
  const table = [];
  for (let v = 0; v < (1 << n); v++) {
    const active = [];
    for (let b = 0; b < n; b++) if (v & (1 << b)) active.push(resistances[b]);
    const volt = active.length ? millmanVoltage(active, pulldown) : 0;
    table.push(Math.round(255 * volt / maxVolt));
  }
  return table;
}

// gfx_layout bit-offset tables (see pacman.cpp's `tilelayout`/`spritelayout`):
// MAME's planar decode numbers bits MSB-first from the start of the region.
const TILE_XOFF = [64, 65, 66, 67, 0, 1, 2, 3];
const TILE_YOFF = [0, 8, 16, 24, 32, 40, 48, 56];
const SPR_XOFF = [64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195, 0, 1, 2, 3];
const SPR_YOFF = [0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312];

function getBit(data, base, bitIndex) {
  return (data[base + (bitIndex >> 3)] >> (7 - (bitIndex & 7))) & 1;
}

function decodeTile(data, base, out) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const bi0 = TILE_YOFF[row] + TILE_XOFF[col];
      const p0 = getBit(data, base, bi0);
      const p1 = getBit(data, base, bi0 + 4);
      out[row * 8 + col] = p0 | (p1 << 1);
    }
  }
}

function decodeSprite(data, base, out) {
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const bi0 = SPR_YOFF[row] + SPR_XOFF[col];
      const p0 = getBit(data, base, bi0);
      const p1 = getBit(data, base, bi0 + 4);
      out[row * 16 + col] = p0 | (p1 << 1);
    }
  }
}

class Pacman {
  constructor() {
    this.rom = new Uint8Array(0x4000);
    this.videoram = new Uint8Array(0x400);
    this.colorram = new Uint8Array(0x400);
    this.ram = new Uint8Array(0x3F0);      // $4c00-$4fef
    this.spriteram = new Uint8Array(0x10); // $4ff0-$4fff: code/color pairs x8
    this.spriteram2 = new Uint8Array(0x10); // $5060-$506f: y/x pairs x8

    // Inputs (all active-low: 1 = not pressed/inactive)
    this.in0 = 0xFF; // bit0 up, 1 left, 2 right, 3 down, 4 rack-test(fixed), 5 coin1, 6 coin2, 7 service1
    this.in1 = 0xFF; // bit0-3 P2 joystick (unused), 4 self-test(fixed), 5 start1, 6 start2, 7 cabinet(fixed)
    this.dsw1 = 0xC9; // 1coin/1credit, 3 lives, bonus 10000, normal difficulty, normal ghost names
    this.dsw2 = 0xFF;

    this.mainlatch = 0;   // bit0 irq_mask, 1 sound_enable, 3 flipscreen, 7 coin_counter
    this.irqMask = false;
    this.soundEnable = false;
    this.flipScreen = false;
    this.interruptVector = 0;

    this.wsgRegs = new Uint8Array(0x20);
    this.voice = [
      { freq: 0, waveform: 0, volume: 0 },
      { freq: 0, waveform: 0, volume: 0 },
      { freq: 0, waveform: 0, volume: 0 },
    ];
    this.onVoice = null; // (ch, freq, waveform, volume) => void
    this.onSoundEnable = null; // (enabled) => void

    this.cyclesPerFrame = 50688; // (384 * 264) / 2 — pixel clock is 2x the Z80 clock

    this.z80 = Z80({
      mem_read: (a) => this.read(a),
      mem_write: (a, v) => this.write(a, v),
      io_read: () => 0xFF,
      io_write: (port, val) => { if ((port & 0xFF) === 0) this.interruptVector = val; },
    });
  }

  loadRoms() {
    decodeRoms(this.rom);
    const gfx = decodeGfx(); // 0x0000-0x0FFF tiles, 0x1000-0x1FFF sprites
    this.tiles = new Uint8Array(256 * 64);
    for (let i = 0; i < 256; i++) decodeTile(gfx, i * 16, this.tiles.subarray(i * 64, i * 64 + 64));
    this.sprites = new Uint8Array(64 * 256);
    for (let i = 0; i < 64; i++) decodeSprite(gfx, 0x1000 + i * 64, this.sprites.subarray(i * 256, i * 256 + 256));
    this.buildPalette();
  }

  buildPalette() {
    const promPalette = decode_palette_7f();      // 32 bytes
    const promColorTable = decode_colortable_4a(); // 256 bytes
    const rTable = buildResistorTable([1000, 470, 220], 470);
    const bTable = buildResistorTable([470, 220], 470);
    this.palette = [];
    for (let i = 0; i < 32; i++) {
      const byte = promPalette[i];
      this.palette.push([
        rTable[byte & 7],
        rTable[(byte >> 3) & 7],
        bTable[(byte >> 6) & 3],
      ]);
    }
    this.colorTable = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.colorTable[i] = promColorTable[i] & 0x0F;
  }

  reset() {
    this.videoram.fill(0);
    this.colorram.fill(0);
    this.ram.fill(0);
    this.spriteram.fill(0);
    this.spriteram2.fill(0);
    this.z80.reset();
    this.mainlatch = 0;
    this.irqMask = false;
    this.soundEnable = false;
    this.flipScreen = false;
    this.interruptVector = 0;
    this.wsgRegs.fill(0);
  }

  read(addr) {
    addr &= 0xFFFF;
    if (addr < 0x4000) return this.rom[addr];
    if (addr < 0x4400) return this.videoram[addr & 0x3FF];
    if (addr < 0x4800) return this.colorram[addr & 0x3FF];
    if (addr < 0x4C00) return 0xBF; // pacman_read_nop: open-bus value the real board returns here
    if (addr < 0x4FF0) return this.ram[addr - 0x4C00];
    if (addr < 0x5000) return this.spriteram[addr - 0x4FF0];
    if (addr === 0x5000) return this.in0;
    if (addr === 0x5040) return this.in1;
    if (addr === 0x5080) return this.dsw1;
    if (addr === 0x50C0) return this.dsw2;
    return 0xFF;
  }

  write(addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    if (addr < 0x4000) return; // ROM
    if (addr < 0x4400) { this.videoram[addr & 0x3FF] = val; return; }
    if (addr < 0x4800) { this.colorram[addr & 0x3FF] = val; return; }
    if (addr < 0x4C00) return;
    if (addr < 0x4FF0) { this.ram[addr - 0x4C00] = val; return; }
    if (addr < 0x5000) { this.spriteram[addr - 0x4FF0] = val; return; }
    if (addr < 0x5008) { this.mainlatchWrite(addr - 0x5000, val); return; }
    if (addr < 0x5040) return;
    if (addr < 0x5060) { this.wsgWrite(addr - 0x5040, val); return; }
    if (addr < 0x5070) { this.spriteram2[addr - 0x5060] = val; return; }
    return; // 5070-50ff: unused/watchdog, no-op
  }

  // 74LS259 addressable latch, written via write_d0 (bit state = D0 of the byte)
  mainlatchWrite(bit, val) {
    const newBit = val & 1;
    const oldBit = (this.mainlatch >> bit) & 1;
    this.mainlatch = (this.mainlatch & ~(1 << bit)) | (newBit << bit);
    if (newBit === oldBit) return;
    if (bit === 0) { this.irqMask = !!newBit; if (!this.irqMask) {/* IRQ line would clear; frame-granular model needs no action */} }
    else if (bit === 1) { this.soundEnable = !!newBit; if (this.onSoundEnable) this.onSoundEnable(this.soundEnable); }
    else if (bit === 3) { this.flipScreen = !!newBit; }
  }

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

  runFrame() {
    let remaining = this.cyclesPerFrame;
    while (remaining > 0) remaining -= this.z80.run_instruction();
    if (this.irqMask) this.z80.interrupt(false, this.interruptVector);
  }

  setIn0(bit, pressed) { if (pressed) this.in0 &= ~(1 << bit); else this.in0 |= (1 << bit); }
  setIn1(bit, pressed) { if (pressed) this.in1 &= ~(1 << bit); else this.in1 |= (1 << bit); }

  // ── Video: render into a 288x224 native (landscape) RGB framebuffer ──────
  drawTilemap(native) {
    const videoram = this.videoram, colorram = this.colorram, tiles = this.tiles, palette = this.palette, ctab = this.colorTable;
    for (let ty = 0; ty < 28; ty++) {
      for (let tx = 0; tx < 36; tx++) {
        const idx = pacmanTilemapIndex(tx, ty);
        const code = videoram[idx];
        const attr = colorram[idx] & 0x1F;
        const tile = tiles.subarray(code * 64, code * 64 + 64);
        const ctabBase = attr * 4;
        const baseX = tx * 8, baseY = ty * 8;
        for (let py = 0; py < 8; py++) {
          const rowOff = (baseY + py) * 288 + baseX;
          for (let px = 0; px < 8; px++) {
            const pen = tile[py * 8 + px];
            const rgb = palette[ctab[ctabBase + pen]];
            const o = (rowOff + px) * 3;
            native[o] = rgb[0]; native[o + 1] = rgb[1]; native[o + 2] = rgb[2];
          }
        }
      }
    }
  }

  drawSprites(native) {
    const spriteram = this.spriteram, spriteram2 = this.spriteram2, sprites = this.sprites, palette = this.palette, ctab = this.colorTable;
    const plot = (offs, yHack) => {
      const code = spriteram[offs] >> 2;
      const flipX = !!(spriteram[offs] & 1);
      const flipY = !!(spriteram[offs] & 2);
      const attr = spriteram[offs + 1] & 0x1F;
      const sx = 272 - spriteram2[offs + 1];
      const sy = spriteram2[offs] - 31 + yHack;
      const sprite = sprites.subarray(code * 256, code * 256 + 256);
      const ctabBase = attr * 4;
      for (let py = 0; py < 16; py++) {
        const ny = sy + py;
        if (ny < 0 || ny >= 224) continue;
        const srcY = flipY ? 15 - py : py;
        for (let px = 0; px < 16; px++) {
          const pen = sprite[srcY * 16 + (flipX ? 15 - px : px)];
          if (pen === 0) continue; // transparent
          for (const nx of [sx + px, sx + px - 256]) {
            if (nx < 16 || nx > 271) continue; // clip to the playfield columns (2*8 .. 34*8-1)
            const rgb = palette[ctab[ctabBase + pen]];
            const o = (ny * 288 + nx) * 3;
            native[o] = rgb[0]; native[o + 1] = rgb[1]; native[o + 2] = rgb[2];
          }
        }
      }
    };
    for (let offs = 14; offs > 4; offs -= 2) plot(offs, 0);
    for (let offs = 4; offs >= 0; offs -= 2) plot(offs, 1);
  }
}

// Pac-Man's videoram is a 32-row-addressable space packed to fit a 36-wide
// tilemap: the two leftmost and two rightmost tile columns (the side
// tunnels) live in a separate wrapped region rather than following simple
// row-major order. See pacman_v.cpp's `pacman_scan_rows`.
function pacmanTilemapIndex(col, row) {
  row += 2; col -= 2;
  if (col & 0x20) return row + ((col & 0x1F) << 5);
  return col + (row << 5);
}
