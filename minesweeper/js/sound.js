// Synthesized sound effects for Minesweeper — Web Audio only, no audio
// files. Keeps the app self-contained (nothing to precache or license),
// same approach as the Piano, Slots, and Video Poker apps.

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

// A single tapped cell turning face-up — a soft, dry pop.
export function playReveal() {
  const ctx = ensureAudio();
  noiseBurst(ctx.currentTime, 0.04, { freq: 1400, q: 3, gain: 0.18 });
}

// A flood-fill that opened up a lot of cells at once gets a soft rising
// sweep layered on top of the reveal pop, scaled a little by how many cells
// opened — small cascades barely register, big ones read as satisfying.
export function playCascade(count) {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const duration = Math.min(0.06 + count * 0.004, 0.22);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.min(0.05 + count * 0.01, 0.22), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(500, t0);
  filter.frequency.exponentialRampToValueAtTime(2400, t0 + duration);
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

export function playFlag() {
  tone(880, ensureAudio().currentTime, 0.09, { type: 'square', gain: 0.14 });
}

export function playUnflag() {
  tone(520, ensureAudio().currentTime, 0.09, { type: 'square', gain: 0.12 });
}

// A chord (tap on a satisfied number) is functionally several reveals at
// once — same sound family as playCascade, but not scaled by count since a
// chord is a single deliberate action regardless of how many cells it opens.
export function playChord() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.05, { freq: 1600, q: 2.5, gain: 0.2 });
  noiseBurst(t0 + 0.035, 0.05, { freq: 1200, q: 2.5, gain: 0.16 });
}

export function playExplosion() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.35, { freq: 220, q: 0.5, gain: 0.4, type: 'lowpass' });
  tone(90, t0, 0.4, { type: 'sawtooth', gain: 0.22 });
  tone(55, t0 + 0.05, 0.5, { type: 'sine', gain: 0.28 });
}

const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6

export function playWin() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  CHIME.forEach((f, i) => tone(f, t0 + i * 0.09, 0.4, { type: 'triangle', gain: 0.28 }));
}
