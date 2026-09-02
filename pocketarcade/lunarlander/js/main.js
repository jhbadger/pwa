'use strict';

const machine = new LunarLander();
const audio = new LunarLanderAudio();

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

// ── Analog Thrust ────────────────────────────────────────────────────────
// Real hardware reads a spring-loaded foot pedal (0-254). We don't have
// one, so: a touch/mouse slider sets it directly and springs back to 0 on
// release (matching the pedal); a gamepad analog trigger sets it directly
// each frame; keyboard ramps it up while held and decays it when not,
// approximating the pedal's give.
let touchThrustActive = false;
let keyThrustHeld = false;

function updateThrust() {
  if (touchThrustActive) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  const triggerVal = gp && gp.buttons[7] ? gp.buttons[7].value : 0;
  if (triggerVal > 0.02) {
    machine.thrustValue = Math.round(triggerVal * 254);
    return;
  }
  if (keyThrustHeld) machine.thrustValue = Math.min(254, machine.thrustValue + 10);
  else machine.thrustValue = Math.max(0, machine.thrustValue - 14);
}

function loop() {
  frameId = requestAnimationFrame(loop);
  pollGamepadButtons();
  updateThrust();
  if (!running) return;
  machine.runFrame();
  render();
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.onSounds = (thrustVol, explodeOn, tone3kOn, tone6kOn) =>
    audio.update(thrustVol, explodeOn, tone3kOn, tone6kOn);
  machine.onNoiseReset = () => audio.noiseReset();
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
  'c': 'coin1',
  'Enter': 'start1',
  'v': 'select',
  'ArrowLeft': 'left',
  'z': 'left',
  'ArrowRight': 'right',
  'x': 'right',
  ' ': 'abort',
};

function setControl(name, on) {
  switch (name) {
    case 'coin1': machine.setCoin1(on); break;
    case 'start1': machine.setStart1(on); break;
    case 'select': machine.setSelect(on); break;
    case 'left': machine.setLeft(on); break;
    case 'right': machine.setRight(on); break;
    case 'abort': machine.setAbort(on); break;
  }
}

document.addEventListener('keydown', e => {
  audio.resume();
  if (e.key === 'ArrowUp' || e.key === 'w') { keyThrustHeld = true; e.preventDefault(); return; }
  const m = keyMap[e.key];
  if (m) { setControl(m, true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowUp' || e.key === 'w') { keyThrustHeld = false; return; }
  const m = keyMap[e.key];
  if (m) setControl(m, false);
});

// ── Touch Controls ──────────────────────────────────────────────────────────

function setupButton(id, name) {
  const el = document.getElementById(id);
  if (!el) return;
  const down = e => { e.preventDefault(); audio.resume(); setControl(name, true); };
  const up = e => { e.preventDefault(); setControl(name, false); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

setupButton('btn-coin', 'coin1');
setupButton('btn-start', 'start1');
setupButton('btn-select', 'select');
setupButton('btn-left', 'left');
setupButton('btn-right', 'right');
setupButton('btn-abort', 'abort');

// Thrust slider: drag anywhere in the track to set thrust proportionally to
// horizontal position; release springs back to zero, like the real pedal.
function setupThrustSlider() {
  const track = document.getElementById('thrust-track');
  const fill = document.getElementById('thrust-fill');
  if (!track) return;
  let activeId = null;

  function apply(clientX) {
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    machine.thrustValue = Math.round(frac * 254);
    fill.style.width = (frac * 100) + '%';
  }

  track.addEventListener('pointerdown', e => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    touchThrustActive = true;
    track.setPointerCapture(activeId);
    audio.resume();
    apply(e.clientX);
  });
  track.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId) return;
    apply(e.clientX);
  });
  function release(e) {
    if (e.pointerId !== activeId) return;
    activeId = null;
    touchThrustActive = false;
    machine.thrustValue = 0;
    fill.style.width = '0%';
  }
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
}
setupThrustSlider();

// ── Gamepad Input ────────────────────────────────────────────────────────────
// Thrust trigger is handled continuously in updateThrust(); this just polls
// the digital buttons (rotate/abort/coin/start/select).

const padState = { left: false, right: false, abort: false, start: false, coin: false, select: false };

function pollGamepadButtons() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const dpadLeft = !!(gp.buttons[14] && gp.buttons[14].pressed);
  const dpadRight = !!(gp.buttons[15] && gp.buttons[15].pressed);
  const axisX = gp.axes[0] || 0;
  const left = dpadLeft || axisX < -0.5;
  const right = dpadRight || axisX > 0.5;
  const abort = !!(gp.buttons[1] && gp.buttons[1].pressed);
  const coin = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const startBtn = !!(gp.buttons[9] && gp.buttons[9].pressed);
  const select = !!(gp.buttons[0] && gp.buttons[0].pressed);

  if (left !== padState.left) { machine.setLeft(left); padState.left = left; }
  if (right !== padState.right) { machine.setRight(right); padState.right = right; }
  if (abort !== padState.abort) { machine.setAbort(abort); padState.abort = abort; }
  if (coin !== padState.coin) { machine.setCoin1(coin); padState.coin = coin; }
  if (startBtn !== padState.start) { machine.setStart1(startBtn); padState.start = startBtn; }
  if (select !== padState.select) { machine.setSelect(select); padState.select = select; if (select) audio.resume(); }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────────

const ROTATE_STATES = ['off', 'on', 'flip'];

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem('pa-rotate-state-lunarlander', state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem('pa-rotate-state-lunarlander') || 'off';
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
