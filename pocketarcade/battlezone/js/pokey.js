'use strict';

// Lightweight, stylized POKEY. Battlezone's game code never touches
// POKEY's serial/keyboard/random-number features, only its 4 tone
// generators (used for the radar "ping"/warning tones) and — cleverly —
// its ALLPOT register, which the board wires straight to the joystick/
// button inputs (IN3) instead of real potentiometers, letting the CPU read
// digital controls through what's normally an analog status port (see
// bzone.cpp's `pokey.allpot_r().set_ioport("IN3")`).
//
// This is not a cycle-accurate chip emulation: real POKEY generates noise
// from 17-bit/5-bit polynomial counters clocked at the chip rate; we just
// decode each channel's AUDF/AUDC into a target pitch and tone-vs-noise
// flag once per frame and let Web Audio do the synthesis in audio.js,
// matching this repo's other audio.js files' "stylistic re-creation"
// approach rather than a register-cycle-accurate chip emulation.
class Pokey {
  constructor() {
    this.audf = new Uint8Array(4);
    this.audc = new Uint8Array(4);
    this.audctl = 0;
    this.in3 = 0; // wired in by machine.js from the current control state
  }

  reset() {
    this.audf.fill(0);
    this.audc.fill(0);
    this.audctl = 0;
  }

  // offset is addr - $1820, 0-0x0f (standard POKEY register layout)
  write(offset, data) {
    if (offset < 8) {
      if (offset & 1) this.audc[offset >> 1] = data;
      else this.audf[offset >> 1] = data;
    } else if (offset === 0x08) {
      this.audctl = data;
    }
    // STIMER/SKRES/POTGO/SEROUT/IRQEN/SKCTL: unused by this game's audio
  }

  read(offset) {
    if (offset === 0x08) return this.in3; // ALLPOT, wired to digital controls
    return 0xFF;
  }

  // One {volume, pure, freq} descriptor per channel, for audio.js to poll
  // once a frame. `pure`: bits 7:6 both set selects the chip's pure-tone
  // mode; anything else selects one of its noise-polynomial modes, which
  // we don't synthesize (see file comment) and audio.js treats as silent.
  channels() {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const c = this.audc[i];
      const volume = c & 0x0F;
      const pure = (c & 0xC0) === 0xC0;
      // Approximates POKEY's 64kHz-mode divider (freq = clock/2/(AUDF+1));
      // not bit-exact (we ignore AUDCTL's join/clock-select bits) but lands
      // in the right audible range.
      const freq = 63920 / (2 * (this.audf[i] + 1));
      out.push({ volume, pure, freq });
    }
    return out;
  }
}
