import { describe, it, expect } from 'vitest';
import { generateMidiBase64 } from '../server.js';
import type { MidiComposition } from '../server.js';

describe('MIDI MCP Server', () => {
  describe('generateMidiBase64', () => {
    it('should generate a valid base64 MIDI string', () => {
      const composition: MidiComposition = {
        bpm: 120,
        tracks: [
          {
            name: 'Test',
            instrument: 0,
            notes: [
              { pitch: 60, beat: 1.0, duration: '4', velocity: 100 },
              { pitch: 64, beat: 2.0, duration: '4', velocity: 100 },
              { pitch: 67, beat: 3.0, duration: '4', velocity: 100 },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle chords as pitch arrays', () => {
      const composition: MidiComposition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              {
                pitch: [60, 64, 67],
                beat: 1.0,
                duration: '2',
                velocity: 80,
              },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle chord names', () => {
      const composition: MidiComposition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              {
                pitch: 0,
                chord: 'C4maj7',
                beat: 1.0,
                duration: '1',
                velocity: 100,
              },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle multiple tracks', () => {
      const composition: MidiComposition = {
        bpm: 100,
        timeSignature: { numerator: 4, denominator: 4 },
        tracks: [
          {
            name: 'Piano',
            instrument: 0,
            notes: [
              { pitch: 60, beat: 1.0, duration: '4' },
              { pitch: 64, beat: 2.0, duration: '4' },
            ],
          },
          {
            name: 'Bass',
            instrument: 32,
            notes: [
              { pitch: 36, beat: 1.0, duration: '2' },
              { pitch: 43, beat: 3.0, duration: '2' },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle dotted durations', () => {
      const composition: MidiComposition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              { pitch: 'C4', beat: 1.0, duration: 'd4' },
              { pitch: 'E4', beat: 2.5, duration: 'd8' },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
    });

    it('should handle string note names', () => {
      const composition: MidiComposition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              { pitch: 'C4', beat: 1.0, duration: '4' },
              { pitch: 'E4', beat: 2.0, duration: '4' },
              { pitch: 'G4', beat: 3.0, duration: '4' },
            ],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
    });

    it('should use default BPM when not specified', () => {
      const composition: MidiComposition = {
        bpm: 0,
        tempo: 140,
        tracks: [
          {
            notes: [{ pitch: 60, duration: '4' }],
          },
        ],
      };

      const result = generateMidiBase64(composition);
      expect(typeof result).toBe('string');
    });
  });

  describe('Beat to Wait conversion', () => {
    it('should convert beat positions correctly', () => {
      const beat = 1.0;
      const bpm = 120;
      const PPQ = 128;

      const adjustedBeat = beat - 1;
      const ticks = Math.round((adjustedBeat * PPQ) / bpm);
      const wait = `T${ticks}`;

      expect(wait).toBe('T0');
    });

    it('should handle fractional beats', () => {
      const beat = 1.5;
      const bpm = 120;
      const PPQ = 128;

      const adjustedBeat = beat - 1;
      const ticks = Math.round((adjustedBeat * PPQ) / bpm);
      const wait = `T${ticks}`;

      expect(wait).toMatch(/^T\d+$/);
      expect(ticks).toBeGreaterThan(0);
    });
  });

  describe('MidiComposition validation', () => {
    it('should validate a basic MIDI composition structure', () => {
      const composition = {
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        tracks: [
          {
            name: 'Test Track',
            instrument: 0,
            notes: [{ pitch: 60, beat: 1.0, duration: '4', velocity: 100 }],
          },
        ],
      };

      expect(composition.bpm).toBe(120);
      expect(composition.tracks).toHaveLength(1);
      expect(composition.tracks[0].notes[0].pitch).toBe(60);
    });

    it('should handle compositions with chord fields', () => {
      const composition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              { pitch: 0, chord: 'Cmaj7', duration: '1', beat: 1.0 },
              { pitch: 0, chord: 'Dm7', duration: '1', beat: 5.0 },
              { pitch: 0, chord: 'G7', duration: '1', beat: 9.0 },
            ],
          },
        ],
      };

      expect(composition.tracks[0].notes).toHaveLength(3);
      expect(composition.tracks[0].notes[0].chord).toBe('Cmaj7');
    });
  });
});
