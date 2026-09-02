'use strict';

// Asteroids sound via Web Audio — a stylistic re-creation of the arcade's
// discrete sound board (VCOs, filtered noise, decaying-tone "fire" bursts),
// not a literal circuit simulation.
class AsteroidsAudio {
  constructor() {
    this.ctx = null;
    this.nodes = {};
    this.saucerSel = 0;
    this.explodeActive = false;
    this.lastThumpTime = -1;
  }

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // bit: 0 saucer engine, 1 saucer fire, 2 saucer size select, 3 thrust,
  // 4 ship fire, 5 extra life
  soundGate(bit, on) {
    if (!this.ctx) return;
    switch (bit) {
      case 0: on ? this.startSaucer() : this.stopSaucer(); break;
      case 1: if (on) this.saucerFire(); break;
      case 2: this.saucerSel = on ? 1 : 0; this.updateSaucerRange(); break;
      case 3: on ? this.startThrust() : this.stopThrust(); break;
      case 4: if (on) this.shipFire(); break;
      case 5: if (on) this.lifeBeep(); break;
    }
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

  thump(enabled, data) {
    if (!this.ctx || !enabled) return;
    const now = this.ctx.currentTime;
    if (now - this.lastThumpTime < 0.05) return; // dedupe rapid re-writes of the same beat
    this.lastThumpTime = now;
    const freq = 55 + data * 9;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(now); osc.stop(now + 0.12);
  }

  startSaucer() {
    if (this.nodes.saucer) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const carrier = ctx.createOscillator();
    carrier.type = 'triangle';
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    this.applySaucerParams(carrier, lfo, lfoGain, now);
    lfo.connect(lfoGain); lfoGain.connect(carrier.frequency);
    gain.gain.setValueAtTime(0.25, now);
    carrier.connect(gain); gain.connect(ctx.destination);
    carrier.start(now); lfo.start(now);
    this.nodes.saucer = { carrier, lfo, lfoGain };
  }
  applySaucerParams(carrier, lfo, lfoGain, now) {
    const base = this.saucerSel ? 500 : 750; // large saucer is lower-pitched
    const warbleRate = this.saucerSel ? 5.75 : 8.25;
    lfo.frequency.setValueAtTime(warbleRate, now);
    lfoGain.gain.setValueAtTime(150, now);
    carrier.frequency.setValueAtTime(base, now);
  }
  updateSaucerRange() {
    const n = this.nodes.saucer;
    if (n) this.applySaucerParams(n.carrier, n.lfo, n.lfoGain, this.ctx.currentTime);
  }
  stopSaucer() {
    const n = this.nodes.saucer; if (!n) return;
    try { n.carrier.stop(); n.lfo.stop(); } catch (e) {}
    delete this.nodes.saucer;
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

  shipFire() { this.decayTone(820, 110, 0.28, 0.42); }
  saucerFire() { this.decayTone(830, 630, 0.28, 0.4); }
  decayTone(f0, f1, dur, vol) {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  lifeBeep() {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(3000, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.setValueAtTime(0.25, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.15);
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
