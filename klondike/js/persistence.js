// Saves the in-progress game to localStorage so closing the tab or switching away
// doesn't lose it. Wrapped in try/catch since localStorage can throw (private
// browsing, quota exceeded, disabled storage) — persistence is a nicety, not
// something that should ever break the game if it's unavailable.
const KEY = 'klondike_savegame';

export function saveGame(snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // ignore — nothing to resume next time, but the current session is unaffected
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.game || !Array.isArray(parsed.game.tableau) || parsed.game.tableau.length !== 7) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
