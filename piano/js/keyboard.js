// Two-octave keyboard layout (C4-C6) and note-name <-> frequency conversion.
// Generated from a repeating per-octave pattern rather than hand-listing 25
// keys, so the white/black key math stays in one obviously-correct place.

const START_OCTAVE = 4;
const NUM_OCTAVES = 2;

const WHITE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Each black key sits after the white key at this index within its octave
// (0=C, 1=D, ... 6=B); there's no black key after E (2) or B (6).
const BLACK_AFTER = [
  { letter: 'C#', afterIndex: 0 },
  { letter: 'D#', afterIndex: 1 },
  { letter: 'F#', afterIndex: 3 },
  { letter: 'G#', afterIndex: 4 },
  { letter: 'A#', afterIndex: 5 },
];

export function buildKeyboard() {
  const white = [];
  const black = [];
  for (let o = 0; o < NUM_OCTAVES; o++) {
    const octave = START_OCTAVE + o;
    WHITE_LETTERS.forEach((letter, i) => {
      white.push({ note: letter + octave, whiteIndex: o * 7 + i });
    });
    BLACK_AFTER.forEach(({ letter, afterIndex }) => {
      black.push({ note: letter + octave, afterWhiteIndex: o * 7 + afterIndex });
    });
  }
  white.push({ note: 'C' + (START_OCTAVE + NUM_OCTAVES), whiteIndex: NUM_OCTAVES * 7 });
  return { white, black, totalWhite: NUM_OCTAVES * 7 + 1 };
}

const NOTE_TO_MIDI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

export function noteFrequency(note) {
  const m = note.match(/^([A-G]#?)(\d)$/);
  const [, letter, octaveStr] = m;
  const midi = NOTE_TO_MIDI[letter] + (Number(octaveStr) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
