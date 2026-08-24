// Synthesized sound effects for Pipe Dream — Web Audio only, no audio
// files. Keeps the app self-contained (nothing to precache or license),
// same approach as the other apps in this collection.

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

export function playPlace() {
  noiseBurst(ensureAudio().currentTime, 0.05, { freq: 700, q: 3, gain: 0.22 });
}

export function playInvalid() {
  tone(160, ensureAudio().currentTime, 0.12, { type: 'square', gain: 0.12 });
}

// A short, soft gurgle for each segment the water advances into — quiet
// enough to tick along under the countdown/placement sounds without
// becoming grating over a long-running game.
export function playFlowTick() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.07, { freq: 1400, q: 1.2, gain: 0.1, type: 'lowpass' });
}

export function playCountdownTick(secondsLeft) {
  const urgent = secondsLeft <= 3;
  tone(urgent ? 880 : 660, ensureAudio().currentTime, 0.08, { type: 'square', gain: urgent ? 0.16 : 0.1 });
}

export function playFlowStart() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(392, t0, 0.15, { type: 'triangle', gain: 0.2 });
  tone(523.25, t0 + 0.1, 0.2, { type: 'triangle', gain: 0.22 });
}

export function playSpeedUp() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(523.25, t0, 0.08, { type: 'triangle', gain: 0.18 });
  tone(659.25, t0 + 0.06, 0.1, { type: 'triangle', gain: 0.2 });
}

export function playLeak() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  noiseBurst(t0, 0.3, { freq: 300, q: 0.6, gain: 0.35, type: 'lowpass' });
  tone(110, t0 + 0.05, 0.4, { type: 'sawtooth', gain: 0.2 });
  tone(82.4, t0 + 0.18, 0.45, { type: 'sawtooth', gain: 0.18 });
}

const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6

export function playNewHighScore() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  CHIME.forEach((f, i) => tone(f, t0 + i * 0.08, 0.4, { type: 'triangle', gain: 0.26 }));
}
