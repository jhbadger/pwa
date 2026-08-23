// Quick correctness check for the song data — not shipped to the app, dev-only.
// Catches the easy authoring mistakes: a typo'd note name, or a note outside
// the two-octave keyboard the app actually renders.
import { SONGS } from '../js/songs.js';
import { buildKeyboard, noteFrequency } from '../js/keyboard.js';

const { white, black } = buildKeyboard();
const validNotes = new Set([...white, ...black].map((k) => k.note));

let failures = 0;
for (const song of SONGS) {
  if (song.notes.length === 0) {
    console.log('FAIL', song.id, 'has no notes');
    failures++;
    continue;
  }
  for (const { note, dur } of song.notes) {
    if (!validNotes.has(note)) {
      console.log('FAIL', song.id, 'note', note, 'is outside the C4-C6 keyboard');
      failures++;
    }
    if (!(dur > 0)) {
      console.log('FAIL', song.id, 'note', note, 'has non-positive duration', dur);
      failures++;
    }
  }
  console.log('OK', song.id, `(${song.notes.length} notes)`);
}

// Sanity-check the frequency table against known reference pitches.
const checks = [['A4', 440], ['C4', 261.63], ['C5', 523.25]];
for (const [note, expected] of checks) {
  const got = noteFrequency(note);
  if (Math.abs(got - expected) > 0.05) {
    console.log('FAIL', note, 'expected ~', expected, 'got', got);
    failures++;
  }
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('\nAll songs valid.');
}
