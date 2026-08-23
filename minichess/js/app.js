import {
  createInitialBoard, generateLegalMoves, applyMove, gameStatus, cloneBoard,
  other, WHITE, BLACK,
} from './chess.js';
import { chooseComputerMove } from './ai.js';

// Unicode has two chess-symbol sets: a hollow-outline "white" set (U+2654-2659)
// and a solid-silhouette "black" set (U+265A-265F). The hollow set renders as
// thin line art with barely any fill, so it's nearly invisible against a light
// square no matter what CSS is applied to it. Use the solid set for both colors
// and tell them apart with fill/stroke color instead (see .piece.white/.black).
const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const trayWhiteEl = document.getElementById('trayWhite');
const trayBlackEl = document.getElementById('trayBlack');
const toastEl = document.getElementById('toast');
const btnNew = document.getElementById('btnNew');
const btnUndo = document.getElementById('btnUndo');
const btnSide = document.getElementById('btnSide');
const diffBtns = Array.from(document.querySelectorAll('.diffbtn'));

const state = {
  board: createInitialBoard(),
  turn: WHITE,
  humanColor: WHITE,
  depth: 3,
  selected: null,
  legalTargets: [],
  lastMove: null,
  capturedByWhite: [], // black piece types captured by White
  capturedByBlack: [], // white piece types captured by Black
  history: [],
  gameOver: false,
  thinking: false,
};

// ---------- display <-> board coordinate mapping (flips for a black-side human) ----------

function flipped() {
  return state.humanColor === BLACK;
}

function displayToBoard(dr, dc) {
  return flipped() ? { r: dr, c: 4 - dc } : { r: 4 - dr, c: dc };
}

function boardToDisplay(r, c) {
  return flipped() ? { dr: r, dc: 4 - c } : { dr: 4 - r, dc: c };
}

// ---------- board DOM (built once) ----------

const squareEls = []; // indexed [dr][dc]
for (let dr = 0; dr < 5; dr++) {
  const row = [];
  for (let dc = 0; dc < 5; dc++) {
    const sq = document.createElement('div');
    sq.className = 'sq';
    sq.dataset.dr = String(dr);
    sq.dataset.dc = String(dc);
    boardEl.appendChild(sq);
    row.push(sq);
  }
  squareEls.push(row);
}

// ---------- rendering ----------

function render() {
  const status = gameStatus(state.board, state.turn);
  for (let dr = 0; dr < 5; dr++) {
    for (let dc = 0; dc < 5; dc++) {
      const { r, c } = displayToBoard(dr, dc);
      const sq = squareEls[dr][dc];
      sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'dark' : 'light');
      sq.innerHTML = '';

      const piece = state.board[r][c];
      const isSelected = state.selected && state.selected.r === r && state.selected.c === c;
      const isLastFrom = state.lastMove && state.lastMove.fr === r && state.lastMove.fc === c;
      const isLastTo = state.lastMove && state.lastMove.tr === r && state.lastMove.tc === c;
      if (isSelected) sq.classList.add('selected');
      if (isLastFrom) sq.classList.add('last-from');
      if (isLastTo) sq.classList.add('last-to');

      if (piece && piece.type === 'K' && piece.color === state.turn
          && (status === 'check' || status === 'checkmate')) {
        sq.classList.add('in-check');
      }

      if (piece) {
        const p = document.createElement('span');
        p.className = 'piece ' + (piece.color === WHITE ? 'white' : 'black');
        p.textContent = GLYPH[piece.type];
        p.dataset.r = String(r);
        p.dataset.c = String(c);
        sq.appendChild(p);
      }

      const target = state.legalTargets.find((m) => m.tr === r && m.tc === c);
      if (target) {
        const marker = document.createElement('div');
        marker.className = target.capture ? 'ring' : 'dot';
        sq.appendChild(marker);
      }
    }
  }

  renderTrays();
  renderStatus(status);
  btnUndo.disabled = state.history.length === 0 || state.thinking;
  diffBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.depth) === state.depth));
}

function renderTrays() {
  // capturedByWhite holds the (black) piece types White has captured, and vice versa.
  trayWhiteEl.innerHTML = state.capturedByWhite
    .map((t) => `<span class="piece black">${GLYPH[t]}</span>`).join('');
  trayBlackEl.innerHTML = state.capturedByBlack
    .map((t) => `<span class="piece white">${GLYPH[t]}</span>`).join('');
}

