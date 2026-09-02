'use strict';

const machine = new Battlezone();
const audio = new BattlezoneAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 580, H = 400; // AVG's visible area (set_visarea(0,580,0,400))
canvas.width = W; canvas.height = H;

let running = false;
let frameId = null;

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const seg = machine.avg.segments;
  if (!seg.length) return;
  ctx.strokeStyle = '#8dffb0';
  ctx.shadowColor = '#3dff6e';
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < seg.length; i += 5) {
    ctx.moveTo(seg[i], seg[i + 1]);
    ctx.lineTo(seg[i + 2], seg[i + 3]);
  }
  ctx.stroke();
}

function loop() {
  frameId = requestAnimationFrame(loop);
  pollGamepad();
  if (!running) return;
  machine.runFrame();
  render();
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.onSoundReg = (bits) => audio.update(bits, machine.pokey.channels());
  machine.onStartLed = (on) => document.getElementById('btn-start1').classList.toggle('pressed', on);
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

// ── Keyboard Input ──────────────────────────────────────────────────────
// Dual tank levers: W/S drive the left tread, Up/Down drive the right —
// matching the cabinet's two independent forward/back levers.
const keyMap = {
  'c': 'coin1',
  'Enter': 'start1',
  '2': 'start2',
  ' ': 'fire',
  'w': 'leftUp', 'W': 'leftUp',
  's': 'leftDown', 'S': 'leftDown',
  'ArrowUp': 'rightUp',
  'ArrowDown': 'rightDown',
};

function setControl(name, on) {
  switch (name) {
    case 'coin1': machine.setCoin1(on); break;
    case 'start1': machine.setStart1(on); break;
    case 'start2': machine.setStart2(on); break;
    case 'fire': machine.setFire(on); break;
    case 'leftUp': machine.setLeftUp(on); break;
    case 'leftDown': machine.setLeftDown(on); break;
    case 'rightUp': machine.setRightUp(on); break;
    case 'rightDown': machine.setRightDown(on); break;
  }
}

document.addEventListener('keydown', e => {
  audio.resume();
  const m = keyMap[e.key];
  if (m) { setControl(m, true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const m = keyMap[e.key];
  if (m) setControl(m, false);
});

// ── Touch Controls ──────────────────────────────────────────────────────

function setupButton(id, name) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); audio.resume(); setControl(name, true); el.classList.add('pressed'); };
  const up = e => { e.preventDefault(); setControl(name, false); el.classList.remove('pressed'); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

setupButton('btn-coin', 'coin1');
setupButton('btn-start1', 'start1');
setupButton('btn-start2', 'start2');
setupButton('btn-fire', 'fire');
setupButton('btn-left-up', 'leftUp');
setupButton('btn-left-down', 'leftDown');
setupButton('btn-right-up', 'rightUp');
setupButton('btn-right-down', 'rightDown');

// ── Gamepad Input ────────────────────────────────────────────────────────
// Left stick / d-pad drives the left tread, right stick (or face buttons)
// drives the right tread — approximating dual levers with a single pad.

const padState = {
  leftUp: false, leftDown: false, rightUp: false, rightDown: false,
  fire: false, start1: false, start2: false, coin: false,
};

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const axisLY = gp.axes[1] || 0;
  const axisRY = gp.axes[3] || 0;
  const dpadUp = !!(gp.buttons[12] && gp.buttons[12].pressed);
  const dpadDown = !!(gp.buttons[13] && gp.buttons[13].pressed);

  const leftUp = axisLY < -0.5 || dpadUp;
  const leftDown = axisLY > 0.5 || dpadDown;
  const rightUp = axisRY < -0.5 || !!(gp.buttons[3] && gp.buttons[3].pressed);
  const rightDown = axisRY > 0.5 || !!(gp.buttons[0] && gp.buttons[0].pressed);
  const fire = !!(gp.buttons[7] && gp.buttons[7].pressed) || !!(gp.buttons[5] && gp.buttons[5].pressed);
  const coin = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const start1 = !!(gp.buttons[9] && gp.buttons[9].pressed);
  const start2 = !!(gp.buttons[6] && gp.buttons[6].pressed);

  if (leftUp !== padState.leftUp) { machine.setLeftUp(leftUp); padState.leftUp = leftUp; }
  if (leftDown !== padState.leftDown) { machine.setLeftDown(leftDown); padState.leftDown = leftDown; }
  if (rightUp !== padState.rightUp) { machine.setRightUp(rightUp); padState.rightUp = rightUp; }
  if (rightDown !== padState.rightDown) { machine.setRightDown(rightDown); padState.rightDown = rightDown; }
  if (fire !== padState.fire) { machine.setFire(fire); padState.fire = fire; if (fire) audio.resume(); }
  if (coin !== padState.coin) { machine.setCoin1(coin); padState.coin = coin; }
  if (start1 !== padState.start1) { machine.setStart1(start1); padState.start1 = start1; }
  if (start2 !== padState.start2) { machine.setStart2(start2); padState.start2 = start2; }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────

const ROTATE_STATES = ['off', 'on', 'flip'];

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem('pa-rotate-state-battlezone', state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem('pa-rotate-state-battlezone') || 'off';
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
