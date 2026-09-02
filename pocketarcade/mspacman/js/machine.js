'use strict';

// Ms. Pac-Man (Midway/GCC, 1981) machine hardware: the same Z80 + tile/sprite
// + Namco WSG platform as Pac-Man, but the "enhancement kit" ROM board adds
// a copy-protection bank switch — reading or writing specific trap
// addresses flips the whole 64KB address space between the plain Pac-Man
// ROM image (bank 0, what a naive chip-copier sees) and the real decrypted
// Ms. Pac-Man code (bank 1). Memory map, decode/patch tables, tile/sprite
// layout, and palette decode are transcribed from MAME's
// src/mame/pacman/pacman.cpp (init_mspacman, mspacman_map) and pacman_v.cpp
// — an independent reimplementation of that publicly documented hardware
// (including its anti-piracy scheme), not a code port.

// Faithful port of MAME's compute_resistor_weights() for the specific case
// this board's palette PROM circuit uses: no separate pulldown/pullup
// resistor on any channel (each bit's own resistor doubles as the "other
// bits'" pulldown when it's off), and — critically — all channels passed
// in the same call share ONE autoscale factor, taken from whichever
// channel has the largest theoretical max. Blue only has two resistors
// here (red/green have three), so it never reaches full 0-255 brightness;
// normalizing each channel independently (as if each had its own 0-255
// range) desaturates/shifts colors — e.g. the frightened-ghost blue
// reading as green — since blue ends up disproportionately amplified.
function computeResistorWeights(maxval, channelResistances) {
  const raw = channelResistances.map(resistances => {
    const n = resistances.length;
    const w = new Array(n);
    for (let i = 0; i < n; i++) {
      const r1 = resistances[i]; // this bit's own resistor (pulled toward Vcc when the bit is set)
      let r0cond = 0;
      for (let j = 0; j < n; j++) if (j !== i) r0cond += 1 / resistances[j]; // all other bits, grounded
      const r0 = 1 / r0cond;
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

const TILE_XOFF = [64, 65, 66, 67, 0, 1, 2, 3];
const TILE_YOFF = [0, 8, 16, 24, 32, 40, 48, 56];
const SPR_XOFF = [64, 65, 66, 67, 128, 129, 130, 131, 192, 193, 194, 195, 0, 1, 2, 3];
const SPR_YOFF = [0, 8, 16, 24, 32, 40, 48, 56, 256, 264, 272, 280, 288, 296, 304, 312];

function getBit(data, base, bitIndex) {
  return (data[base + (bitIndex >> 3)] >> (7 - (bitIndex & 7))) & 1;
}
// MAME's gfx_element::decode() starts planebit at 1<<(planes-1) and shifts
// right per plane, so the FIRST listed plane (offset+0) contributes the
// HIGH bit of the pen and the second (offset+4) the low bit — backwards
// from the naive "plane index == pen bit index" assumption. Getting this
// backwards doesn't scramble shapes (nonzero-vs-zero is unaffected) but
// silently sends specific pen values to the wrong color-table slot, e.g.
// dots landing on black instead of white, or frightened ghosts reading
// green instead of blue.
function decodeTile(data, base, out) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const bi0 = TILE_YOFF[row] + TILE_XOFF[col];
      out[row * 8 + col] = getBit(data, base, bi0 + 4) | (getBit(data, base, bi0) << 1);
    }
  }
}
function decodeSprite(data, base, out) {
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const bi0 = SPR_YOFF[row] + SPR_XOFF[col];
      out[row * 16 + col] = getBit(data, base, bi0 + 4) | (getBit(data, base, bi0) << 1);
    }
  }
}

// bitPositions lists source bit indices from the output's MSB to LSB —
// the same argument order MAME's bitswap<N>(value, ...) template takes.
function bitswap(value, bitPositions) {
  let result = 0;
  const n = bitPositions.length;
  for (let i = 0; i < n; i++) result |= ((value >> bitPositions[i]) & 1) << (n - 1 - i);
  return result;
}

// Each entry copies an 8-byte patch from the decrypted-but-still-encoded
// u5/u6/u7 region into the final decrypted program, at the addresses real
// Ms. Pac-Man code actually executes from. See init_mspacman() /
// mspacman_install_patches() in pacman.cpp.
const MSPACMAN_PATCHES = [
  [0x0410, 0x8008], [0x08e0, 0x81d8], [0x0a30, 0x8118], [0x0bd0, 0x80d8],
  [0x0c20, 0x8120], [0x0e58, 0x8168], [0x0ea8, 0x8198],
  [0x1000, 0x8020], [0x1008, 0x8010], [0x1288, 0x8098], [0x1348, 0x8048],
  [0x1688, 0x8088], [0x16b0, 0x8188], [0x16d8, 0x80c8], [0x16f8, 0x81c8],
  [0x19a8, 0x80a8], [0x19b8, 0x81a8],
  [0x2060, 0x8148], [0x2108, 0x8018], [0x21a0, 0x81a0], [0x2298, 0x80a0],
  [0x23e0, 0x80e8], [0x2418, 0x8000], [0x2448, 0x8058], [0x2470, 0x8140],
  [0x2488, 0x8080], [0x24b0, 0x8180], [0x24d8, 0x80c0], [0x24f8, 0x81c0],
  [0x2748, 0x8050], [0x2780, 0x8090], [0x27b8, 0x8190], [0x2800, 0x8028],
  [0x2b20, 0x8100], [0x2b30, 0x8110], [0x2bf0, 0x81d0], [0x2cc0, 0x80d0],
  [0x2cd8, 0x80e0], [0x2cf0, 0x81e0], [0x2d60, 0x8160],
];

