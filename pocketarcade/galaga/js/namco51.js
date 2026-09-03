'use strict';

// Namco 51XX — a Fujitsu MB8843 MCU programmed as a coin/credit/joystick I/O
// controller. Real silicon runs its own ~1KB MCU program; since this exact
// "galaga" romset (pre-2000s dump) never included that MCU ROM — only the
// main board's Z80 ROMs and the Namco 05xx/palette PROMs are dumped here —
// period-accurate MAME ran this chip as a documented command/response state
// machine instead of simulating the MCU silicon, and that's what's ported
// here: the command table from the 06xx's own header comment (00 nop, 01+4
// args set coinage, 02 credit mode, 03/04 joystick remap off/on, 05 switch
// mode), reconstructed from MAME's pre-MCU-simulation namco51.c. Independent
// reimplementation of that documented protocol, not a code port.
//
// Reached through the Namco 06XX bus controller (see namco06 wiring in
// machine.js): the main CPU writes a command byte, then polls reads that
// return the answer a few bits at a time.
const JOY_MAP = [0xf, 0xe, 0xd, 0x5, 0xc, 0x9, 0x7, 0x6, 0xb, 0x3, 0xa, 0x4, 0x1, 0x2, 0x0, 0x8];

class Namco51 {
  // readIn(n): returns the raw active-low nibble for port n (0=IN0L, 1=IN0H,
  // 2=IN1L, 3=IN1H). writeOut(port, data): port0 = LEDs/coin-counters,
  // port1 = coin lockout. frameParity(): a slowly-toggling bit used to
  // blink the start-button lamps (any ~/16-frame counter works).
  constructor(readIn, writeOut, frameParity) {
    this.readIn = readIn;
    this.writeOut = writeOut;
    this.frameParity = frameParity;
    this.reset();
  }

  reset() {
    this.lastCoins = 0;
    this.lastButtons = 0;
    this.credits = 0;
    this.coins = [0, 0];
    this.coinsPerCred = [1, 1];
    this.credsPerCoin = [1, 1];
    this.inCount = 0;
    this.mode = 0;
    this.coincredMode = 0;
    this.remapJoy = 0;
  }

  write(data) {
    data &= 0x07;
    if (this.coincredMode) {
      switch (this.coincredMode--) {
        case 4: this.coinsPerCred[0] = data; break;
        case 3: this.credsPerCoin[0] = data; break;
        case 2: this.coinsPerCred[1] = data; break;
        case 1: this.credsPerCoin[1] = data; break;
      }
      return;
    }
    switch (data) {
      case 0: break; // nop
      case 1: // set coinage: next 4 writes are coinsPerCred[0], credsPerCoin[0], coinsPerCred[1], credsPerCoin[1]
        this.coincredMode = 4;
        this.credits = 0; // good time to reset the credits counter
        break;
      case 2: // go in "credits" mode and enable start buttons
        this.mode = 1;
        this.inCount = 0;
        break;
      case 3: this.remapJoy = 0; break; // disable joystick remapping
      case 4: this.remapJoy = 1; break; // enable joystick remapping
      case 5: // go in "switch" mode
        this.mode = 0;
        this.inCount = 0;
        break;
      default: break; // 6/7: nop
    }
  }

  read() {
    if (this.mode === 0) {
      // switch mode: just relay raw joystick nibbles
      switch ((this.inCount++) % 3) {
        default:
        case 0: return this.readIn(0) | (this.readIn(1) << 4);
        case 1: return this.readIn(2) | (this.readIn(3) << 4);
        case 2: return 0;
      }
    }

    switch ((this.inCount++) % 3) {
      default:
      case 0: { // number of credits, BCD
        const inv = (~(this.readIn(0) | (this.readIn(1) << 4))) & 0xFF;
        const toggle = inv ^ this.lastCoins;
        this.lastCoins = inv;

        if (this.coinsPerCred[0] > 0) {
          if (this.credits >= 99) {
            this.writeOut(1, 1); // coin lockout
          } else {
            this.writeOut(1, 0); // coin lockout
            if (toggle & inv & 0x10) {
              this.coins[0]++;
              this.writeOut(0, 0x04); this.writeOut(0, 0x0C); // coin counter pulse
              if (this.coins[0] >= this.coinsPerCred[0]) {
                this.credits += this.credsPerCoin[0];
                this.coins[0] -= this.coinsPerCred[0];
              }
            }
            if (toggle & inv & 0x20) {
              this.coins[1]++;
              this.writeOut(0, 0x08); this.writeOut(0, 0x0C);
              if (this.coins[1] >= this.coinsPerCred[1]) {
                this.credits += this.credsPerCoin[1];
                this.coins[1] -= this.coinsPerCred[1];
              }
            }
            if (toggle & inv & 0x40) this.credits++; // service coin
          }
        } else {
          this.credits = 100; // free play
        }

        if (this.mode === 1) {
          const on = this.frameParity();
          if (this.credits >= 2) this.writeOut(0, 0x0C | (3 * on));
          else if (this.credits >= 1) this.writeOut(0, 0x0C | (2 * on));
          else this.writeOut(0, 0x0C);

          if (toggle & inv & 0x04) { // start1
            if (this.credits >= 1) { this.credits--; this.mode = 2; this.writeOut(0, 0x0C); }
          } else if (toggle & inv & 0x08) { // start2
            if (this.credits >= 2) { this.credits -= 2; this.mode = 2; this.writeOut(0, 0x0C); }
          }
        }

        if ((~this.readIn(1)) & 0x08) return 0xBB; // test mode switch held
        return Math.floor(this.credits / 10) * 16 + (this.credits % 10);
      }

      case 1: { // player 1: joystick nibble + fire (edge in bit4, level in bit5)
        let joy = this.readIn(2) & 0x0F;
        const inv = (~this.readIn(0)) & 0xFF;
        const toggle = inv ^ this.lastButtons;
        this.lastButtons = (this.lastButtons & 2) | (inv & 1);
        if (this.remapJoy) joy = JOY_MAP[joy];
        joy |= ((toggle & inv & 0x01) ^ 1) << 4;
        joy |= ((inv & 0x01) ^ 1) << 5;
        return joy;
      }

      case 2: { // player 2 (cocktail): same shape, other bits
        let joy = this.readIn(3) & 0x0F;
        const inv = (~this.readIn(0)) & 0xFF;
        const toggle = inv ^ this.lastButtons;
        this.lastButtons = (this.lastButtons & 1) | (inv & 2);
        if (this.remapJoy) joy = JOY_MAP[joy];
        joy |= ((toggle & inv & 0x02) ^ 2) << 3;
        joy |= ((inv & 0x02) ^ 2) << 4;
        return joy;
      }
    }
  }
}
