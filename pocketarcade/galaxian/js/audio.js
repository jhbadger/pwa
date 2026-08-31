'use strict';

// Galaxian sound synthesis via Web Audio API.
// Real hardware drives this from discrete 555-timer/noise circuitry, not
// samples or a simple bit-triggered synth like the Space Invaders boards.
// This approximates the three audible pieces of that circuit:
//  - a continuous "marching aliens" background hum, gated on by any of the
//    FS1/FS2/FS3 channels and pitch-stepped by the 4-bit LFO DAC value
//  - a one-shot laser zap on FIRE
//  - a one-shot noise burst on HIT (covers both enemy kills and player death,
//    same as the real board's single noise gate)
// The dive-bomb siren (driven by continuous pitch_w writes) isn't sonified —
// distinguishing "siren active" from "routine per-frame service write" isn't
// derivable from the discrete circuit's memory-mapped interface alone.
class GalaxianAudio {
  constructor() {
    this.ctx = null;
    this.bgNode = null;
    this.bgGate = 0; // bitmask of which FS channels are currently on
    this.lfoVal = 0;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* no audio available */ }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  bgFreq() {
    // 16 discrete steps mapped across a couple of octaves in the bass range,
    // echoing the classic 4-note descending march pattern.
    return 80 + this.lfoVal * 9;
  }

  setLfo(val) {
    this.lfoVal = val;
    if (this.bgNode) this.bgNode.osc.frequency.setTargetAtTime(this.bgFreq(), this.ctx.currentTime, 0.02);
  }

  trigger(ch, on) {
    if (!this.ctx) return;
    if (ch <= 2) { // FS1/FS2/FS3 — background hum gate
      const bit = 1 << ch;
      this.bgGate = on ? (this.bgGate | bit) : (this.bgGate & ~bit);
      if (this.bgGate && !this.bgNode) this.startBg();
      else if (!this.bgGate && this.bgNode) this.stopBg();
    } else if (ch === 3 && on) {
      this.hit();
    } else if (ch === 5 && on) {
      this.fire();
    }
  }

  startBg() {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(this.bgFreq(), now);
    gain.gain.setValueAtTime(0.18, now);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now);
    this.bgNode = { osc, gain };
  }

  stopBg() {
    if (!this.bgNode) return;
    try { this.bgNode.osc.stop(); } catch (e) {}
    this.bgNode = null;
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
