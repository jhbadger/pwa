'use strict';

const machine = new MsPacman();
const audio = new MsPacmanAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 224, H = 288; // portrait, matching the cabinet's rotated CRT
canvas.width = W; canvas.height = H;
const imgData = ctx.createImageData(W, H);

const native = new Uint8ClampedArray(288 * 224 * 3);

let running = false;
let frameId = null;

// Cabinet mounts the CRT rotated 90 degrees (ROT90, same convention as
// Galaxian): native_x = portrait_y, native_y = (native_h - 1) - portrait_x.
function render() {
  machine.drawTilemap(native);
  machine.drawSprites(native);
  const data = imgData.data;
  for (let py = 0; py < H; py++) {
    const nx = py;
    let srcOff = (223 * 288 + nx) * 3;
    let dstOff = (py * W) * 4;
    for (let px = 0; px < W; px++) {
      data[dstOff] = native[srcOff];
      data[dstOff + 1] = native[srcOff + 1];
      data[dstOff + 2] = native[srcOff + 2];
      data[dstOff + 3] = 255;
      srcOff -= 288 * 3;
      dstOff += 4;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function loop() {
  frameId = requestAnimationFrame(loop);
  pollGamepad();
  if (!running) return;
  machine.runFrame();
  render();
  updateHighScore();
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.onVoice = (ch, freq, waveform, volume) => audio.voiceUpdate(ch, freq, waveform, volume);
  machine.onSoundEnable = (en) => audio.soundEnable(en);
  machine.loadRoms();
  machine.reset();
  running = true;
  frameId = requestAnimationFrame(loop);
}

// ── High Score Persistence ──────────────────────────────────────────────────
// Two RAM regions make up the attract-mode high score (a packed value plus
// the on-screen digit tiles), per MAME's community hiscore database — real
// Pac-Man hardware has no non-volatile storage of its own.
//
// This follows MAME's own hiscore.lua fairly closely (it's the reference
// implementation for this exact address data): rather than just waiting for
// reads to go quiet, it waits for each region's first/last byte to match an
// exact expected "just cleared this" signature — 0x00/0x00 for the packed
// score, 0x40/0x40 for the on-screen digit tiles — before trusting the RAM
// enough to overwrite it. Boot runs a RAM self-test that scribbles an
// unrelated counter pattern through this same memory for several hundred
// frames first, so the signature is required to hold for a run of frames,
// not just match once (self-test bytes can pass through 0x00/0x40 in
// passing). Change detection once loaded sums only the packed-score region
// (mirroring hiscore.lua's own checksum) and debounces saves, so a
// transient reuse of the digit-tile bytes for something else doesn't
// trigger a spurious write.
const HISCORE_KEY = 'pa-hiscore-mspacman';
const HISCORE_REGIONS = [
  { addr: 0x4E88, len: 4, cStart: 0x00, cEnd: 0x00 },
  { addr: 0x43ED, len: 6, cStart: 0x40, cEnd: 0x40 },
];
const HISCORE_STABLE_FRAMES = 10;   // consecutive frames the signature must hold
const HISCORE_TIMEOUT_FRAMES = 1800; // ~30s fallback (real settle is ~250 frames)
const HISCORE_SAVE_DEBOUNCE_FRAMES = 300; // ~5s between saves, matching hiscore.lua's grace period

let hiscoreLoaded = false, hiscoreBootFrames = 0, hiscoreMatchStreak = 0;
let hiscoreDefaultChecksum = 0, hiscoreCurrentChecksum = 0, hiscoreLastSaveFrame = -Infinity;
let hiscoreFrameCounter = 0;

function hiscoreSignatureMatches() {
  for (const r of HISCORE_REGIONS) {
    if (machine.read(r.addr) !== r.cStart) return false;
    if (machine.read(r.addr + r.len - 1) !== r.cEnd) return false;
  }
  return true;
}
function readHiscoreBytes() {
  const bytes = [];
  for (const r of HISCORE_REGIONS) for (let i = 0; i < r.len; i++) bytes.push(machine.read(r.addr + i));
  return bytes;
}
// Only the packed-score region — the digit-tile region can be transiently
// reused for unrelated on-screen text, so it's saved but not used to detect
// "did the score actually change".
function hiscoreChecksum() {
  const r = HISCORE_REGIONS[0];
  let sum = 0;
  for (let i = 0; i < r.len; i++) sum += machine.read(r.addr + i);
  return sum;
}

function updateHighScore() {
  hiscoreFrameCounter++;

  if (!hiscoreLoaded) {
    hiscoreBootFrames++;
    hiscoreMatchStreak = hiscoreSignatureMatches() ? hiscoreMatchStreak + 1 : 0;
    const signatureSettled = hiscoreMatchStreak >= HISCORE_STABLE_FRAMES;
    if (!signatureSettled && hiscoreBootFrames < HISCORE_TIMEOUT_FRAMES) return;

    hiscoreLoaded = true;
    // Capture the boot-default checksum BEFORE restoring, matching
    // hiscore.lua's own ordering — this is what lets later code tell "score
    // legitimately reset to its boot default" apart from "no change yet".
    hiscoreDefaultChecksum = hiscoreChecksum();
    if (signatureSettled) {
      let saved;
      try { saved = localStorage.getItem(HISCORE_KEY); } catch { saved = null; }
      if (saved) {
        const savedBytes = saved.split(',').map(Number);
        const totalLen = HISCORE_REGIONS.reduce((n, r) => n + r.len, 0);
        if (savedBytes.length === totalLen && savedBytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
          let k = 0;
          for (const r of HISCORE_REGIONS) for (let i = 0; i < r.len; i++) machine.write(r.addr + i, savedBytes[k++]);
        }
      }
    }
    hiscoreCurrentChecksum = hiscoreChecksum();
    return;
  }

  const checksum = hiscoreChecksum();
  if (checksum === hiscoreCurrentChecksum || checksum === hiscoreDefaultChecksum) return;
  if (hiscoreFrameCounter - hiscoreLastSaveFrame < HISCORE_SAVE_DEBOUNCE_FRAMES) return;
  hiscoreCurrentChecksum = checksum;
  hiscoreLastSaveFrame = hiscoreFrameCounter;
  try { localStorage.setItem(HISCORE_KEY, readHiscoreBytes().join(',')); } catch {}
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('overlay').style.display = 'flex';
}

// ── Keyboard Input ──────────────────────────────────────────────────────────
// IN0: bit0 up, 1 left, 2 right, 3 down, 5 coin1, 7 service1
// IN1: bit5 start1
const keyMap = {
  'ArrowUp': ['in0', 0], 'w': ['in0', 0],
  'ArrowLeft': ['in0', 1], 'a': ['in0', 1],
  'ArrowRight': ['in0', 2], 'd': ['in0', 2],
  'ArrowDown': ['in0', 3], 's': ['in0', 3],
  'c': ['in0', 5],
  'Enter': ['in1', 5],
};

function setBit(port, bit, pressed) {
  if (port === 'in0') machine.setIn0(bit, pressed); else machine.setIn1(bit, pressed);
}

document.addEventListener('keydown', e => {
  audio.resume();
  const m = keyMap[e.key];
  if (m) { setBit(m[0], m[1], true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const m = keyMap[e.key];
  if (m) setBit(m[0], m[1], false);
});

// ── Touch Controls ──────────────────────────────────────────────────────────

function setupButton(id, port, bit) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); audio.resume(); setBit(port, bit, true); };
  const up = e => { e.preventDefault(); setBit(port, bit, false); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

setupButton('btn-coin', 'in0', 5);
setupButton('btn-start', 'in1', 5);

// Swipe-to-move: drag in any direction over the screen to steer; direction
// re-evaluates continuously off the running delta, so reversing course
// mid-drag doesn't require lifting your finger.
function setupSwipe(el) {
  const DEADZONE = 3;
  let activeId = null, anchorX = 0, anchorY = 0, currentDir = null;
  const dirBit = { up: 0, left: 1, right: 2, down: 3 };

  function setDir(dir) {
    if (dir === currentDir) return;
    if (currentDir) machine.setIn0(dirBit[currentDir], false);
    currentDir = dir;
    if (dir) machine.setIn0(dirBit[dir], true);
  }

  el.addEventListener('pointerdown', e => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    anchorX = e.clientX; anchorY = e.clientY;
    el.setPointerCapture(activeId);
    audio.resume();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - anchorX, dy = e.clientY - anchorY;
    if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;
    anchorX = e.clientX; anchorY = e.clientY;
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  function release(e) {
    if (e.pointerId !== activeId) return;
    activeId = null;
    setDir(null);
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}
setupSwipe(document.getElementById('screen-wrap'));

// ── Gamepad Input ────────────────────────────────────────────────────────────

const padState = { up: false, down: false, left: false, right: false, start: false, coin: false };
const AXIS_THRESHOLD = 0.5;

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const axisX = gp.axes[0] || 0, axisY = gp.axes[1] || 0;
  const left = !!(gp.buttons[14] && gp.buttons[14].pressed) || axisX < -AXIS_THRESHOLD;
  const right = !!(gp.buttons[15] && gp.buttons[15].pressed) || axisX > AXIS_THRESHOLD;
  const up = !!(gp.buttons[12] && gp.buttons[12].pressed) || axisY < -AXIS_THRESHOLD;
  const down = !!(gp.buttons[13] && gp.buttons[13].pressed) || axisY > AXIS_THRESHOLD;
  const coin = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const startBtn = !!(gp.buttons[9] && gp.buttons[9].pressed);

  if (up !== padState.up) { machine.setIn0(0, up); padState.up = up; }
  if (left !== padState.left) { machine.setIn0(1, left); padState.left = left; }
  if (right !== padState.right) { machine.setIn0(2, right); padState.right = right; }
  if (down !== padState.down) { machine.setIn0(3, down); padState.down = down; }
  if (coin !== padState.coin) { machine.setIn0(5, coin); padState.coin = coin; if (coin) audio.resume(); }
  if (startBtn !== padState.start) { machine.setIn1(5, startBtn); padState.start = startBtn; }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────────

const ROTATE_STATES = ['off', 'on', 'flip'];

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem('pa-rotate-state-mspacman', state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem('pa-rotate-state-mspacman') || 'off';
  const next = ROTATE_STATES[(ROTATE_STATES.indexOf(current) + 1) % ROTATE_STATES.length];
  applyRotateState(next);
});

// ── Start ────────────────────────────────────────────────────────────────

start();

function resize() {
  const scr = document.getElementById('screen-wrap');
  const aw = scr.clientWidth, ah = scr.clientHeight;
  const scale = Math.min(aw / W, ah / H);
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();
