import { describe, it, expect } from 'vitest';
import {
  parseNoteName,
  midiNumberToNoteName,
  parseChordName,
  resolvePitches,
  normalizeDuration,
  getSupportedChordQualities,
} from '../chord-utils.js';

describe('parseNoteName', () => {
  it('should parse C4 to MIDI 60', () => {
    expect(parseNoteName('C4')).toBe(60);
  });

  it('should parse A4 to MIDI 69', () => {
    expect(parseNoteName('A4')).toBe(69);
  });

  it('should handle sharps', () => {
    expect(parseNoteName('C#4')).toBe(61);
    expect(parseNoteName('F#3')).toBe(54);
  });

  it('should handle flats', () => {
    expect(parseNoteName('Bb3')).toBe(58);
    expect(parseNoteName('Eb4')).toBe(63);
  });

  it('should handle low octaves', () => {
    expect(parseNoteName('C0')).toBe(12);
    expect(parseNoteName('A0')).toBe(21);
  });

  it('should handle high octaves', () => {
    expect(parseNoteName('C8')).toBe(108);
  });

  it('should throw for invalid note names', () => {
    expect(() => parseNoteName('X4')).toThrow('Invalid note name');
    expect(() => parseNoteName('hello')).toThrow('Invalid note name');
  });
});

describe('midiNumberToNoteName', () => {
  it('should convert 60 to C4', () => {
    expect(midiNumberToNoteName(60)).toBe('C4');
  });

  it('should convert 69 to A4', () => {
    expect(midiNumberToNoteName(69)).toBe('A4');
  });

  it('should handle sharps', () => {
    expect(midiNumberToNoteName(61)).toBe('C#4');
  });
});

describe('parseChordName', () => {
  it('should parse major chord', () => {
    const pitches = parseChordName('C4');
    expect(pitches).toEqual([60, 64, 67]); // C E G
  });

  it('should parse minor chord', () => {
    const pitches = parseChordName('C4m');
    expect(pitches).toEqual([60, 63, 67]); // C Eb G
  });

  it('should parse dominant 7th', () => {
    const pitches = parseChordName('G47');
    expect(pitches).toEqual([67, 71, 74, 77]); // G B D F
  });

  it('should parse major 7th', () => {
    const pitches = parseChordName('C4maj7');
    expect(pitches).toEqual([60, 64, 67, 71]); // C E G B
  });

  it('should parse minor 7th', () => {
    const pitches = parseChordName('A4m7');
    expect(pitches).toEqual([69, 72, 76, 79]); // A C E G
  });

  it('should parse diminished', () => {
    const pitches = parseChordName('B4dim');
    expect(pitches).toEqual([71, 74, 77]); // B D F
  });

  it('should parse augmented', () => {
    const pitches = parseChordName('C4aug');
    expect(pitches).toEqual([60, 64, 68]); // C E G#
  });

  it('should parse sus2', () => {
    const pitches = parseChordName('C4sus2');
    expect(pitches).toEqual([60, 62, 67]); // C D G
  });

  it('should parse sus4', () => {
    const pitches = parseChordName('C4sus4');
    expect(pitches).toEqual([60, 65, 67]); // C F G
  });

  it('should parse power chord', () => {
    const pitches = parseChordName('E4power');
    expect(pitches).toEqual([64, 71]); // E B
  });

  it('should handle sharp root notes', () => {
    const pitches = parseChordName('F#4m');
    expect(pitches).toEqual([66, 69, 73]); // F# A C#
  });

  it('should handle flat root notes', () => {
    const pitches = parseChordName('Bb3');
    expect(pitches).toEqual([58, 62, 65]); // Bb D F
  });

  it('should use default octave when not specified', () => {
    const pitches = parseChordName('Cmaj7');
    expect(pitches).toEqual([60, 64, 67, 71]); // C4 E4 G4 B4
  });

  it('should throw for unknown chord quality', () => {
    expect(() => parseChordName('C4xyz')).toThrow('Unknown chord quality');
  });
});

describe('resolvePitches', () => {
  it('should return single pitch as array', () => {
    expect(resolvePitches(60)).toEqual([60]);
    expect(resolvePitches('C4')).toEqual(['C4']);
  });

  it('should return array as-is', () => {
    expect(resolvePitches([60, 64, 67])).toEqual([60, 64, 67]);
  });

  it('should expand chord names', () => {
    const pitches = resolvePitches(0, 'C4');
    expect(pitches).toEqual([60, 64, 67]);
  });

  it('should prefer chord over pitch', () => {
    const pitches = resolvePitches(42, 'Am');
    expect(pitches.length).toBe(3);
  });
});

describe('normalizeDuration', () => {
  it('should convert numeric durations', () => {
    expect(normalizeDuration(0.125)).toBe('32');
    expect(normalizeDuration(0.25)).toBe('16');
    expect(normalizeDuration(0.5)).toBe('8');
    expect(normalizeDuration(1)).toBe('4');
    expect(normalizeDuration(2)).toBe('2');
    expect(normalizeDuration(4)).toBe('1');
  });

  it('should pass through standard string durations', () => {
    expect(normalizeDuration('1')).toBe('1');
    expect(normalizeDuration('4')).toBe('4');
    expect(normalizeDuration('16')).toBe('16');
  });

  it('should handle dotted durations', () => {
    expect(normalizeDuration('d4')).toBe('d4');
    expect(normalizeDuration('d8')).toBe('d8');
  });

  it('should handle triplet durations', () => {
    expect(normalizeDuration('T4')).toBe('T4');
    expect(normalizeDuration('T8')).toBe('T8');
  });

  it('should default to quarter note for unknown', () => {
    expect(normalizeDuration('xyz')).toBe('4');
    expect(normalizeDuration(99)).toBe('4');
  });
});

describe('getSupportedChordQualities', () => {
  it('should return list of chord qualities', () => {
    const qualities = getSupportedChordQualities();
    expect(qualities).toContain('m');
    expect(qualities).toContain('7');
    expect(qualities).toContain('maj7');
    expect(qualities).toContain('dim');
    expect(qualities).toContain('sus4');
  });
});
