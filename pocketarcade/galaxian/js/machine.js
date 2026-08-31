'use strict';

// Galaxian machine hardware (Namco, 1979)
// A genuinely different board from the two Space Invaders machines: a Z80
// CPU (see js/z80.js, a vendored MIT-licensed core), a tile+sprite video
// generator with a procedural LFSR starfield, and discrete (not sample- or
// bit-triggered) sound circuitry. Memory map, video decode, and star/color
// math below are transcribed from MAME's src/mame/galaxian/galaxian.cpp and
// galaxian_v.cpp (the "galaxian" driver / "invadpt2"-style bigger picture:
// here it's the base "galaxian" romset).

const STAR_RNG_PERIOD = (1 << 17) - 1; // 131071

function millmanVoltage(activeResistances, pulldown) {
  let conductance = 1 / pulldown;
  let current = 0;
  for (const r of activeResistances) { conductance += 1 / r; current += 1 / r; }
  return current / conductance;
}

// Reproduces MAME's compute_resistor_weights() for a set of pull-up
// resistors (selected by bit) sharing a single pulldown resistor, feeding a
// high-impedance video amp input. Returns one weighted 0-255 value per
// possible bit-combination (a small table, e.g. 8 entries for 3 resistors).
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

function setPixel(buf, stride, x, y, rgb) {
  const off = (y * stride + x) * 3;
  buf[off] = rgb[0]; buf[off + 1] = rgb[1]; buf[off + 2] = rgb[2];
}

class Galaxian {
  constructor() {
    this.rom = new Uint8Array(0x4000);       // 0x0000-0x3FFF (only 0-0x27FF used)
    this.ram = new Uint8Array(0x400);        // 0x4000-0x47FF work RAM (mirrored)
    this.videoram = new Uint8Array(0x400);   // 0x5000-0x57FF tile codes (mirrored)
    this.spriteram = new Uint8Array(0x100);  // 0x5800-0x5FFF (mirrored):
                                              //  0x00-0x3F: per-column scroll/color attrib
                                              //  0x40-0x5F: 8 sprites x 4 bytes
                                              //  0x60-0x7F: 8 bullets x 4 bytes

    // Input ports (all active-high; dynamic bits set via setIn0/setIn1)
    this.in0 = 0; // bit0=coin1 bit1=coin2 bit2=left bit3=right bit4=fire (bit5=cabinet DIP=upright=0)
    this.in1 = 0; // bit0=start1 bit1=start2 (bits6-7=coinage DIP, default 1C/1C=0)
    this.in2 = 0x04; // DIP only: bonus=7000(bits0-1=0), lives=3(bit2=1) — fixed, never changes

    this.irqEnabled = false;
    this.starsEnabled = false;
    this.flipScreenX = false;
    this.flipScreenY = false;

    this.lfoVal = 0;      // 4-bit background pitch DAC value (0x6004-0x6007)
    this.soundBits = 0;   // sound_w latch (0x6800-0x6807), bit-per-channel
    this.pitchVal = 0xFF; // 0x7800 write: dive-siren pitch, 0xFF = idle sentinel

    this.onSound = null;      // function(channel, on) — same edge-triggered convention as the other machines
    this.onLfoChange = null;  // function(value 0-15) — background pitch DAC changed
    this.onPitchChange = null; // function(value 0-255) — dive-siren pitch changed, 0xFF = idle

    this.cyclesPerFrame = 50688; // (384*3 * 264) / 6, see derivation in project notes
    this.cycleDebt = 0;
    this.frameNum = 0;
    this.starOrigin = 0;

    this.native = new Uint8ClampedArray(256 * 224 * 3); // native (unrotated) framebuffer

    this.z80 = Z80({
      mem_read: (a) => this.memRead(a),
      mem_write: (a, v) => this.memWrite(a, v),
      io_read: () => 0xFF,   // Galaxian never uses Z80 IN/OUT — everything is memory-mapped
      io_write: () => {},
    });
  }

