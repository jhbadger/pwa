// Synthesized sound effects for Video Poker — Web Audio only, no audio
// files. Keeps the app self-contained (nothing to precache or license) and
// matches how the Piano app synthesizes its notes rather than sampling them,
// and how the Slots app synthesizes its reel/win effects.

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

// White noise through a bandpass filter reads as a mechanical
// click/snap/flick far better than any oscillator — real clicks are noise,
// not tone. Used here for the "riffle" of a card being dealt or drawn.
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

// A single dealt/replaced card's snap. `index` staggers a run of these
// (dealing 5 cards, or redrawing several at once) into an audible riffle
// instead of one simultaneous thud.
export function playCardDeal(index = 0) {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime + index * 0.07;
  noiseBurst(t0, 0.045, { freq: 2200, q: 4, gain: 0.22 });
}

export function playHoldToggle(held) {
  const ctx = ensureAudio();
  tone(held ? 660 : 420, ctx.currentTime, 0.09, { type: 'square', gain: 0.15 });
}

const CHIME = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6

// multiplier is the hand's payout in multiples of Bet (handPayout()/Bet) —
// bigger hands get more notes, so a low pair's win doesn't sound the same
// as a full house.
export function playWin(multiplier) {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const notes = multiplier >= 25 ? CHIME.length : multiplier >= 9 ? 4 : multiplier >= 3 ? 3 : 2;
  for (let i = 0; i < notes; i++) {
    tone(CHIME[i % CHIME.length], t0 + i * 0.09, 0.35, { type: 'triangle', gain: 0.28 });
  }
}

export function playJackpot() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const run = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0, 2093.0];
  run.forEach((f, i) => tone(f, t0 + i * 0.075, 0.5, { type: 'triangle', gain: 0.3 }));
  // Coin-cascade tail: a burst of short high plinks.
  for (let i = 0; i < 14; i++) {
    const t = t0 + 0.5 + i * 0.06 + Math.random() * 0.03;
    tone(1500 + Math.random() * 1200, t, 0.18, { type: 'sine', gain: 0.14 });
  }
}

export function playPush() {
  tone(392, ensureAudio().currentTime, 0.25, { type: 'sine', gain: 0.18 });
}

export function playLose() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  tone(180, t0, 0.3, { type: 'sawtooth', gain: 0.1 });
  tone(140, t0 + 0.08, 0.3, { type: 'sawtooth', gain: 0.08 });
}

export function playOutOfMoney() {
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  [220, 196, 174.6, 146.8].forEach((f, i) => tone(f, t0 + i * 0.16, 0.3, { type: 'sawtooth', gain: 0.12 }));
}
