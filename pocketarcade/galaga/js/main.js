'use strict';

const machine = new Galaga();
const audio = new GalagaAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 224, H = 288; // portrait, matching the cabinet's rotated CRT
canvas.width = W; canvas.height = H;
const imgData = ctx.createImageData(W, H);

const native = new Uint8ClampedArray(288 * 224 * 3);

let running = false;
let frameId = null;

// Cabinet mounts the CRT rotated 90 degrees (ROT90, same convention as
// Pac-Man/Galaxian): native_x = portrait_y, native_y = (native_h - 1) - portrait_x.
function render() {
  machine.render(native);
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
}

function start() {
  document.getElementById('overlay').style.display = 'none';
  audio.init();
  audio.resume();
  machine.loadRoms();
  audio.setup(machine.wsgWave);
  machine.onVoice = (ch, freq, waveform, volume) => audio.voiceUpdate(ch, freq, waveform, volume);
  machine.onSoundEffect = (type, volume) => audio.soundEffect(type, volume);
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
const keyMap = {
  'arrowleft': 'left', 'a': 'left',
  'arrowright': 'right', 'd': 'right',
  ' ': 'fire',
  'c': 'coin1',
  'enter': 'start1',
  '2': 'start2',
};

function setControl(name, on) {
  switch (name) {
    case 'left': machine.setJoyLeft1(on); break;
    case 'right': machine.setJoyRight1(on); break;
    case 'fire': machine.setFire1(on); break;
    case 'coin1': machine.setCoin1(on); break;
    case 'start1': machine.setStart1(on); break;
    case 'start2': machine.setStart2(on); break;
  }
}

document.addEventListener('keydown', e => {
  audio.resume();
  const m = keyMap[e.key.toLowerCase()];
  if (m) { setControl(m, true); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const m = keyMap[e.key.toLowerCase()];
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
setupButton('btn-left', 'left');
setupButton('btn-right', 'right');
setupButton('btn-fire', 'fire');

// Swipe-to-move: drag left/right anywhere over the screen to steer,
// re-evaluating continuously off the running delta (same convention as
// Pac-Man's swipe, restricted to the horizontal axis this ship actually
// has).
function setupSwipe(el) {
  const DEADZONE = 3;
  let activeId = null, anchorX = 0, currentDir = null;

  function setDir(dir) {
    if (dir === currentDir) return;
    if (currentDir) setControl(currentDir, false);
    currentDir = dir;
    if (dir) setControl(dir, true);
  }

  el.addEventListener('pointerdown', e => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    anchorX = e.clientX;
    el.setPointerCapture(activeId);
    audio.resume();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - anchorX;
    if (Math.abs(dx) < DEADZONE) return;
    anchorX = e.clientX;
    setDir(dx > 0 ? 'right' : 'left');
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

// ── Gamepad Input ────────────────────────────────────────────────────────

const padState = { left: false, right: false, fire: false, start: false, coin: false };
const AXIS_THRESHOLD = 0.5;

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p) { gp = p; break; } }
  if (!gp) return;

  const axisX = gp.axes[0] || 0;
  const left = !!(gp.buttons[14] && gp.buttons[14].pressed) || axisX < -AXIS_THRESHOLD;
  const right = !!(gp.buttons[15] && gp.buttons[15].pressed) || axisX > AXIS_THRESHOLD;
  const fire = !!(gp.buttons[0] && gp.buttons[0].pressed) || !!(gp.buttons[7] && gp.buttons[7].pressed);
  const coin = !!(gp.buttons[8] && gp.buttons[8].pressed);
  const startBtn = !!(gp.buttons[9] && gp.buttons[9].pressed);

  if (left !== padState.left) { machine.setJoyLeft1(left); padState.left = left; }
  if (right !== padState.right) { machine.setJoyRight1(right); padState.right = right; }
  if (fire !== padState.fire) { machine.setFire1(fire); padState.fire = fire; if (fire) audio.resume(); }
  if (coin !== padState.coin) { machine.setCoin1(coin); padState.coin = coin; }
  if (startBtn !== padState.start) { machine.setStart1(startBtn); padState.start = startBtn; }
}

// ── Landscape Rotate Button ─────────────────────────────────────────────

const ROTATE_STATES = ['off', 'on', 'flip'];

function applyRotateState(state) {
  const root = document.documentElement;
  root.classList.toggle('landscape-mode', state !== 'off');
  root.classList.toggle('landscape-flip', state === 'flip');
  localStorage.setItem('pa-rotate-state-galaga', state);
}

document.getElementById('btn-rotate').addEventListener('click', () => {
  const current = localStorage.getItem('pa-rotate-state-galaga') || 'off';
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
