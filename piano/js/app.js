import { SONGS } from './songs.js';
import { buildKeyboard, noteFrequency } from './keyboard.js';

// ------------------------------------------------------------------ dom refs

const keyboardEl = document.getElementById('keyboard');
const statusEl = document.getElementById('status');
const songSelect = document.getElementById('songSelect');
const btnDemo = document.getElementById('btnDemo');
const btnRestart = document.getElementById('btnRestart');
const toastEl = document.getElementById('toast');

// ------------------------------------------------------------------ keyboard DOM

const { white, black, totalWhite } = buildKeyboard();
const whiteKeyPct = 100 / totalWhite;
const blackKeyPct = whiteKeyPct * 0.62;

const keyEls = new Map(); // note -> element

for (const { note } of white) {
  const el = document.createElement('div');
  el.className = 'key white';
  el.dataset.note = note;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = note.slice(0, -1);
  el.appendChild(label);
  keyboardEl.appendChild(el);
  keyEls.set(note, el);
}

for (const { note, afterWhiteIndex } of black) {
  const el = document.createElement('div');
  el.className = 'key black';
  el.dataset.note = note;
  el.style.left = `${(afterWhiteIndex + 1) * whiteKeyPct - blackKeyPct / 2}%`;
  el.style.width = `${blackKeyPct}%`;
  keyboardEl.appendChild(el);
  keyEls.set(note, el);
}

// ------------------------------------------------------------------ audio

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// A short percussive envelope (fast attack, decay to a lower sustain, quick
// release) reads far more like a plucked/struck note than a flat tone.
function startVoice(note) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = noteFrequency(note);
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  return { osc, gain };
}

function stopVoice(voice) {
  const t = audioCtx.currentTime;
  voice.gain.gain.cancelScheduledValues(t);
  voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), t);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  voice.osc.stop(t + 0.24);
}

// ------------------------------------------------------------------ key press tracking
//
// Keyed by pointerId so multiple simultaneous touches (or mouse + touch) each
// get their own oscillator — that's what makes chords possible.

const activeVoices = new Map(); // pointerId -> { osc, gain, note, el }

function updatePressedVisual(el) {
  const stillActive = [...activeVoices.values()].some((v) => v.el === el);
  el.classList.toggle('pressed', stillActive);
}

function noteOn(pointerId, el) {
  if (activeVoices.has(pointerId)) return;
  const note = el.dataset.note;
  const voice = startVoice(note);
  activeVoices.set(pointerId, { ...voice, note, el });
  updatePressedVisual(el);
  handleSongProgress(note);
}

function noteOff(pointerId) {
  const voice = activeVoices.get(pointerId);
  if (!voice) return;
  stopVoice(voice);
  activeVoices.delete(pointerId);
  updatePressedVisual(voice.el);
}

keyboardEl.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  const el = e.target.closest('.key');
  if (!el) return;
  // Capture keeps the up/cancel event anchored to this key even if the finger
  // drifts, so a stray release doesn't leave the note stuck on. It can throw
  // in edge cases (pointer already gone) — that shouldn't stop the note firing.
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  noteOn(e.pointerId, el);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  keyboardEl.addEventListener(type, (e) => noteOff(e.pointerId));
}

// Stop iOS's copy/select callout bar from popping up on repeated taps. Doesn't
// block pointerdown/up (only the synthetic click Android fires after a tap),
// so key presses are unaffected; buttons/select are exempted so they still work.
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button') || e.target.closest('select')) return;
  e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------------ songs / learn mode

const state = { mode: 'free', songId: null, stepIndex: 0, demoPlaying: false, demoToken: 0 };

function currentSong() { return SONGS.find((s) => s.id === state.songId); }
function currentTargetNote() {
  const song = currentSong();
  if (!song || state.stepIndex >= song.notes.length) return null;
  return song.notes[state.stepIndex].note;
}

function clearHighlight() {
  for (const el of keyEls.values()) el.classList.remove('next');
}

