'use strict';

// Galaxian sound synthesis via Web Audio API.
// Real hardware drives this from discrete 555-timer/noise circuitry, not
// samples or a simple bit-triggered synth like the Space Invaders boards.
// This approximates three audible pieces of that circuit:
//  - the dive-bomb/fanfare siren, driven by the pitch_w byte: the ROM writes
//    0xFF as an idle sentinel almost every frame and only deviates from it
//    while an actual siren sweep (start jingle, enemy dive) is in progress,
//    so 0xFF-vs-not is what gates this tone on and off
//  - a one-shot laser zap on FIRE
//  - a one-shot noise burst on HIT (covers both enemy kills and player death,
//    same as the real board's single noise gate)
// The FS1/FS2/FS3-gated background hum and the 4-bit LFO DAC value that
// would pitch it aren't sonified — no synth approximation of that circuit
// sounded like the source material, so it's left silent.
class GalaxianAudio {
  constructor() {
    this.ctx = null;
    this.pitchNode = null;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* no audio available */ }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  pitchFreq(val) {
    // Empirically, higher pitch_w values correspond to higher pitch: the
    // start-of-wave fanfare counts up through it (rising tone) and enemy
    // dives count down through it (falling "swoop").
    return 200 + (val / 255) * 1200;
  }

  setPitch(val) {
    if (!this.ctx) return;
    if (val === 0xFF) {
      this.stopPitch();
      return;
    }
    const freq = this.pitchFreq(val);
    if (!this.pitchNode) this.startPitch(freq);
    else this.pitchNode.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.003);
  }

  startPitch(freq) {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now);
    this.pitchNode = { osc, gain };
  }

  stopPitch() {
    if (!this.pitchNode) return;
    const { osc, gain } = this.pitchNode;
    const now = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, now, 0.01);
    try { osc.stop(now + 0.05); } catch (e) {}
    this.pitchNode = null;
  }

  trigger(ch, on) {
    if (!this.ctx) return;
    if (ch === 3 && on) {
      this.hit();
    } else if (ch === 5 && on) {
      this.fire();
    }
  }

  fire() {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.15);
  }

  hit() {
    const ctx = this.ctx, now = ctx.currentTime;
    const dur = 0.3;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }
}
