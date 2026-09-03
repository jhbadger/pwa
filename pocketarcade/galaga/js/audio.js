'use strict';

// Galaga sound via Web Audio: the same Namco WSG 3-voice wavetable
// synthesis as Pac-Man (identical chip, identical register math — see
// pacman/js/audio.js), plus stylized bursts for the Namco 54XX's three
// canned sound-effect types (explosion-ish noise, not a discrete/MCU
// simulation — see js/namco54.js for why).
class GalagaAudio {
  constructor() {
    this.ctx = null;
    this.voices = null;
    this.masterGain = null;
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

  setup(waveRom) {
    const ctx = this.ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(ctx.destination);

    // 8 waveforms x 32 4-bit signed samples, same layout as Pac-Man's WSG.
    this.waveBuffers = [];
    for (let w = 0; w < 8; w++) {
      const buf = ctx.createBuffer(1, 32, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < 32; i++) data[i] = ((waveRom[w * 32 + i] & 0x0F) - 8) / 8;
      this.waveBuffers.push(buf);
    }

    this.voices = [0, 1, 2].map(() => ({ source: null, gain: ctx.createGain(), waveform: -1 }));
    for (const v of this.voices) v.gain.connect(this.masterGain);

    // 54XX effect voices: independent shaped noise bursts per type.
    this.fx = {};
    const shapes = { A: 700, B: 300, C: 1200 };
    for (const type of ['A', 'B', 'C']) {
      const src = this.noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = shapes[type];
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
      this.fx[type] = gain;
    }
  }

  // freq is the raw 20-bit WSG register value; real pitch = freq * WSG_CLOCK / 2^20
  static WSG_CLOCK = 96000; // 18.432MHz / 6 / 32, same derivation as Pac-Man

  voiceUpdate(ch, freq, waveform, volume) {
    if (!this.ctx || !this.voices) return;
    const v = this.voices[ch];
    const now = this.ctx.currentTime;

    if (waveform !== v.waveform) {
      v.waveform = waveform;
      if (v.source) { try { v.source.stop(); } catch (e) {} }
      const source = this.ctx.createBufferSource();
      source.buffer = this.waveBuffers[waveform];
      source.loop = true;
      source.connect(v.gain);
      source.start(now);
      v.source = source;
    }
    if (v.source) {
      const hz = (freq * GalagaAudio.WSG_CLOCK) / 0x100000;
      v.source.playbackRate.setTargetAtTime(Math.max(hz * 32 / this.ctx.sampleRate, 0.0001), now, 0.005);
    }
    v.gain.gain.setTargetAtTime((volume / 15) * 0.28, now, 0.005);
  }

  soundEffect(type, volume) {
    if (!this.ctx || !this.fx[type]) return;
    const now = this.ctx.currentTime;
    const gain = this.fx[type];
    const peak = 0.15 + (volume / 15) * 0.35;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (type === 'C' ? 0.5 : 0.3));
  }
}
