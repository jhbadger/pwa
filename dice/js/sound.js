// Synthesized sound effects for the dice roller — Web Audio only, no audio
// files, matching how Slots and Klondike synthesize their effects rather
// than sampling them.

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, t0, duration, { type = 'sine', gain = 0.25, attack = 0.005 } = {}) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function sweep(freqFrom, freqTo, t0, duration, opts = {}) {
  const ctx = ensureAudio();
  const { type = 'sine', gain = 0.25, attack = 0.005 } = opts;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// White noise through a bandpass filter reads as a knock/clack/rattle far
// better than any oscillator — real dice hitting a table are noise, not tone.
function noiseBurst(t0, duration, { freq = 800, q = 1, gain = 0.3 } = {}) {
  const ctx = ensureAudio();
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

// Bigger dice read as heavier/lower-pitched — a d100 should sound like it
// thuds, a d4 like it clicks.
function pitchForSides(sides) {
  return 1400 / Math.sqrt(sides);
}

export function playAddDie(sides) {
  const ctx = ensureAudio();
  tone(pitchForSides(sides) + 300, ctx.currentTime, 0.1, { type: 'triangle', gain: 0.2 });
}

export function playRemoveDie(sides) {
  const ctx = ensureAudio();
  sweep(pitchForSides(sides) + 200, pitchForSides(sides) * 0.6, ctx.currentTime, 0.12, { type: 'triangle', gain: 0.16 });
}

// A quick shake-in-the-cup rattle before the dice tumble, scaled gently with
// how many are about to roll so a big pool sounds appropriately busier.
export function playRollStart(diceCount) {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const shakes = Math.min(5, 3 + Math.floor(diceCount / 6));
  for (let i = 0; i < shakes; i++) {
    const t = t0 + i * 0.09 + Math.random() * 0.02;
    noiseBurst(t, 0.07, { freq: 900 + Math.random() * 400, q: 0.8, gain: 0.22 });
  }
}

// One clack per die as it lands, pitched by its size.
export function playDieLand(sides) {
  const ctx = ensureAudio();
  const freq = pitchForSides(sides) * 1.3;
  noiseBurst(ctx.currentTime, 0.08, { freq, q: 1.4, gain: 0.28 });
}

// A natural max on a d20 (or a whole-pool max) — a little fanfare.
const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
export function playCritical() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  CHIME.forEach((f, i) => tone(f, t0 + i * 0.075, 0.35, { type: 'triangle', gain: 0.28 }));
}

// A natural 1 on a d20 — a comedic descending "womp".
export function playFumble() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  sweep(220, 90, t0, 0.35, { type: 'sawtooth', gain: 0.22 });
  sweep(180, 70, t0 + 0.1, 0.35, { type: 'sawtooth', gain: 0.16 });
}

// A short pluck marking a hold toggle — rising when a die is held, falling
// when it's released, pitched like the die itself.
export function playHold(sides, held) {
  const ctx = ensureAudio();
  const freq = pitchForSides(sides) + 500;
  tone(held ? freq : freq * 0.72, ctx.currentTime, 0.08, { type: 'sine', gain: 0.16 });
}

export function playClear() {
  const ctx = ensureAudio();
  sweep(600, 120, ctx.currentTime, 0.2, { type: 'sine', gain: 0.18 });
}