  loadRoms() {
    decodeRoms(this.rom);
    this.gfx = decodeGfx();
    this.colorProm = decodeColorProm();
    this.buildPalette();
    this.buildStarTables();
  }

  buildPalette() {
    const rTable = buildResistorTable([1000, 470, 220], 470);
    const bTable = buildResistorTable([470, 220], 470);
    this.palette = [];
    for (let i = 0; i < this.colorProm.length; i++) {
      const byte = this.colorProm[i];
      this.palette.push([
        rTable[byte & 7],
        rTable[(byte >> 3) & 7],
        bTable[(byte >> 6) & 3],
      ]);
    }
    this.bulletColor = [];
    for (let i = 0; i < 7; i++) this.bulletColor.push([255, 255, 255]);
    this.bulletColor.push([255, 255, 0]);
  }

  buildStarTables() {
    const stars = new Uint8Array(STAR_RNG_PERIOD);
    let shiftreg = 0;
    for (let i = 0; i < STAR_RNG_PERIOD; i++) {
      const enabled = (shiftreg & 0x1fe01) === 0x1fe00;
      const color = (~shiftreg & 0x1f8) >> 3;
      stars[i] = (color & 0x3f) | (enabled ? 0x80 : 0);
      const feedback = ((shiftreg >> 12) ^ (~shiftreg)) & 1;
      shiftreg = ((shiftreg >>> 1) | (feedback << 16)) & 0x1ffff;
    }
    this.starsTable = stars;

    const RGB_MAX = 255;
    const minval = Math.trunc(RGB_MAX * 130 / 150);
    const midval = Math.trunc(RGB_MAX * 130 / 100);
    const maxval = Math.trunc(RGB_MAX * 130 / 60);
    const starmap = [0, minval, minval + Math.trunc((255 - minval) * (midval - minval) / (maxval - minval)), 255];
    this.starColor = [];
    for (let i = 0; i < 64; i++) {
      const r = starmap[(((i >> 4) & 1) << 1) | ((i >> 5) & 1)];
      const g = starmap[(((i >> 2) & 1) << 1) | ((i >> 3) & 1)];
      const b = starmap[(((i >> 0) & 1) << 1) | ((i >> 1) & 1)];
      this.starColor.push([r, g, b]);
    }
  }

  // ── Memory decode ──────────────────────────────────────────────────────
  memRead(addr) {
    addr &= 0xFFFF;
    if (addr <= 0x3FFF) return this.rom[addr];
    if (addr <= 0x47FF) return this.ram[addr & 0x3FF];
    if (addr <= 0x4FFF) return 0xFF; // unmapped
    if (addr <= 0x57FF) return this.videoram[addr & 0x3FF];
    if (addr <= 0x5FFF) return this.spriteram[addr & 0xFF];
    if (addr <= 0x67FF) return this.in0;
    if (addr <= 0x6FFF) return this.in1;
    if (addr <= 0x77FF) return this.in2;
    return 0; // 0x7800-0x7FFF: watchdog reset read, no-op
  }

  memWrite(addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    if (addr <= 0x3FFF) return; // ROM
    if (addr <= 0x47FF) { this.ram[addr & 0x3FF] = val; return; }
    if (addr <= 0x4FFF) return; // unmapped
    if (addr <= 0x57FF) { this.videoram[addr & 0x3FF] = val; return; }
    if (addr <= 0x5FFF) { this.spriteram[addr & 0xFF] = val; return; }
    if (addr <= 0x67FF) {
      const sub = addr & 7;
      if (sub >= 4) this.setLfoBit(sub - 4, val & 1);
      // sub 0/1 = start lamps, 2 = coin lockout, 3 = coin counter — no physical equivalent here
      return;
    }
    if (addr <= 0x6FFF) { this.soundWrite(addr & 7, val & 1); return; }
    if (addr <= 0x77FF) {
      const sub = addr & 7;
      if (sub === 1) this.irqEnabled = !!(val & 1);
      else if (sub === 4) this.starsEnabled = !!(val & 1);
      else if (sub === 6) this.flipScreenX = !!(val & 1);
      else if (sub === 7) this.flipScreenY = !!(val & 1);
      return;
    }
    // 0x7800-0x7FFF: pitch_w — written most frames even when idle, so only
    // forward actual changes (mirrors setLfoBit's change-gating below).
    if (val !== this.pitchVal) {
      this.pitchVal = val;
      if (this.onPitchChange) this.onPitchChange(val);
    }
  }

