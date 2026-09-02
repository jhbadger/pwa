'use strict';

// Battlezone sound via Web Audio — a stylistic re-creation of the arcade's
// discrete sound board (see js/roms.js's sibling comment and bzone_a.cpp),
// not a component-level analog simulation. The $1840 sound-latch bits
// (from Al Kossow's notes, quoted in bzone_a.cpp):
//   D7 motor enable      D6 start LED        D5 sound enable (master mute)
//   D4 engine rev enable D3 shell loud/soft  D2 shell enable
//   D1 explosion loud/soft                    D0 explosion enable
// plus 4 stylized POKEY tone channels (js/pokey.js) for the radar/alert
// tones, polled once a frame like the rest of this app's sound update loop.
class BattlezoneAudio {
  constructor() {
    this.ctx = null;
    this.nodes = {};
    this.engineRev = 0;
    this.prevBits = 0;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.setup();
    } catch (e) {}
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noiseSource() {
    const ctx = this.ctx;
    const bufSize = ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.start();
    return src;
  }

  setup() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);

    // Engine: the hardware notes describe "an integrated square wave (saw
    // tooth) frequency modulated by engine rev" — a 555 VCO whose CV ramps
    // via an RC network while the rev bit is held. We approximate with a
    // sawtooth oscillator whose pitch ramps toward a cap while ENGREV is
    // held and decays back down otherwise.
    const engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 40;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineGain); engineGain.connect(this.master);
    engineOsc.start();
    this.nodes.engineOsc = engineOsc;
    this.nodes.engineGain = engineGain;

    // Shell (cannon fire) and Explosion: independent noise voices, shaped
    // and gated by a decay envelope on each enable bit's rising edge —
    // approximating the RC-gated noise circuits in bzone_a.cpp.
    for (const name of ['shell', 'explosion']) {
      const src = this.noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = name === 'shell' ? 'highpass' : 'lowpass';
      filter.frequency.value = name === 'shell' ? 900 : 350;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter); filter.connect(gain); gain.connect(this.master);
      this.nodes[name + 'Gain'] = gain;
    }

    // Pokey-lite: 4 stylized tone channels (see js/pokey.js).
    this.nodes.pokey = [];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain); gain.connect(this.master);
      osc.start();
      this.nodes.pokey.push({ osc, gain });
    }
  }

  // bits: the raw byte last written to $1840. pokeyChannels: the array
  // from Pokey.channels(), or null/undefined to leave those voices as-is.
  update(bits, pokeyChannels) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const motorEnable = !!(bits & 0x80);
    const soundEnable = !!(bits & 0x20);
    const engRev = !!(bits & 0x10);
    const shellLoud = !!(bits & 0x08);
    const shellEnable = !!(bits & 0x04);
    const explodeLoud = !!(bits & 0x02);
    const explodeEnable = !!(bits & 0x01);

    this.master.gain.setTargetAtTime(soundEnable ? 1 : 0, now, 0.01);

    this.engineRev = Math.max(0, Math.min(1, this.engineRev + (engRev ? 0.05 : -0.05)));
    this.nodes.engineOsc.frequency.setTargetAtTime(40 + this.engineRev * 160, now, 0.05);
    this.nodes.engineGain.gain.setTargetAtTime(
      motorEnable ? (0.07 + this.engineRev * 0.09) : 0, now, 0.05);

    if (shellEnable && !(this.prevBits & 0x04)) this.fireBurst('shell', shellLoud, 0.25);
    if (explodeEnable && !(this.prevBits & 0x01)) this.fireBurst('explosion', explodeLoud, 0.6);
    this.prevBits = bits;

    if (pokeyChannels) {
      for (let i = 0; i < 4; i++) {
        const ch = pokeyChannels[i];
        const node = this.nodes.pokey[i];
        const vol = ch.pure ? (ch.volume / 15) * 0.12 : 0;
        node.gain.gain.setTargetAtTime(vol, now, 0.01);
        if (vol > 0 && isFinite(ch.freq) && ch.freq > 0) {
          node.osc.frequency.setTargetAtTime(Math.min(ch.freq, 8000), now, 0.005);
        }
      }
    }
  }

  fireBurst(name, loud, decaySeconds) {
    const ctx = this.ctx;
    const gain = this.nodes[name + 'Gain'];
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(loud ? 0.5 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decaySeconds);
  }
}
