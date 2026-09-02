'use strict';

// Asteroids Deluxe sound via Web Audio. Thrust and the explosion crash reuse
// the same discrete circuit as the original Asteroids board (Deluxe's
// hardware literally reuses that circuit for those two effects); everything
// else — fire, saucer, extra life, music — runs through a 4-voice POKEY chip
// on real hardware, approximated here as 4 continuously-updated oscillators
// driven by AUDF/AUDC register writes rather than a literal POKEY emulation.
class AsteroidsDeluxeAudio {
  constructor() {
    this.ctx = null;
    this.nodes = {};
    this.explodeActive = false;
    this.pokeyVoices = null;
  }

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.setupPokey(); } catch (e) {}
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setupPokey() {
    const ctx = this.ctx;
    this.pokeyVoices = [];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      this.pokeyVoices.push({ osc, gain, audf: 0, audc: 0 });
    }
  }

  pokeyWrite(reg, val) {
    if (!this.ctx || !this.pokeyVoices || reg > 7) return; // ignore AUDCTL/STIMER/etc.
    const ch = reg >> 1;
    const voice = this.pokeyVoices[ch];
    if (reg & 1) voice.audc = val; else voice.audf = val;
    const now = this.ctx.currentTime;
    const freq = Math.max(30, 110 + (255 - voice.audf) * 8);
    const vol = voice.audc & 0x0F;
    voice.osc.frequency.setValueAtTime(freq, now);
    voice.gain.gain.setValueAtTime((vol / 15) * 0.16, now);
  }

  // Only bit 3 (thrust) is wired to the discrete board on Deluxe.
  soundGate(bit, on) {
    if (!this.ctx) return;
    if (bit === 3) (on ? this.startThrust() : this.stopThrust());
  }

  explode(volume, pitchDivider) {
    if (!this.ctx) return;
    if (volume > 0 && !this.explodeActive) {
      this.explodeActive = true;
      this.explosionBurst(volume, pitchDivider);
    } else if (volume === 0) {
      this.explodeActive = false;
    }
  }

  startThrust() {
    if (this.nodes.thrust) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const bufSize = ctx.sampleRate;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass'; bandpass.frequency.value = 90; bandpass.Q.value = 0.6;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass'; lowpass.frequency.value = 160;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.5, now);
    src.connect(bandpass); bandpass.connect(lowpass); lowpass.connect(gain); gain.connect(ctx.destination);
    src.start(now);
    this.nodes.thrust = { src };
  }
  stopThrust() {
    const n = this.nodes.thrust; if (!n) return;
    try { n.src.stop(); } catch (e) {}
    delete this.nodes.thrust;
  }

  explosionBurst(volume, pitchDivider) {
    const ctx = this.ctx, now = ctx.currentTime;
    const freq = Math.max(3000 / Math.max(pitchDivider, 1), 100);
    const dur = 0.15 + volume * 0.03;
    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(volume / 15, 1) * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }
}
