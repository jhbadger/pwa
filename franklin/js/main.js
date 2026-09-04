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

// A hidden input brings up the on-screen keyboard on touch devices. Mobile
// software keyboards are unreliable about firing real `keydown` events with
// usable `.key` values (many phone keyboards -- Gboard, SwiftKey, the stock
// iOS keyboard -- only ever fire `input`), so typed characters are read from
// the `input` event's `inputType`/`data` instead. The field is kept non-empty
// with a sentinel character so a backspace has something to act on, and is
// reset after every event so state never drifts.
const touchInput = document.getElementById('touch-input');
const TOUCH_INPUT_SENTINEL = ' ';

function resetTouchInput() {
  touchInput.value = TOUCH_INPUT_SENTINEL;
  touchInput.setSelectionRange(TOUCH_INPUT_SENTINEL.length, TOUCH_INPUT_SENTINEL.length);
}

resetTouchInput();
touchInput.addEventListener('focus', resetTouchInput);
canvas.addEventListener('click', () => {
  resetTouchInput();
  touchInput.focus();
});

function sendChar(code) {
  machine.keyDown(code);
  machine.keyUp();
}

touchInput.addEventListener('input', (e) => {
  switch (e.inputType) {
    case 'insertLineBreak':
      sendChar(0x0d);
      break;
    case 'deleteContentBackward':
    case 'deleteContentForward':
      sendChar(0x08);
      break;
    case 'insertText':
    case 'insertCompositionText':
    case 'insertReplacementText': {
      // e.data holds the inserted text on browsers that support it; older
      // WebViews leave it null, so fall back to whatever landed after the
      // sentinel in the field's own value.
      const text = e.data != null ? e.data : touchInput.value.slice(TOUCH_INPUT_SENTINEL.length);
      for (const ch of text) sendChar(ch.charCodeAt(0));
      break;
    }
    default:
      break;
  }
  resetTouchInput();
});

document.getElementById('btn-reset').addEventListener('click', () => machine.resetButton());
document.getElementById('btn-power').addEventListener('click', () => {
  machine.loadDefaultBootDisk();
  machine.powerOn();
});

// ── Loading a user-supplied disk image ──────────────────────────────────
// A standard 5.25" Apple II disk image (DOS 3.3 or ProDOS order -- this
// emulator's nibblizer assumes DOS order, which covers the overwhelming
// majority of .dsk/.do files in the wild) is exactly 35 tracks x 16
// sectors x 256 bytes.
const STANDARD_DISK_SIZE = 35 * 16 * 256;
const GZIP_MAGIC = [0x1f, 0x8b];

const diskStatus = document.getElementById('disk-status');
let diskStatusTimer = null;
function showDiskStatus(message, isError) {
  diskStatus.textContent = message;
  diskStatus.classList.toggle('error', !!isError);
  clearTimeout(diskStatusTimer);
  diskStatusTimer = setTimeout(() => { diskStatus.textContent = ''; }, 5000);
}

async function readDiskFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('this browser can’t decompress .gz files');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

const diskFileInput = document.getElementById('disk-file-input');
document.getElementById('btn-load-disk').addEventListener('click', () => diskFileInput.click());
diskFileInput.addEventListener('change', async () => {
  const file = diskFileInput.files[0];
  diskFileInput.value = '';
  if (!file) return;
  try {
    const bytes = await readDiskFile(file);
    if (bytes.length !== STANDARD_DISK_SIZE) {
      showDiskStatus(
        `${file.name}: not a standard 140K disk image (got ${bytes.length} bytes, expected ${STANDARD_DISK_SIZE})`,
        true
      );
      return;
    }
    machine.loadDiskImage(bytes);
    machine.powerOn();
    showDiskStatus(`Booting ${file.name}…`);
  } catch (err) {
    showDiskStatus(`${file.name}: ${err.message}`, true);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
}
