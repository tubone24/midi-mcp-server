/**
 * Chord name to MIDI pitches expansion utility.
 * Supports major, minor, diminished, augmented, 7th, 9th, sus, and more.
 */

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const CHORD_INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7], // major
  maj: [0, 4, 7], // major (explicit)
  m: [0, 3, 7], // minor
  min: [0, 3, 7], // minor (alias)
  dim: [0, 3, 6], // diminished
  aug: [0, 4, 8], // augmented
  '7': [0, 4, 7, 10], // dominant 7th
  maj7: [0, 4, 7, 11], // major 7th
  M7: [0, 4, 7, 11], // major 7th (alias)
  m7: [0, 3, 7, 10], // minor 7th
  min7: [0, 3, 7, 10], // minor 7th (alias)
  dim7: [0, 3, 6, 9], // diminished 7th
  m7b5: [0, 3, 6, 10], // half-diminished
  aug7: [0, 4, 8, 10], // augmented 7th
  '6': [0, 4, 7, 9], // major 6th
  m6: [0, 3, 7, 9], // minor 6th
  '9': [0, 4, 7, 10, 14], // dominant 9th
  maj9: [0, 4, 7, 11, 14], // major 9th
  m9: [0, 3, 7, 10, 14], // minor 9th
  add9: [0, 4, 7, 14], // add 9th
  '11': [0, 4, 7, 10, 14, 17], // 11th
  '13': [0, 4, 7, 10, 14, 21], // 13th
  sus2: [0, 2, 7], // suspended 2nd
  sus4: [0, 5, 7], // suspended 4th
  '7sus4': [0, 5, 7, 10], // 7th suspended 4th
  '7sus2': [0, 2, 7, 10], // 7th suspended 2nd
  power: [0, 7], // power chord (5th)
  '5': [0, 7], // power chord alias
};

// Dotted and triplet duration support
const EXTENDED_DURATION_MAP: Record<string, string> = {
  d1: 'd1', // dotted whole
  d2: 'd2', // dotted half
  d4: 'd4', // dotted quarter
  d8: 'd8', // dotted eighth
  d16: 'd16', // dotted sixteenth
  dd4: 'dd4', // double-dotted quarter
};

/**
 * Parse a note name (e.g., "C4", "F#5", "Bb3") to a MIDI note number (0-127).
 */
export function parseNoteName(noteName: string): number {
  const match = noteName.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid note name: ${noteName}`);
  }

  const [, letter, accidental, octaveStr] = match;
  const baseSemitone = NOTE_TO_SEMITONE[letter.toUpperCase()];
  if (baseSemitone === undefined) {
    throw new Error(`Invalid note letter: ${letter}`);
  }

  let semitone = baseSemitone;
  if (accidental === '#') semitone += 1;
  else if (accidental === 'b') semitone -= 1;

  const octave = parseInt(octaveStr, 10);
  const midiNumber = (octave + 1) * 12 + semitone;

  if (midiNumber < 0 || midiNumber > 127) {
    throw new Error(`MIDI note number out of range (0-127): ${midiNumber} for ${noteName}`);
  }

  return midiNumber;
}

/**
 * Convert a MIDI note number to a note name string (e.g., 60 → "C4").
 */
export function midiNumberToNoteName(midiNumber: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNumber / 12) - 1;
  const noteIndex = midiNumber % 12;
  return `${noteNames[noteIndex]}${octave}`;
}

/**
 * Parse a chord name (e.g., "Cmaj7", "Dm", "G7", "F#m7") and return
 * an array of MIDI note numbers for the chord in a given octave.
 */
export function parseChordName(chordName: string, defaultOctave: number = 4): number[] {
  // Match: root note (with optional accidental) + optional octave + chord quality
  const match = chordName.match(/^([A-Ga-g])([#b]?)(\d)?(.*)$/);
  if (!match) {
    throw new Error(`Invalid chord name: ${chordName}`);
  }

  const [, letter, accidental, octaveStr, quality] = match;
  const octave = octaveStr !== undefined ? parseInt(octaveStr, 10) : defaultOctave;

  // Calculate root MIDI number
  const baseSemitone = NOTE_TO_SEMITONE[letter.toUpperCase()];
  if (baseSemitone === undefined) {
    throw new Error(`Invalid root note: ${letter}`);
  }

  let rootSemitone = baseSemitone;
  if (accidental === '#') rootSemitone += 1;
  else if (accidental === 'b') rootSemitone -= 1;

  const rootMidi = (octave + 1) * 12 + rootSemitone;

  // Look up chord intervals
  const intervals = CHORD_INTERVALS[quality];
  if (!intervals) {
    throw new Error(
      `Unknown chord quality: "${quality}" in chord "${chordName}". ` +
        `Supported: ${Object.keys(CHORD_INTERVALS)
          .filter((k) => k)
          .join(', ')}`
    );
  }

  // Build chord pitches
  const pitches = intervals.map((interval) => {
    const midi = rootMidi + interval;
    if (midi < 0 || midi > 127) {
      throw new Error(`Chord pitch out of MIDI range: ${midi}`);
    }
    return midi;
  });

  return pitches;
}

/**
 * Resolve a pitch value that can be:
 * - A MIDI number (0-127)
 * - A note name string ("C4", "F#5")
 * - An array of the above (chord as individual pitches)
 * - Will also check for chord field
 */
export function resolvePitches(
  pitch: number | string | (number | string)[],
  chord?: string
): (number | string)[] {
  // If chord name is specified, expand it
  if (chord) {
    const midiNumbers = parseChordName(chord);
    return midiNumbers;
  }

  // If pitch is already an array, return as-is
  if (Array.isArray(pitch)) {
    return pitch;
  }

  // Single pitch
  return [pitch];
}

/**
 * Convert extended duration strings (dotted, triplet) to midi-writer-js format.
 * Standard durations: '1', '2', '4', '8', '16', '32', '64'
 * Dotted: 'd1', 'd2', 'd4', 'd8', 'd16'
 * Double-dotted: 'dd4'
 * Triplet: 'T4', 'T8' (handled separately via midi-writer-js)
 */
export function normalizeDuration(duration: string | number): string {
  if (typeof duration === 'number') {
    switch (duration) {
      case 0.125:
        return '32';
      case 0.25:
        return '16';
      case 0.5:
        return '8';
      case 1:
        return '4';
      case 2:
        return '2';
      case 4:
        return '1';
      default:
        return '4';
    }
  }

  // Check if it's an extended duration
  if (EXTENDED_DURATION_MAP[duration]) {
    return EXTENDED_DURATION_MAP[duration];
  }

  // Standard durations pass through
  const validDurations = ['1', '2', '4', '8', '16', '32', '64'];
  if (validDurations.includes(duration)) {
    return duration;
  }

  // Triplet durations (T4, T8, etc.) pass through
  if (duration.startsWith('T') && validDurations.includes(duration.slice(1))) {
    return duration;
  }

  // Default
  return '4';
}

/**
 * Get all supported chord qualities.
 */
export function getSupportedChordQualities(): string[] {
  return Object.keys(CHORD_INTERVALS).filter((k) => k !== '');
}
