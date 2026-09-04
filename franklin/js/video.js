'use strict';
// Renders the Apple II-compatible text/lo-res/hi-res video memory onto a
// canvas. Character glyphs are drawn with the canvas's own monospace font
// rather than a ROM character generator bitmap -- this emulator doesn't have
// a dump of the Franklin's character ROM, and canvas text rendering looks
// perfectly at home for a terminal-style green-phosphor display.

const COLS = 40, ROWS = 24;

// Approximate standard Apple II 16-color lo-res palette (NTSC composite
// colors are notoriously fuzzy; these are the commonly published RGB
// approximations used by other Apple II emulators).
const LORES_COLORS = [
  '#000000', '#8a2140', '#3c22a5', '#c848d3',
  '#146a3b', '#767676', '#1f5ac5', '#93a9ff',
  '#5c4e00', '#f77b34', '#a3a3a3', '#f6a4de',
  '#1cba57', '#e6de83', '#83d4f6', '#ffffff',
];

function textRowAddr(base, row) {
  const block = row % 8, group = Math.floor(row / 8);
  return base + block * 0x80 + group * 0x28;
}

class Video {
  constructor(canvas, machine) {
    this.canvas = canvas;
    this.machine = machine;
    this.ctx = canvas.getContext('2d');
    this.cellW = 14;
    this.cellH = 16;
    canvas.width = COLS * this.cellW;
    canvas.height = ROWS * this.cellH;
    this.ctx.textBaseline = 'top';
    this.ctx.font = `bold ${this.cellH - 2}px "Courier New", monospace`;
    // A real Apple II character cell is 7x8 pixels -- almost square, and
    // much wider relative to its height than a typical monospace font's
    // natural glyph advance. Left as-is, fillText leaves a wide gap after
    // every character; stretching each glyph horizontally to fill the cell
    // gives the dense, edge-to-edge look real Apple II text has.
    const naturalWidth = this.ctx.measureText('M').width || (this.cellH * 0.6);
    this.glyphScaleX = this.cellW / naturalWidth;
  }

  render() {
    const m = this.machine;
    const ctx = this.ctx;
    const fg = '#33ff66', bg = '#08150d';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const base = m.page2 ? 0x0800 : 0x0400;
    const graphicsRows = (m.textMode) ? 0 : (m.mixedMode ? ROWS - 4 : ROWS);

    if (graphicsRows > 0) {
      if (m.hires) this.renderHires(m.page2 ? 0x4000 : 0x2000, graphicsRows);
      else this.renderLores(base, graphicsRows);
    }
    this.renderText(base, graphicsRows, fg, bg);
  }

  renderText(base, startRow, fg, bg) {
    const ctx = this.ctx;
    const flashOn = (Date.now() % 600) < 300;
    ctx.font = `bold ${this.cellH - 2}px "Courier New", monospace`;
    for (let row = startRow; row < ROWS; row++) {
      const addr = textRowAddr(base, row);
      for (let col = 0; col < COLS; col++) {
        const raw = this.machine.ram[addr + col];
        let ch, inverse;
        if (raw < 0x80) {
          // Inverse ($00-$3F) and flash ($40-$7F) both encode one of the
          // same 64 glyphs (raw & 0x3F); values below $20 there are the
          // @A-Z[\]^_ range, which sits at ASCII $40-$5F.
          ch = raw & 0x3f;
          if (ch < 0x20) ch += 0x40;
          inverse = raw < 0x40 ? true : flashOn;
        } else {
          ch = raw & 0x7f;
          inverse = false;
        }
        const x = col * this.cellW, y = row * this.cellH;
        ctx.fillStyle = inverse ? fg : bg;
        ctx.fillRect(x, y, this.cellW, this.cellH);
        ctx.fillStyle = inverse ? bg : fg;
        ctx.save();
        ctx.translate(x, y + 1);
        ctx.scale(this.glyphScaleX, 1);
        ctx.fillText(String.fromCharCode(ch), 0, 0);
        ctx.restore();
      }
    }
  }

  renderLores(base, rows) {
    const ctx = this.ctx;
    const halfH = this.cellH / 2;
    for (let row = 0; row < rows; row++) {
      const addr = textRowAddr(base, row);
      for (let col = 0; col < COLS; col++) {
        const byte = this.machine.ram[addr + col];
        const top = byte & 0x0f, bottom = (byte >> 4) & 0x0f;
        const x = col * this.cellW, y = row * this.cellH;
        ctx.fillStyle = LORES_COLORS[top];
        ctx.fillRect(x, y, this.cellW, halfH);
        ctx.fillStyle = LORES_COLORS[bottom];
        ctx.fillRect(x, y + halfH, this.cellW, halfH);
      }
    }
  }

  // Monochrome approximation (no NTSC color-fringe artifacting): each of the
  // 40 bytes per scanline contributes 7 pixels, bit0 first.
  renderHires(base, rows) {
    const ctx = this.ctx;
    const scaleY = (this.cellH * ROWS) / 192;
    const scaleX = (this.cellW * COLS) / 280;
    ctx.fillStyle = '#33ff66';
    // Standard HGR row->address decode.
    for (let y = 0; y < rows * 8; y++) {
      const a = (y & 7), b = (y >> 3) & 7, c = (y >> 6) & 3;
      const rowAddr = base + c * 0x28 + b * 0x80 + a * 0x400;
      for (let byteCol = 0; byteCol < 40; byteCol++) {
        const v = this.machine.ram[rowAddr + byteCol];
        for (let bit = 0; bit < 7; bit++) {
          if (v & (1 << bit)) {
            const px_ = (byteCol * 7 + bit) * scaleX;
            ctx.fillRect(px_, y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
          }
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Video };
