'use strict';

// Namco 54XX — a Fujitsu MB8844 MCU wired as a noise generator for the
// explosion/shot sound effects, driving a discrete filter network. Like
// namco51.js, the real MCU ROM isn't present in this romset, so this is a
// documented-protocol stand-in rather than a silicon simulation: it decodes
// the command byte's top nibble per the table from the 06xx header comment
// (1x/2x/5x = play sound type A/B/C, 3x/4x/6x = set type A/B/C parameters
// — each followed by that many opaque parameter bytes — 7x = set type C
// volume) and reports which of the three canned effects fired. audio.js
// then synthesizes a stylized burst per type, the same "recreate the
// character, not the circuit" approach this repo's other discrete-sound
// games use (see e.g. battlezone/js/audio.js).
class Namco54 {
  constructor(onPlay) {
    this.onPlay = onPlay; // (type: 'A'|'B'|'C', volume) => void
    this.reset();
  }

  reset() {
    this.volumeC = 0;
    this.skip = 0; // remaining opaque parameter bytes to swallow
  }

  write(data) {
    if (this.skip > 0) { this.skip--; return; }
    const cmd = (data >> 4) & 0xF;
    const arg = data & 0xF;
    switch (cmd) {
      case 0: break; // nop
      case 1: if (this.onPlay) this.onPlay('A', 15); break;
      case 2: if (this.onPlay) this.onPlay('B', 15); break;
      case 3: this.skip = 4; break; // set type A params
      case 4: this.skip = 4; break; // set type B params
      case 5: if (this.onPlay) this.onPlay('C', this.volumeC); break;
      case 6: this.skip = 5; break; // set type C params
      case 7: this.volumeC = arg; break;
      default: break; // 8x-Fx: nop
    }
  }
}