// Any access to these 8-byte windows switches the whole address space to
// the plain (undecrypted) Pac-Man ROM image — used by the game's own
// protection self-check.
const DISABLE_TRAPS = [0x0038, 0x03B0, 0x1600, 0x2120, 0x3FF0, 0x8000, 0x97F0];
// ...and this one switches to the real decrypted Ms. Pac-Man code — hit
// almost immediately at boot, and normal play never touches the above.
const ENABLE_TRAPS = [0x3FF8];

class MsPacman {
  constructor() {
    this.rawRom = new Uint8Array(0x10000);
    this.bank0 = new Uint8Array(0x10000);
    this.bank1 = new Uint8Array(0x10000);
    this.bankNum = 1; // matches membank("bank1")->set_entry(1) at driver init

    this.videoram = new Uint8Array(0x400);
    this.colorram = new Uint8Array(0x400);
    this.ram = new Uint8Array(0x3F0);
    this.spriteram = new Uint8Array(0x10);
    this.spriteram2 = new Uint8Array(0x10);

    this.in0 = 0xFF;
    this.in1 = 0xFF;
    this.dsw1 = 0xC9;
    this.dsw2 = 0xFF;

    this.mainlatch = 0;
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
    this.onVoice = null;
    this.onSoundEnable = null;

    this.cyclesPerFrame = 50688;

    this.z80 = Z80({
      mem_read: (a) => this.read(a),
      mem_write: (a, v) => this.write(a, v),
      io_read: () => 0xFF,
      io_write: (port, val) => { if ((port & 0xFF) === 0) this.interruptVector = val; },
    });
  }

  loadRoms() {
    decodeRoms(this.rawRom);
    this.buildBanks();
    const gfx = decodeGfx();
    this.tiles = new Uint8Array(256 * 64);
    for (let i = 0; i < 256; i++) decodeTile(gfx, i * 16, this.tiles.subarray(i * 64, i * 64 + 64));
    this.sprites = new Uint8Array(64 * 256);
    for (let i = 0; i < 64; i++) decodeSprite(gfx, 0x1000 + i * 64, this.sprites.subarray(i * 256, i * 256 + 256));
    this.buildPalette();
  }

