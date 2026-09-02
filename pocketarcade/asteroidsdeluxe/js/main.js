'use strict';

const machine = new AsteroidsDeluxe();
const audio = new AsteroidsDeluxeAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 1024, H = 1024; // DVG's native 12-bit coordinate space (0-1023)
canvas.width = W; canvas.height = H;

let running = false;
let frameId = null;

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const seg = machine.dvg.segments;
  if (!seg.length) return;
  ctx.strokeStyle = '#eafcff';
  ctx.shadowColor = '#9be8ff';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < seg.length; i += 5) {
    ctx.moveTo(seg[i], H - 1 - seg[i + 1]);
    ctx.lineTo(seg[i + 2], H - 1 - seg[i + 3]);
  }
  ctx.stroke();
}

function loop() {
  frameId = requestAnimationFrame(loop);
  pollGamepad();
  if (!running) return;
  machine.runFrame();
  render();
  saveEaromIfChanged();
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.onSoundGate = (bit, on) => audio.soundGate(bit, on);
  machine.onExplode = (vol, pitch) => audio.explode(vol, pitch);
  machine.onPokeyWrite = (reg, val) => audio.pokeyWrite(reg, val);
  machine.loadRoms();
  loadEarom();
  machine.reset();
  running = true;
  frameId = requestAnimationFrame(loop);
}

// ── High Score Persistence ──────────────────────────────────────────────────
// Unlike original Asteroids, Deluxe's board has a real EAROM chip (64 bytes
// of non-volatile storage) for high scores and settings — we persist that
// whole array directly rather than guessing a RAM address.
const EAROM_KEY = 'pa-earom-asteroidsdeluxe';
let lastEaromKey = null;

function loadEarom() {
  let saved;
  try { saved = localStorage.getItem(EAROM_KEY); } catch { saved = null; }
  if (saved) {
    const bytes = saved.split(',').map(Number);
    if (bytes.length === machine.earom.length && bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
      machine.earom.set(bytes);
    }
  }
  lastEaromKey = machine.earom.join(',');
}

function saveEaromIfChanged() {
  const key = machine.earom.join(',');
  if (key === lastEaromKey) return;
  lastEaromKey = key;
  try { localStorage.setItem(EAROM_KEY, key); } catch {}
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('overlay').style.display = 'flex';
}

// ── Keyboard Input ──────────────────────────────────────────────────────────
// IN1: bit7 left, bit6 right, bit5 thrust, bit3 start1, bit0 coin1
// IN0: bit4 fire, bit3 shield
const keyMap = {
  'c': ['in1', 0],           // coin
  'Enter': ['in1', 3],       // 1P start
  'ArrowUp': ['in1', 5],     // thrust
  'w': ['in1', 5],
  'ArrowLeft': ['in1', 7],   // rotate left
  'z': ['in1', 7],
  'ArrowRight': ['in1', 6],  // rotate right
  'x': ['in1', 6],
  ' ': ['in0', 4],           // fire
  'ArrowDown': ['in0', 3],   // shield
  's': ['in0', 3],
};

function setBit(port, bit, on) {
  if (port === 'in0') machine.setIn0(bit, on); else machine.setIn1(bit, on);
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

setupButton('btn-coin', 'in1', 0);
setupButton('btn-start', 'in1', 3);
setupButton('btn-left', 'in1', 7);
setupButton('btn-right', 'in1', 6);
setupButton('btn-thrust', 'in1', 5);
setupButton('btn-fire', 'in0', 4);
setupButton('btn-shield', 'in0', 3);

// ── Gamepad Input ────────────────────────────────────────────────────────────

const padState = { left: false, right: false, thrust: false, fire: false, shield: false, start: false, coin: false };
const AXIS_THRESHOLD = 0.5;

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const dpadLeft = !!(gp.buttons[14] && gp.buttons[14].pressed);
  const dpadRight = !!(gp.buttons[15] && gp.buttons[15].pressed);
  const axisX = gp.axes[0] || 0;
  const left = dpadLeft || axisX < -AXIS_THRESHOLD;
  const right = dpadRight || axisX > AXIS_THRESHOLD;
  const fire = !!(gp.buttons[0] && gp.buttons[0].pressed);
  const thrust = !!(gp.buttons[1] && gp.buttons[1].pressed) || !!(gp.buttons[7] && gp.buttons[7].pressed);
  const shield = !!(gp.buttons[2] && gp.buttons[2].pressed);
  const coin = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const startBtn = !!(gp.buttons[9] && gp.buttons[9].pressed);

  if (left !== padState.left) { machine.setIn1(7, left); padState.left = left; }
  if (right !== padState.right) { machine.setIn1(6, right); padState.right = right; }
  if (thrust !== padState.thrust) { machine.setIn1(5, thrust); padState.thrust = thrust; if (thrust) audio.resume(); }
  if (fire !== padState.fire) { machine.setIn0(4, fire); padState.fire = fire; if (fire) audio.resume(); }
  if (shield !== padState.shield) { machine.setIn0(3, shield); padState.shield = shield; }
  if (coin !== padState.coin) { machine.setIn1(0, coin); padState.coin = coin; }
  if (startBtn !== padState.start) { machine.setIn1(3, startBtn); padState.start = startBtn; }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────────

const ROTATE_STATES = ['off', 'on', 'flip'];

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem('pa-rotate-state-asteroidsdeluxe', state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem('pa-rotate-state-asteroidsdeluxe') || 'off';
  const next = ROTATE_STATES[(ROTATE_STATES.indexOf(current) + 1) % ROTATE_STATES.length];
  applyRotateState(next);
});

// ── Start ────────────────────────────────────────────────────────────────

start();

// Scale canvas to fill available space while keeping aspect ratio
function resize() {
  const scr = document.getElementById('screen-wrap');
  const aw = scr.clientWidth, ah = scr.clientHeight;
  const scale = Math.min(aw / W, ah / H);
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', resize);
resize();
