'use strict';

// Space Invaders sound synthesis via Web Audio API
class SIAudio {
  constructor() {
    this.ctx = null;
    this.nodes = {};
    this.channels = [
      'ufoLoop',   // ch 0: port3 bit0 - UFO (continuous)
      'shot',      // ch 1: port3 bit1
      'playerDie', // ch 2: port3 bit2
      'invDie',    // ch 3: port3 bit3
      'extended',  // ch 4: port3 bit4
      null, null, null,
      'fleet1',    // ch 8:  port5 bit0
      'fleet2',    // ch 9:  port5 bit1
      'fleet3',    // ch 10: port5 bit2
      'fleet4',    // ch 11: port5 bit3
      'ufoHit',    // ch 12: port5 bit4
    ];
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  trigger(ch, on) {
    if (!this.ctx) return;
    const name = this.channels[ch];
    if (!name) return;
    if (on) this.play(name);
    else if (name === 'ufoLoop') this.stop(name);
  }

  play(name) {
    if (!this.ctx) return;
    this.stop(name);
    const ctx = this.ctx;
    const now = ctx.currentTime;

    switch (name) {
      case 'ufoLoop': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(30, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now);
        this.nodes[name] = { osc, gain };
        // Loop via disconnect/reconnect
        const loop = () => {
          if (!this.nodes[name]) return;
          osc.frequency.setValueAtTime(120, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(30, ctx.currentTime + 0.5);
          setTimeout(loop, 500);
        };
        setTimeout(loop, 500);
        break;
      }
      case 'shot': this.burst(name, 'square', 800, 200, 0.15, 0.12); break;
      case 'playerDie': this.noise(name, 0.6, 0.25); break;
      case 'invDie': this.burst(name, 'square', 300, 60, 0.25, 0.15); break;
      case 'extended': this.burst(name, 'sine', 600, 600, 0.2, 0.3); break;
      case 'fleet1': this.thump(name, 160); break;
      case 'fleet2': this.thump(name, 140); break;
      case 'fleet3': this.thump(name, 120); break;
      case 'fleet4': this.thump(name, 100); break;
      case 'ufoHit': this.noise(name, 0.4, 0.4); break;
    }
  }

  burst(name, type, freqStart, freqEnd, vol, dur) {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  thump(name, freq) {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.1);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.1);
  }

  noise(name, vol, dur) {
    const ctx = this.ctx, now = ctx.currentTime;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(gain); gain.connect(ctx.destination);
    src.start(now); src.stop(now + dur);
  }

  stop(name) {
    const n = this.nodes[name];
    if (n) { try { n.osc.stop(); } catch(e) {} delete this.nodes[name]; }
  }
}