  buildBanks() {
    const ROM = this.rawRom, DROM = this.bank1;
    for (let i = 0; i < 0x1000; i++) {
      DROM[0x0000 + i] = ROM[0x0000 + i]; // pacman.6e
      DROM[0x1000 + i] = ROM[0x1000 + i]; // pacman.6f
      DROM[0x2000 + i] = ROM[0x2000 + i]; // pacman.6h
      DROM[0x3000 + i] = bitswap(ROM[0xB000 + bitswap(i, [11, 3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], [0, 4, 5, 7, 6, 3, 2, 1]); // u7
    }
    for (let i = 0; i < 0x800; i++) {
      DROM[0x8000 + i] = bitswap(ROM[0x8000 + bitswap(i, [8, 7, 5, 9, 10, 6, 3, 4, 2, 1, 0])], [0, 4, 5, 7, 6, 3, 2, 1]); // u5
      DROM[0x8800 + i] = bitswap(ROM[0x9800 + bitswap(i, [3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], [0, 4, 5, 7, 6, 3, 2, 1]); // half of u6
      DROM[0x9000 + i] = bitswap(ROM[0x9000 + bitswap(i, [3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], [0, 4, 5, 7, 6, 3, 2, 1]); // other half of u6
      DROM[0x9800 + i] = ROM[0x1800 + i]; // mirror of pacman.6f high half
    }
    for (let i = 0; i < 0x1000; i++) {
      DROM[0xA000 + i] = ROM[0x2000 + i]; // mirror of pacman.6h
      DROM[0xB000 + i] = ROM[0x3000 + i]; // mirror of pacman.6j
    }
    for (const [dest, src] of MSPACMAN_PATCHES) {
      for (let i = 0; i < 8; i++) DROM[dest + i] = DROM[src + i];
    }

    this.bank0.set(ROM);
    for (let i = 0; i < 0x1000; i++) {
      this.bank0[0x8000 + i] = this.bank0[0x0000 + i];
      this.bank0[0x9000 + i] = this.bank0[0x1000 + i];
      this.bank0[0xA000 + i] = this.bank0[0x2000 + i];
      this.bank0[0xB000 + i] = this.bank0[0x3000 + i];
    }
  }

  buildPalette() {
    const promPalette = decode_palette_7f();
    const promColorTable = decode_colortable_4a();
    const [rw, gw, bw] = computeResistorWeights(255, [[1000, 470, 220], [1000, 470, 220], [470, 220]]);
    this.palette = [];
    for (let i = 0; i < 32; i++) {
      const byte = promPalette[i];
      this.palette.push([
        combineWeights(rw, [byte & 1, (byte >> 1) & 1, (byte >> 2) & 1]),
        combineWeights(gw, [(byte >> 3) & 1, (byte >> 4) & 1, (byte >> 5) & 1]),
        combineWeights(bw, [(byte >> 6) & 1, (byte >> 7) & 1]),
      ]);
    }
    this.colorTable = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.colorTable[i] = promColorTable[i] & 0x0F;
  }

  reset() {
    // Real SRAM powers up with unpredictable garbage, not zeroed — filling
    // with 0 here (JS's array default) makes boot RAM start out coincidentally
    // matching the game's own "just cleared this" state before its actual
    // init code ever runs, which defeats anything (like high-score restore)
    // that waits to see that state genuinely happen.
    this.videoram.fill(0xFF);
    this.colorram.fill(0xFF);
    this.ram.fill(0xFF);
    this.spriteram.fill(0xFF);
    this.spriteram2.fill(0xFF);
    this.bankNum = 1;
    this.z80.reset();
    this.mainlatch = 0;
    this.irqMask = false;
    this.soundEnable = false;
    this.flipScreen = false;
    this.interruptVector = 0;
    this.wsgRegs.fill(0);
  }

  checkTrap(addr) {
    for (const base of DISABLE_TRAPS) if (addr >= base && addr < base + 8) return 0;
    for (const base of ENABLE_TRAPS) if (addr >= base && addr < base + 8) return 1;
    return null;
  }

  read(addr) {
    addr &= 0xFFFF;
    if (addr >= 0x4000 && addr < 0x4400) return this.videoram[addr & 0x3FF];
    if (addr >= 0x4400 && addr < 0x4800) return this.colorram[addr & 0x3FF];
    if (addr >= 0x4800 && addr < 0x4C00) return 0xBF;
    if (addr >= 0x4C00 && addr < 0x4FF0) return this.ram[addr - 0x4C00];
    if (addr >= 0x4FF0 && addr < 0x5000) return this.spriteram[addr - 0x4FF0];
    if (addr === 0x5000) return this.in0;
    if (addr === 0x5040) return this.in1;
    if (addr === 0x5080) return this.dsw1;
    if (addr === 0x50C0) return this.dsw2;
    const trap = this.checkTrap(addr);
    if (trap !== null) this.bankNum = trap;
    return (this.bankNum ? this.bank1 : this.bank0)[addr];
  }

  write(addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    if (addr >= 0x4000 && addr < 0x4400) { this.videoram[addr & 0x3FF] = val; return; }
    if (addr >= 0x4400 && addr < 0x4800) { this.colorram[addr & 0x3FF] = val; return; }
    if (addr >= 0x4800 && addr < 0x4C00) return;
    if (addr >= 0x4C00 && addr < 0x4FF0) { this.ram[addr - 0x4C00] = val; return; }
    if (addr >= 0x4FF0 && addr < 0x5000) { this.spriteram[addr - 0x4FF0] = val; return; }
    if (addr >= 0x5000 && addr < 0x5008) { this.mainlatchWrite(addr - 0x5000, val); return; }
    if (addr >= 0x5040 && addr < 0x5060) { this.wsgWrite(addr - 0x5040, val); return; }
    if (addr >= 0x5060 && addr < 0x5070) { this.spriteram2[addr - 0x5060] = val; return; }
    if (addr >= 0x5070) return;
    const trap = this.checkTrap(addr);
    if (trap !== null) this.bankNum = trap;
  }

  mainlatchWrite(bit, val) {
    const newBit = val & 1;
    const oldBit = (this.mainlatch >> bit) & 1;
    this.mainlatch = (this.mainlatch & ~(1 << bit)) | (newBit << bit);
    if (newBit === oldBit) return;
    if (bit === 0) this.irqMask = !!newBit;
    else if (bit === 1) { this.soundEnable = !!newBit; if (this.onSoundEnable) this.onSoundEnable(this.soundEnable); }
    else if (bit === 3) this.flipScreen = !!newBit;
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
          if (pen === 0) continue;
          for (const nx of [sx + px, sx + px - 256]) {
            if (nx < 16 || nx > 271) continue;
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

function pacmanTilemapIndex(col, row) {
  row += 2; col -= 2;
  if (col & 0x20) return row + ((col & 0x1F) << 5);
  return col + (row << 5);
}
