'use strict';

const machine = new Galaxian();
const audio = new GalaxianAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 224, H = 256;
canvas.width = W; canvas.height = H;

const imgData = ctx.createImageData(W, H);

let running = false;
let frameId = null;

function loop(ts) {
  frameId = requestAnimationFrame(loop);
  pollGamepad();
  if (!running) return;
  machine.runFrame();
  machine.render(imgData);
  ctx.putImageData(imgData, 0, 0);
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.onSound = (ch, on) => audio.trigger(ch, on);
  machine.onPitchChange = (val) => audio.setPitch(val);
  machine.loadRoms();
  machine.reset();
  running = true;
  frameId = requestAnimationFrame(loop);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('overlay').style.display = 'flex';
}

// ── Keyboard Input ──────────────────────────────────────────────────────────
// IN0: bit0=coin1 bit2=left bit3=right bit4=fire. IN1: bit0=start1 bit1=start2.

const keyMap = {
  'c': [0, 0],          // coin
  'Enter': [1, 0],      // P1 start
  '2': [1, 1],          // P2 start (credit only — no P2 physical controls, same as the other games)
  ' ': [0, 4],          // fire
  'ArrowLeft': [0, 2],  // left
  'ArrowRight': [0, 3], // right
  'z': [0, 2],          // left alt
  'x': [0, 3],          // right alt
};

document.addEventListener('keydown', e => {
  audio.resume();
  const m = keyMap[e.key];
  if (m) { machine[m[0] === 0 ? 'setIn0' : 'setIn1'](m[1], true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const m = keyMap[e.key];
  if (m) { machine[m[0] === 0 ? 'setIn0' : 'setIn1'](m[1], false); }
});

// ── Touch Controls ──────────────────────────────────────────────────────────

function setupButton(id, port, bit) {
  const el = document.getElementById(id);
  if (!el) return;
  const setter = port === 0 ? 'setIn0' : 'setIn1';
  const down = e => { e.preventDefault(); audio.resume(); machine[setter](bit, true); };
  const up   = e => { e.preventDefault(); machine[setter](bit, false); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

setupButton('btn-coin',  0, 0);
setupButton('btn-start', 1, 0);

// Move/fire happen on the screen itself: drag past a deadzone to steer
// (direction follows which side of the starting point the finger is on, so
// you can reverse without lifting); a touch that never leaves the deadzone
// fires instead, for as long as it's held.
function setupGesture(el, setLeft, setRight, setFire) {
  const DEADZONE = 12;
  let activeId = null, anchorX = 0, dragging = false;

  el.addEventListener('pointerdown', e => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    anchorX = e.clientX;
    dragging = false;
    el.setPointerCapture(activeId);
    audio.resume();
    setFire(true);
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - anchorX;
    if (!dragging) {
      if (Math.abs(dx) < DEADZONE) return;
      dragging = true;
      setFire(false);
    }
    setLeft(dx < 0);
    setRight(dx > 0);
  });

  function release(e) {
    if (e.pointerId !== activeId) return;
    activeId = null;
    setLeft(false);
    setRight(false);
    setFire(false);
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

setupGesture(
  document.getElementById('screen-wrap'),
  v => machine.setIn0(2, v),
  v => machine.setIn0(3, v),
  v => machine.setIn0(4, v)
);

// ── Gamepad Input ────────────────────────────────────────────────────────────

// Standard gamepad mapping: D-pad/left stick to move, button 0 (A/X) to fire,
// start button to insert coin and begin the game.
const padState = { left: false, right: false, fire: false, start: false, coin: false };
const AXIS_THRESHOLD = 0.5;

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const dpadLeft  = !!(gp.buttons[14] && gp.buttons[14].pressed);
  const dpadRight = !!(gp.buttons[15] && gp.buttons[15].pressed);
  const axisX = gp.axes[0] || 0;
  const left  = dpadLeft  || axisX < -AXIS_THRESHOLD;
  const right = dpadRight || axisX > AXIS_THRESHOLD;
  const fire  = !!(gp.buttons[0] && gp.buttons[0].pressed);
  const coin    = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const startBtn = !!(gp.buttons[9] && gp.buttons[9].pressed);

  if (left !== padState.left)   { machine.setIn0(2, left);  padState.left = left; }
  if (right !== padState.right) { machine.setIn0(3, right); padState.right = right; }
  if (fire !== padState.fire)   { machine.setIn0(4, fire);  padState.fire = fire; if (fire) audio.resume(); }
  if (coin !== padState.coin)   { machine.setIn0(0, coin);  padState.coin = coin; }
  if (startBtn !== padState.start) {
    machine.setIn1(0, startBtn);
    padState.start = startBtn;
  }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────────
// Cycles: off -> rotated -> rotated (other direction) -> off. Always visible
// in the header, in both orientations, so it's reachable even if a previous
// pick left the display rotated the wrong way.

const ROTATE_STATES = ['off', 'on', 'flip'];
const ROTATE_KEY = 'pa-rotate-state-galaxian'; // distinct from the other apps' keys — same origin, separate localStorage

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem(ROTATE_KEY, state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem(ROTATE_KEY) || 'off';
  const next = ROTATE_STATES[(ROTATE_STATES.indexOf(current) + 1) % ROTATE_STATES.length];
  applyRotateState(next);
});

// ── Start ────────────────────────────────────────────────────────────────
// Skip the insert-coin ritual: the arcade menu already committed the player
// to this game, so boot straight into it instead of gating on a tap.

start();

// Scale canvas to fill available space while keeping aspect ratio
function resize() {
  const scr = document.getElementById('screen-wrap');
  const aw = scr.clientWidth, ah = scr.clientHeight;
  const scale = Math.min(aw / W, ah / H);
  canvas.style.width  = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();
