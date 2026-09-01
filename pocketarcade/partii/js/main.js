'use strict';

const machine = new SpaceInvadersPartII();
const audio = new SIAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 224, H = 256;
canvas.width = W; canvas.height = H;

const imgData = ctx.createImageData(W, H);

let running = false;
let lastTime = 0;
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

const keyMap = {
  // Port 1 buttons
  'c': [1, 0],          // coin
  'Enter': [1, 2],      // P1 start
  ' ': [1, 4],          // P1 fire
  'ArrowLeft': [1, 5],  // P1 left
  'ArrowRight': [1, 6], // P1 right
  'z': [1, 5],          // P1 left alt
  'x': [1, 6],          // P1 right alt
  // Port 1/2 buttons (P2) — Part II's IN1 bit1 is the real P2 start switch,
  // and IN2 bits 4-6 are the real P2 controls.
  '2': [1, 1],          // P2 start
  'a': [2, 5],          // P2 left
  'd': [2, 6],          // P2 right
  'Shift': [2, 4],      // P2 fire
};

document.addEventListener('keydown', e => {
  audio.resume();
  const m = keyMap[e.key];
  if (m) { machine[m[0] === 1 ? 'setPort1' : 'setPort2'](m[1], true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const m = keyMap[e.key];
  if (m) { machine[m[0] === 1 ? 'setPort1' : 'setPort2'](m[1], false); }
});

// ── Touch Controls ──────────────────────────────────────────────────────────

function setupButton(id, port, bit) {
  const el = document.getElementById(id);
  if (!el) return;
  const setter = port === 1 ? 'setPort1' : 'setPort2';
  const down = e => { e.preventDefault(); audio.resume(); machine[setter](bit, true); };
  const up   = e => { e.preventDefault(); machine[setter](bit, false); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

setupButton('btn-left',  1, 5);
setupButton('btn-right', 1, 6);
setupButton('btn-fire',  1, 4);
setupButton('btn-coin',  1, 0);
setupButton('btn-start', 1, 2);

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

  if (left !== padState.left)   { machine.setPort1(5, left);  padState.left = left; }
  if (right !== padState.right) { machine.setPort1(6, right); padState.right = right; }
  if (fire !== padState.fire)   { machine.setPort1(4, fire);  padState.fire = fire; if (fire) audio.resume(); }
  if (coin !== padState.coin)   { machine.setPort1(0, coin);  padState.coin = coin; }
  if (startBtn !== padState.start) {
    machine.setPort1(2, startBtn);
    padState.start = startBtn;
  }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────────
// Cycles: off -> rotated -> rotated (other direction) -> off. Always visible
// in the header, in both orientations, so it's reachable even if a previous
// pick left the display rotated the wrong way.

const ROTATE_STATES = ['off', 'on', 'flip'];
const ROTATE_KEY = 'pa-rotate-state-partii'; // distinct from the main app's key — same origin, separate localStorage

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
