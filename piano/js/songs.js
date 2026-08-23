// Simple public-domain melodies for Learn mode. Every note falls within the
// keyboard's C4-C6 range (see keyboard.js), and `dur` is a relative note
// length used only to pace Demo playback — Learn mode itself is user-paced,
// waiting for the right key regardless of timing.

export const SONGS = [
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle Little Star',
    notes: parse('C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 ' +
      'G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 ' +
      'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2'),
  },
  {
    id: 'mary',
    title: 'Mary Had a Little Lamb',
    notes: parse('E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 ' +
      'E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:2'),
  },
  {
    id: 'hotcross',
    title: 'Hot Cross Buns',
    notes: parse('E4 D4 C4:2 E4 D4 C4:2 C4 C4 C4 C4 D4 D4 D4 D4 E4 D4 C4:2'),
  },
  {
    id: 'ode',
    title: 'Ode to Joy',
    notes: parse('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2 ' +
      'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2'),
  },
  {
    id: 'jingle',
    title: 'Jingle Bells',
    notes: parse('E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4 D4 E4:2 ' +
      'F4 F4 F4 F4 F4 E4 E4 E4 E4 D4 D4 E4 D4:2 G4:2'),
  },
  {
    id: 'london',
    title: 'London Bridge',
    notes: parse('G4 A4 G4 F4 E4 F4 G4:2 D4 E4 F4:2 E4 F4 G4:2 ' +
      'G4 A4 G4 F4 E4 F4 G4:2 D4 G4 E4 C4:2'),
  },
  {
    id: 'wisconsin',
    title: 'On, Wisconsin!',
    // From the user's own MIDI arrangement (French Horn melody track) —
    // exact pitches and durations read straight from the note-on/note-off
    // events, so no transcription guesswork here.
    notes: parse('F4:1.5 D#4:0.5 G4 F4 A#4:1.5 A4:0.5 C5 A#4 D5 D5 D5 D5 D5:3.5 ' +
      'C5:1.5 A#4:0.5 C5 D5 A#4:1.5 C5:0.5 D5 A#4:0.5 A#4:0.5 A4 G4 A4 A#4 C5:2.5 ' +
      'A4:0.5 G4:0.5 F4:0.5 F4:1.5 D#4:0.5 G4 F4 A#4:1.5 A4:0.5 C5 A#4 C5 A#4 C5 C5 D5:4 ' +
      'D#5:1.5 A#4 C5 D5 D#5 F5 G5 D5:2 C5:2 A#4:2.5 A#4:0.5'),
  },
];

// "C4" or "C4:1.5" (note:duration, duration defaults to 1 = one beat).
function parse(seq) {
  return seq.trim().split(/\s+/).map((tok) => {
    const [note, dur] = tok.split(':');
    return { note, dur: dur ? Number(dur) : 1 };
  });
}
