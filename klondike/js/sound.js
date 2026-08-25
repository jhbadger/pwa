// Synthesized sound effects for Klondike — Web Audio only, no audio files.
// Keeps the app self-contained (nothing to precache or license), same
// approach as the Piano, Slots, Video Poker, Minesweeper, and Peg Solitaire apps.

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

function noiseBurst(t0, duration, { freq = 800, q = 1, gain = 0.3, type = 'bandpass' } = {}) {
  const ctx = ensureAudio();
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

// A crisp high-passed tick — the snap of one card sliding past another.
export function playFlip() {
  noiseBurst(ensureAudio().currentTime, 0.045, { freq: 2200, q: 1.2, gain: 0.16, type: 'highpass' });
}

export function playDeal() {
  noiseBurst(ensureAudio().currentTime, 0.04, { freq: 1800, q: 1.5, gain: 0.14, type: 'highpass' });
}

export function playPlace() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.05, { freq: 1200, q: 1.2, gain: 0.16, type: 'highpass' });
  tone(180, t0, 0.05, { type: 'sine', gain: 0.06 });
}

export function playFoundation() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(880, t0, 0.1, { type: 'triangle', gain: 0.18 });
  tone(1318.5, t0 + 0.05, 0.14, { type: 'triangle', gain: 0.16 });
}

export function playInvalid() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(180, t0, 0.12, { type: 'square', gain: 0.08 });
}

export function playRecycle() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  for (let i = 0; i < 4; i++) {
    noiseBurst(t0 + i * 0.045, 0.04, { freq: 1600 - i * 150, q: 1.3, gain: 0.12, type: 'highpass' });
  }
}

export function playUndo() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(500, t0, 0.08, { type: 'square', gain: 0.14 });
  tone(380, t0 + 0.06, 0.08, { type: 'square', gain: 0.12 });
}

const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6

export function playWin() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const run = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0, 2093.0];
  run.forEach((f, i) => tone(f, t0 + i * 0.08, 0.5, { type: 'triangle', gain: 0.3 }));
  for (let i = 0; i < 10; i++) {
    const t = t0 + 0.56 + i * 0.06 + Math.random() * 0.03;
    tone(1500 + Math.random() * 1200, t, 0.18, { type: 'sine', gain: 0.14 });
  }
}

export function playAutoMove(i) {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const f = CHIME[Math.min(i, CHIME.length - 1)];
  tone(f, t0, 0.12, { type: 'triangle', gain: 0.16 });
}