  setLfoBit(bit, on) {
    const next = on ? (this.lfoVal | (1 << bit)) : (this.lfoVal & ~(1 << bit));
    if (next !== this.lfoVal) {
      this.lfoVal = next;
      if (this.onLfoChange) this.onLfoChange(next);
    }
  }

  soundWrite(bit, on) {
    const next = on ? (this.soundBits | (1 << bit)) : (this.soundBits & ~(1 << bit));
    const changed = this.soundBits ^ next;
    this.soundBits = next;
    if (!this.onSound || !changed) return;
    for (let b = 0; b < 8; b++) {
      if (changed & (1 << b)) this.onSound(b, !!(next & (1 << b)));
    }
  }

  // ── Input helpers (active-high) ────────────────────────────────────────
  setIn0(bit, on) {
    if (on) this.in0 |= (1 << bit); else this.in0 &= ~(1 << bit);
  }
  setIn1(bit, on) {
    if (on) this.in1 |= (1 << bit); else this.in1 &= ~(1 << bit);
  }

  reset() {
    this.ram.fill(0);
    this.videoram.fill(0);
    this.spriteram.fill(0);
    this.z80.reset();
    this.irqEnabled = false;
    this.starsEnabled = false;
    this.flipScreenX = false;
    this.flipScreenY = false;
    this.lfoVal = 0;
    this.soundBits = 0;
    this.pitchVal = 0xFF;
    this.cycleDebt = 0;
    this.frameNum = 0;
    this.starOrigin = 0;
  }

  runFrame() {
    let remaining = this.cyclesPerFrame + this.cycleDebt;
    while (remaining > 0) remaining -= this.z80.run_instruction();
    this.cycleDebt = remaining;

    if (this.irqEnabled) this.z80.interrupt(true); // one NMI per vblank, gated by irq_enable_w

    this.frameNum++;
    const delta = this.flipScreenX ? 1 : -1;
    this.starOrigin = ((this.starOrigin + delta) % STAR_RNG_PERIOD + STAR_RNG_PERIOD) % STAR_RNG_PERIOD;
  }

  // ── Video ───────────────────────────────────────────────────────────────
  drawBackground() {
    this.native.fill(0);
    if (!this.starsEnabled) return;
    const period = STAR_RNG_PERIOD, table = this.starsTable, colors = this.starColor;
    for (let y = 0; y < 224; y++) {
      let offs = (this.starOrigin + y * 512) % period;
      for (let x = 0; x < 256; x++) {
        const enable = (y ^ (x >> 3)) & 1;
        const s = table[offs++]; if (offs >= period) offs = 0;
        offs++; if (offs >= period) offs = 0; // consume the 2nd RNG clock to stay aligned per row
        if (enable && (s & 0x80)) setPixel(this.native, 256, x, y, colors[s & 0x3f]);
      }
    }
  }

  drawTilemap() {
    const gfx = this.gfx, videoram = this.videoram, spriteram = this.spriteram, palette = this.palette;
    for (let tx = 0; tx < 32; tx++) {
      const colScroll = spriteram[tx * 2];
      const color = spriteram[tx * 2 + 1] & 7;
      for (let rawY = 16; rawY < 240; rawY++) {
        const tmRow = (rawY + colScroll) & 0xFF;
        const ty = tmRow >> 3, py = tmRow & 7;
        const code = videoram[ty * 32 + tx];
        const row0 = gfx[code * 8 + py];
        const row1 = gfx[0x800 + code * 8 + py];
        const nativeRow = rawY - 16;
        for (let px = 0; px < 8; px++) {
          const bit = 7 - px;
          const pen = ((row0 >> bit) & 1) | (((row1 >> bit) & 1) << 1);
          if (pen === 0) continue; // transparent
          setPixel(this.native, 256, tx * 8 + px, nativeRow, palette[color * 4 + pen]);
        }
      }
    }
  }

