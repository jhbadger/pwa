'use strict';

const machine = new SpaceInvaders();
const audio = new SIAudio();

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 256, H = 224;
canvas.width = W; canvas.height = H;

const imgData = ctx.createImageData(W, H);

let running = false;
let lastTime = 0;
let frameId = null;

function loop(ts) {
  frameId = requestAnimationFrame(loop);
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
  // Port 2 buttons (P2)
  '2': [2, 1],          // P2 start? (bit1 sometimes)
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

// ── Start Button ────────────────────────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', start);

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
