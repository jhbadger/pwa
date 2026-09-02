'use strict';

// Lunar Lander sound via Web Audio — a stylistic re-creation of the arcade's
// discrete sound board. Unlike Asteroids' one-shot bursts, this hardware's
// four channels (thrust, explosion, two warning tones) are all continuous
// gates/levels the game holds open for as long as needed, so each is a
// persistent node graph whose gain we update live rather than a retriggered
// one-shot.
class LunarLanderAudio {
  constructor() {
    this.ctx = null;
    this.nodes = {};
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.setup();
    } catch (e) {}
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noiseLoop(filterFn) {
    const ctx = this.ctx;
    const bufSize = ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const out = filterFn(src);
    out.connect(gain); gain.connect(ctx.destination);
    src.start();
    return gain;
  }

  makeTone(freq) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    return gain;
  }

  setup() {
    const ctx = this.ctx;

    this.nodes.thrust = this.noiseLoop(src => {
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass'; bandpass.frequency.value = 90; bandpass.Q.value = 0.6;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass'; lowpass.frequency.value = 160;
      src.connect(bandpass); bandpass.connect(lowpass);
      return lowpass;
    });

    this.nodes.explode = this.noiseLoop(src => {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass'; lowpass.frequency.value = 500;
      src.connect(lowpass);
      return lowpass;
    });

    this.nodes.tone3k = this.makeTone(3000);
    this.nodes.tone6k = this.makeTone(6000);
  }

  // thrustVol: 0-7. explodeOn/tone3kOn/tone6kOn: booleans.
  update(thrustVol, explodeOn, tone3kOn, tone6kOn) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.nodes.thrust.gain.setTargetAtTime((thrustVol / 7) * 0.5, now, 0.02);
    this.nodes.explode.gain.setTargetAtTime(explodeOn ? 0.45 : 0, now, 0.02);
    this.nodes.tone3k.gain.setTargetAtTime(tone3kOn ? 0.15 : 0, now, 0.01);
    this.nodes.tone6k.gain.setTargetAtTime(tone6kOn ? 0.12 : 0, now, 0.01);
  }

  noiseReset() {} // no discrete LFSR to resync in this synthesis
}