function highlightCurrent() {
  clearHighlight();
  const note = currentTargetNote();
  if (note) keyEls.get(note).classList.add('next');
}

function renderStatus() {
  if (state.mode === 'free') {
    statusEl.textContent = 'Play freely, or pick a song below to learn it.';
    return;
  }
  const song = currentSong();
  if (state.stepIndex >= song.notes.length) {
    statusEl.textContent = `Nice work — ${song.title} complete! Tap Restart to play it again.`;
  } else {
    statusEl.textContent = `${song.title} — note ${state.stepIndex + 1} of ${song.notes.length}`;
  }
}

function handleSongProgress(note) {
  if (state.mode !== 'learn' || state.demoPlaying) return;
  if (note !== currentTargetNote()) return;
  state.stepIndex++;
  highlightCurrent();
  renderStatus();
}

function selectSong(id) {
  stopDemo();
  state.mode = id ? 'learn' : 'free';
  state.songId = id || null;
  state.stepIndex = 0;
  btnDemo.hidden = !id;
  btnRestart.hidden = !id;
  highlightCurrent();
  renderStatus();
}

for (const song of SONGS) {
  const opt = document.createElement('option');
  opt.value = song.id;
  opt.textContent = song.title;
  songSelect.appendChild(opt);
}
songSelect.addEventListener('change', () => selectSong(songSelect.value));

btnRestart.addEventListener('click', () => {
  stopDemo();
  state.stepIndex = 0;
  highlightCurrent();
  renderStatus();
});

// ---------- demo playback (auto-advances the same highlight, at tempo) ----------

const BEAT_MS = 380;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stopDemo() {
  state.demoToken++;
  state.demoPlaying = false;
  btnDemo.textContent = '▶ Demo';
}

async function playDemo() {
  const song = currentSong();
  if (!song) return;
  const token = ++state.demoToken;
  state.demoPlaying = true;
  btnDemo.textContent = '⏸ Stop';
  for (let i = 0; i < song.notes.length; i++) {
    const { note, dur } = song.notes[i];
    state.stepIndex = i;
    highlightCurrent();
    renderStatus();
    const el = keyEls.get(note);
    const voice = startVoice(note);
    el.classList.add('pressed');
    await delay(BEAT_MS * dur * 0.82);
    if (state.demoToken !== token) { stopVoice(voice); el.classList.remove('pressed'); return; }
    stopVoice(voice);
    el.classList.remove('pressed');
    await delay(BEAT_MS * dur * 0.18);
    if (state.demoToken !== token) return;
  }
  if (state.demoToken !== token) return;
  state.demoPlaying = false;
  btnDemo.textContent = '▶ Demo';
  state.stepIndex = 0;
  highlightCurrent();
  renderStatus();
}

btnDemo.addEventListener('click', () => {
  if (state.demoPlaying) {
    stopDemo();
    state.stepIndex = 0;
    highlightCurrent();
    renderStatus();
  } else {
    playDemo();
  }
});

renderStatus();

// ---------- service worker: install-once cache, background updates ----------
// (registration itself happens in index.html's head, during parse)

if ('serviceWorker' in navigator) {
  let priorControllerURL = navigator.serviceWorker.controller
    && navigator.serviceWorker.controller.scriptURL;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const newURL = navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.scriptURL;
    if (priorControllerURL && newURL === priorControllerURL) {
      showToast('Updated — tap to refresh', () => window.location.reload());
    }
    priorControllerURL = newURL;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((reg) => {
      const update = () => reg.update();
      setInterval(update, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) update();
      });
    });
  });
}

function showToast(text, onTap) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.onclick = () => {
    toastEl.hidden = true;
    if (onTap) onTap();
  };
}

// ---------- iOS "add to home screen" hint (no programmatic install API on iOS) ----------

(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = document.documentElement.classList.contains('standalone');
  const dismissed = localStorage.getItem('piano_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('piano_ios_hint_dismissed', '1');
    });
  }, 1500);
})();