  drawSprites() {
    const gfx = this.gfx, spriteram = this.spriteram, palette = this.palette, base = 0x40;
    for (let i = 7; i >= 0; i--) { // low-numbered sprites draw last = win priority ties
      const o = base + i * 4;
      const y0 = spriteram[o];
      const sy = (240 - y0 + (i < 3 ? 1 : 0)) - 16;
      const code = spriteram[o + 1] & 0x3f;
      const flipx = !!(spriteram[o + 1] & 0x40);
      const flipy = !!(spriteram[o + 1] & 0x80);
      const color = spriteram[o + 2] & 7;
      const sx = spriteram[o + 3] + 1;
      const planeBase = code * 32;
      for (let py = 0; py < 16; py++) {
        const ny = sy + py;
        if (ny < 0 || ny >= 224) continue;
        const srcY = flipy ? 15 - py : py;
        const quadRow = srcY & 7, quadY = srcY >> 3; // 0=top,1=bottom
        for (let px = 0; px < 16; px++) {
          const nx = sx + px;
          if (nx < 0 || nx >= 256) continue;
          const srcX = flipx ? 15 - px : px;
          const quadCol = srcX >> 3, bitInByte = 7 - (srcX & 7); // 0=left,1=right
          const byteOff = planeBase + (quadY * 2 + quadCol) * 8 + quadRow;
          const pen = ((gfx[byteOff] >> bitInByte) & 1) | (((gfx[0x800 + byteOff] >> bitInByte) & 1) << 1);
          if (pen === 0) continue;
          setPixel(this.native, 256, nx, ny, palette[color * 4 + pen]);
        }
      }
    }
  }

  drawBullets() {
    const spriteram = this.spriteram, base = 0x60;
    for (let which = 0; which < 8; which++) {
      const o = base + which * 4;
      const effy = (255 - spriteram[o + 1]) & 0xFF;
      const yRaw = which < 3 ? (effy + 1) & 0xFF : effy;
      if (yRaw < 16 || yRaw >= 240) continue;
      const nativeRow = yRaw - 16;
      const x0 = (255 - spriteram[o + 3]) & 0xFF;
      const color = which === 7 ? this.bulletColor[7] : this.bulletColor[which];
      for (let dx = 0; dx < 4; dx++) {
        const x = x0 + dx;
        if (x >= 0 && x < 256) setPixel(this.native, 256, x, nativeRow, color);
      }
    }
  }

  // Render into a 224x256 portrait ImageData. The cabinet mounts the CRT
  // rotated 90 degrees clockwise (MAME tags this ROT90 — the opposite
  // direction from the Space Invaders boards, which are ROT270), so the
  // mapping from native (256 wide x 224 tall) to portrait coordinates is
  // native_x = portrait_y, native_y = 223 - portrait_x.
  render(imageData) {
    this.drawBackground();
    this.drawTilemap();
    this.drawSprites();
    this.drawBullets();

    const native = this.native, data = imageData.data;
    const W = 224, H = 256;
    for (let fy = 0; fy < H; fy++) {
      const nx = fy;
      let srcOff = ((223) * 256 + nx) * 3; // row for fx=0 (ny=223); we decrement per fx below
      let dstOff = (fy * W) * 4;
      for (let fx = 0; fx < W; fx++) {
        data[dstOff]     = native[srcOff];
        data[dstOff + 1] = native[srcOff + 1];
        data[dstOff + 2] = native[srcOff + 2];
        data[dstOff + 3] = 255;
        srcOff -= 256 * 3; // ny decreases as fx increases
        dstOff += 4;
      }
    }
  }
}
