'use strict';

// Namco WSG sound via Web Audio: 3 wavetable voices, each continuously
// re-triggered from the waveform PROM (8 waveforms x 32 4-bit samples) as
// the game updates frequency/waveform/volume registers, rather than
// discrete/one-shot synthesis like the earlier games' sound boards.
class MsPacmanAudio {
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

  setup() {
    const ctx = this.ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0; // gated by soundEnable()
    this.masterGain.connect(ctx.destination);

    // Build one 32-sample looping buffer per waveform (values are 4-bit
    // signed: (nibble & 0xF) - 8, normalized to roughly -1..1).
    const waveRom = decode_wave_1m(); // 256 bytes = 8 waveforms x 32 samples
    this.waveBuffers = [];
    for (let w = 0; w < 8; w++) {
      const buf = ctx.createBuffer(1, 32, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < 32; i++) data[i] = ((waveRom[w * 32 + i] & 0x0F) - 8) / 8;
      this.waveBuffers.push(buf);
    }

    this.voices = [0, 1, 2].map(() => ({ source: null, gain: ctx.createGain(), waveform: -1 }));
    for (const v of this.voices) v.gain.connect(this.masterGain);
  }

  soundEnable(enabled) {
    if (!this.ctx) return;
    this.masterGain.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  // freq is the raw 20-bit WSG register value; real pitch = freq * wsgClock / 2^20
  static WSG_CLOCK = 96000; // 18.432MHz / 6 / 32

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
      const hz = (freq * MsPacmanAudio.WSG_CLOCK) / 0x100000;
      v.source.playbackRate.setTargetAtTime(Math.max(hz * 32 / this.ctx.sampleRate, 0.0001), now, 0.005);
    }
    v.gain.gain.setTargetAtTime((volume / 15) * 0.28, now, 0.005);
  }
}