function renderStatus(status) {
  statusEl.classList.remove('check', 'over');
  if (state.thinking) {
    statusEl.textContent = 'Computer is thinking…';
    return;
  }
  const whoseTurn = state.turn === state.humanColor ? 'Your' : "Computer's";
  if (status === 'checkmate') {
    const winnerIsHuman = other(state.turn) === state.humanColor;
    statusEl.textContent = (winnerIsHuman ? 'Checkmate — you win!' : 'Checkmate — computer wins.');
    statusEl.classList.add('over');
  } else if (status === 'stalemate') {
    statusEl.textContent = 'Stalemate — draw.';
    statusEl.classList.add('over');
  } else if (status === 'check') {
    statusEl.textContent = `${whoseTurn} move — Check!`;
    statusEl.classList.add('check');
  } else {
    statusEl.textContent = `${whoseTurn} move`;
  }
}

// ---------- game actions ----------

function pushHistory() {
  state.history.push({
    board: cloneBoard(state.board),
    turn: state.turn,
    capturedByWhite: [...state.capturedByWhite],
    capturedByBlack: [...state.capturedByBlack],
    lastMove: state.lastMove,
  });
}

function doMove(move) {
  pushHistory();
  const captured = state.board[move.tr][move.tc];
  if (captured) {
    if (captured.color === BLACK) state.capturedByWhite.push(captured.type);
    else state.capturedByBlack.push(captured.type);
  }
  state.board = applyMove(state.board, move);
  state.lastMove = move;
  state.turn = other(state.turn);
  state.selected = null;
  state.legalTargets = [];
}

function afterMove() {
  render();
  const status = gameStatus(state.board, state.turn);
  state.gameOver = status === 'checkmate' || status === 'stalemate';
  if (state.gameOver) return;
  if (state.turn !== state.humanColor) {
    computerTurn();
  }
}

function computerTurn() {
  state.thinking = true;
  render();
  const color = state.turn;
  const depth = state.depth;
  // Yield to the browser first so "Computer is thinking…" actually paints before
  // the (synchronous, if brief) search runs.
  requestAnimationFrame(() => setTimeout(() => {
    const move = chooseComputerMove(state.board, color, depth);
    state.thinking = false;
    if (move) doMove(move);
    afterMove();
  }, 20));
}

function selectSquare(r, c) {
  state.selected = { r, c };
  state.legalTargets = generateLegalMoves(state.board, state.humanColor)
    .filter((m) => m.fr === r && m.fc === c);
  render();
}

function deselect() {
  state.selected = null;
  state.legalTargets = [];
  render();
}

function tryMoveTo(r, c) {
  const move = state.legalTargets.find((m) => m.tr === r && m.tc === c);
  if (!move) return false;
  doMove(move);
  afterMove();
  return true;
}

function newGame(humanColor) {
  state.board = createInitialBoard();
  state.turn = WHITE;
  state.humanColor = humanColor !== undefined ? humanColor : state.humanColor;
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  state.history = [];
  state.gameOver = false;
  state.thinking = false;
  render();
  if (state.turn !== state.humanColor) computerTurn();
}

function undo() {
  if (state.history.length === 0 || state.thinking) return;
  let snap = state.history.pop();
  if (snap.turn !== state.humanColor && state.history.length > 0) {
    snap = state.history.pop();
  }
  state.board = snap.board;
  state.turn = snap.turn;
  state.capturedByWhite = snap.capturedByWhite;
  state.capturedByBlack = snap.capturedByBlack;
  state.lastMove = snap.lastMove;
  state.selected = null;
  state.legalTargets = [];
  state.gameOver = false;
  render();
}

// ---------- pointer / touch input ----------

let drag = null; // { r, c, startX, startY, moved, pieceEl, cloneEl, cellSize }

function boardCoordsFromEvent(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sq = el && el.closest('.sq');
  if (!sq) return null;
  return displayToBoard(Number(sq.dataset.dr), Number(sq.dataset.dc));
}

