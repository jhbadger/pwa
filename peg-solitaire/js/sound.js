// Synthesized sound effects for Peg Solitaire — Web Audio only, no audio
// files. Keeps the app self-contained (nothing to precache or license),
// same approach as the Piano, Slots, Video Poker, and Minesweeper apps.

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

export function playSelect() {
  tone(700, ensureAudio().currentTime, 0.07, { type: 'sine', gain: 0.14 });
}

export function playDeselect() {
  tone(420, ensureAudio().currentTime, 0.07, { type: 'sine', gain: 0.1 });
}

// A peg jump reads as two short wooden knocks — the lift and the landing —
// followed a beat later by a softer knock for the jumped peg being lifted
// out of the board.
export function playJump() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.05, { freq: 900, q: 3, gain: 0.28 });
  noiseBurst(t0 + 0.09, 0.06, { freq: 700, q: 3, gain: 0.3 });
}

export function playRemove() {
  noiseBurst(ensureAudio().currentTime, 0.05, { freq: 500, q: 2.5, gain: 0.2 });
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
  CHIME.slice(0, 4).forEach((f, i) => tone(f, t0 + i * 0.1, 0.35, { type: 'triangle', gain: 0.26 }));
}

// The "perfect" finish — last peg dead center — gets the full fanfare.
export function playPerfectWin() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const run = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0, 2093.0];
  run.forEach((f, i) => tone(f, t0 + i * 0.08, 0.5, { type: 'triangle', gain: 0.3 }));
  for (let i = 0; i < 10; i++) {
    const t = t0 + 0.56 + i * 0.06 + Math.random() * 0.03;
    tone(1500 + Math.random() * 1200, t, 0.18, { type: 'sine', gain: 0.14 });
  }
}

export function playStuck() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(220, t0, 0.3, { type: 'sawtooth', gain: 0.1 });
  tone(174.6, t0 + 0.1, 0.35, { type: 'sawtooth', gain: 0.09 });
}
