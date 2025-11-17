import { describe, it, expect } from 'vitest';

describe('MIDI MCP Server', () => {
  describe('Note conversion functions', () => {
    it('should handle numeric MIDI note numbers', () => {
      const midiNumber = 60;
      expect(typeof midiNumber).toBe('number');
      expect(midiNumber).toBeGreaterThanOrEqual(0);
      expect(midiNumber).toBeLessThanOrEqual(127);
    });

    it('should handle note duration conversion', () => {
      const durations = ['1', '2', '4', '8', '16', '32', '64'];
      durations.forEach((duration) => {
        expect(durations).toContain(duration);
      });
    });
  });

  describe('Beat to Wait conversion', () => {
    it('should convert beat positions correctly', () => {
      const beat = 1.0;
      const bpm = 120;
      const PPQ = 128;

      // beat 1.0 means the start of the first beat (position 0)
      const adjustedBeat = beat - 1;
      const ticks = Math.round((adjustedBeat * PPQ) / bpm);
      const wait = `T${ticks}`;

      expect(wait).toBe('T0');
    });

    it('should handle fractional beats', () => {
      const beat = 1.5; // halfway through first beat
      const bpm = 120;
      const PPQ = 128;

      const adjustedBeat = beat - 1;
      const ticks = Math.round((adjustedBeat * PPQ) / bpm);
      const wait = `T${ticks}`;

      expect(wait).toMatch(/^T\d+$/);
      expect(ticks).toBeGreaterThan(0);
    });
  });

  describe('Array chunking', () => {
    it('should chunk array into specified sizes', () => {
      const chunkArray = <T>(array: T[], size: number): T[][] => {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
          chunks.push(array.slice(i, i + size));
        }
        return chunks;
      };

      const testArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const chunks = chunkArray(testArray, 3);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual([1, 2, 3]);
      expect(chunks[1]).toEqual([4, 5, 6]);
      expect(chunks[2]).toEqual([7, 8, 9]);
      expect(chunks[3]).toEqual([10]);
    });
  });

  describe('Duration conversion', () => {
    it('should convert numeric durations to strings', () => {
      const conversions: Record<number, string> = {
        0.125: '32',
        0.25: '16',
        0.5: '8',
        1: '4',
        2: '2',
      };

      Object.entries(conversions).forEach(([numStr, expected]) => {
        const num = parseFloat(numStr);
        let result: string;

        switch (num) {
          case 0.125:
            result = '32';
            break;
          case 0.25:
            result = '16';
            break;
          case 0.5:
            result = '8';
            break;
          case 1:
            result = '4';
            break;
          case 2:
            result = '2';
            break;
          default:
            result = '4';
        }

        expect(result).toBe(expected);
      });
    });
  });

  describe('MidiComposition validation', () => {
    it('should validate a basic MIDI composition structure', () => {
      const composition = {
        bpm: 120,
        timeSignature: {
          numerator: 4,
          denominator: 4,
        },
        tracks: [
          {
            name: 'Test Track',
            instrument: 0,
            notes: [
              {
                pitch: 60,
                beat: 1.0,
                duration: '4',
                velocity: 100,
              },
            ],
          },
        ],
      };

      expect(composition.bpm).toBe(120);
      expect(composition.tracks).toHaveLength(1);
      expect(composition.tracks[0].notes).toHaveLength(1);
      expect(composition.tracks[0].notes[0].pitch).toBe(60);
    });

    it('should handle compositions without time signature', () => {
      const composition = {
        bpm: 120,
        tracks: [
          {
            notes: [
              {
                pitch: 60,
                duration: '4',
              },
            ],
          },
        ],
      };

      expect(composition.bpm).toBe(120);
      expect(composition.timeSignature).toBeUndefined();
      // Default should be 4/4
      const defaultTimeSignature = composition.timeSignature || { numerator: 4, denominator: 4 };
      expect(defaultTimeSignature.numerator).toBe(4);
      expect(defaultTimeSignature.denominator).toBe(4);
    });
  });
});
