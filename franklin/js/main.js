'use strict';

const machine = new Machine();
machine.loadDefaultBootDisk();
machine.powerOn();

const canvas = document.getElementById('screen');
const video = new Video(canvas, machine);

function frame() {
  machine.runFrame();
  video.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Keyboard input ──────────────────────────────────────────────────────
function asciiFromEvent(e) {
  if (e.key.length === 1) {
    let code = e.key.charCodeAt(0);
    if (e.ctrlKey) {
      const upper = e.key.toUpperCase();
      if (upper >= 'A' && upper <= '_') return upper.charCodeAt(0) & 0x1f;
    }
    return code;
  }
  switch (e.key) {
    case 'Enter': return 0x0d;
    case 'Escape': return 0x1b;
    case 'Backspace': case 'ArrowLeft': return 0x08;
    case 'ArrowRight': return 0x15;
    case 'ArrowUp': return 0x0b;
    case 'ArrowDown': return 0x0a;
    case 'Tab': return 0x09;
    default: return null;
  }
}

const swallowedKeys = new Set(['Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

window.addEventListener('keydown', (e) => {
  if (swallowedKeys.has(e.key)) e.preventDefault();
  const code = asciiFromEvent(e);
  if (code != null) machine.keyDown(code);
});
window.addEventListener('keyup', () => machine.keyUp());

// A hidden input brings up the on-screen keyboard on touch devices; its own
// value is discarded, keystrokes are read via the same keydown path above.
const touchInput = document.getElementById('touch-input');
canvas.addEventListener('click', () => touchInput.focus());
touchInput.addEventListener('input', () => { touchInput.value = ''; });

document.getElementById('btn-reset').addEventListener('click', () => machine.resetButton());
document.getElementById('btn-power').addEventListener('click', () => {
  machine.loadDefaultBootDisk();
  machine.powerOn();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
}