boardEl.addEventListener('pointerdown', (e) => {
  if (state.thinking || state.gameOver || state.turn !== state.humanColor) return;
  const sqEl = e.target.closest('.sq');
  if (!sqEl) return;
  const { r, c } = displayToBoard(Number(sqEl.dataset.dr), Number(sqEl.dataset.dc));

  if (state.selected) {
    if (tryMoveTo(r, c)) return;
    const piece = state.board[r][c];
    if (piece && piece.color === state.humanColor) {
      selectSquare(r, c);
    } else {
      deselect();
      return;
    }
  } else {
    const piece = state.board[r][c];
    if (!piece || piece.color !== state.humanColor) return;
    selectSquare(r, c);
  }

  // Look up the piece element fresh: selectSquare()/deselect() above may have just
  // re-rendered the board, which detaches whatever node originally received this event.
  const { dr, dc } = boardToDisplay(r, c);
  const pieceEl = squareEls[dr][dc].querySelector('.piece');
  const rect = boardEl.getBoundingClientRect();
  drag = {
    r, c,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pieceEl,
    cloneEl: null,
    cellSize: rect.width / 5,
  };
  if (pieceEl) {
    try { pieceEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) > 6) {
    drag.moved = true;
    if (drag.pieceEl) {
      drag.pieceEl.style.opacity = '0.2';
      const clone = drag.pieceEl.cloneNode(true);
      clone.classList.add('dragging');
      clone.style.fontSize = `${drag.cellSize * 0.75}px`;
      clone.style.width = `${drag.cellSize}px`;
      clone.style.height = `${drag.cellSize}px`;
      clone.style.display = 'flex';
      clone.style.alignItems = 'center';
      clone.style.justifyContent = 'center';
      document.body.appendChild(clone);
      drag.cloneEl = clone;
    }
  }
  if (drag.moved && drag.cloneEl) {
    drag.cloneEl.style.left = `${e.clientX - drag.cellSize / 2}px`;
    drag.cloneEl.style.top = `${e.clientY - drag.cellSize / 2}px`;
  }
});

function endDrag(e) {
  if (!drag) return;
  const wasMoved = drag.moved;
  if (drag.pieceEl) drag.pieceEl.style.opacity = '';
  if (drag.cloneEl) drag.cloneEl.remove();
  if (wasMoved) {
    const target = boardCoordsFromEvent(e);
    if (target && tryMoveTo(target.r, target.c)) {
      drag = null;
      return;
    }
    // Dropped somewhere invalid — leave selection cleared for a fresh tap.
    if (!(target && state.selected && target.r === state.selected.r && target.c === state.selected.c)) {
      deselect();
    }
  }
  drag = null;
}

boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', endDrag);

// Stop iOS's copy/select callout bar from popping up on repeated taps, without
// blocking real clicks on the toolbar buttons.
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('button, #toast')) return;
  e.preventDefault();
}, { passive: false });

// ---------- toolbar ----------

btnNew.addEventListener('click', () => newGame());
btnUndo.addEventListener('click', undo);
btnSide.addEventListener('click', () => newGame(other(state.humanColor)));
diffBtns.forEach((b) => {
  b.addEventListener('click', () => {
    state.depth = Number(b.dataset.depth);
    render();
  });
});

// ---------- service worker: install-once cache, background updates ----------

if ('serviceWorker' in navigator) {
  let priorControllerURL = navigator.serviceWorker.controller
    && navigator.serviceWorker.controller.scriptURL;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const newURL = navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.scriptURL;
    if (priorControllerURL && newURL === priorControllerURL) {
      showToast('Updated — tap to refresh', () => window.location.reload());
    }
    priorControllerURL = newURL;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((reg) => {
      const update = () => reg.update();
      setInterval(update, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) update();
      });
    });
  });
}

function showToast(text, onTap) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.onclick = () => {
    toastEl.hidden = true;
    if (onTap) onTap();
  };
}

// ---------- iOS "add to home screen" hint (no programmatic install API on iOS) ----------

(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = document.documentElement.classList.contains('standalone');
  const dismissed = localStorage.getItem('mc_ios_hint_dismissed') === '1';
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    showToast('Tap Share, then "Add to Home Screen"', () => {
      localStorage.setItem('mc_ios_hint_dismissed', '1');
    });
  }, 1500);
})();

// ---------- boot ----------

render();
