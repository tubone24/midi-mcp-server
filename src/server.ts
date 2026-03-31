import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import MidiWriter from 'midi-writer-js';
import {
  resolvePitches,
  normalizeDuration,
  getSupportedChordQualities,
  parseChordName,
  midiNumberToNoteName,
} from './chord-utils.js';

// ---------- Load built HTML at module level ----------

let builtHtml: string;
try {
  builtHtml = readFileSync(new URL('../dist/src/mcp-app.html', import.meta.url), 'utf-8');
} catch {
  builtHtml =
    '<!DOCTYPE html><html><body><p>MIDI Preview UI not built. Run: npm run build:ui</p></body></html>';
}

// ---------- Interfaces ----------

export interface MidiNote {
  pitch: number | string | (number | string)[];
  chord?: string;
  beat?: number;
  startTime?: number;
  time?: number;
  duration: string | number;
  velocity?: number;
  channel?: number;
}

export interface MidiTrack {
  name?: string;
  instrument?: number;
  notes: MidiNote[];
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface MidiComposition {
  bpm: number;
  tempo?: number;
  timeSignature?: TimeSignature;
  tracks: MidiTrack[];
}

// ---------- MIDI Generation (in-memory, no fs) ----------

function convertBeatToWait(beat: number, bpm: number): string {
  const PPQ = 128;
  const adjustedBeat = beat - 1;
  const ticks = Math.round((adjustedBeat * PPQ) / bpm);
  return `T${ticks}`;
}

export function generateMidiBase64(composition: MidiComposition): string {
  const tracks: unknown[] = [];
  const tempo = composition.bpm || composition.tempo || 120;
  const timeSignature = composition.timeSignature || { numerator: 4, denominator: 4 };

  composition.tracks.forEach((trackData, trackIndex) => {
    // @ts-expect-error - Track is not properly exported in type definitions
    const track = new MidiWriter.Track();

    if (trackData.name) {
      track.addTrackName(trackData.name);
    }

    track.setTempo(tempo);
    track.setTimeSignature(timeSignature.numerator, timeSignature.denominator);

    if (trackData.instrument !== undefined) {
      track.addEvent(
        // @ts-expect-error - ProgramChangeEvent is not properly exported in type definitions
        new MidiWriter.ProgramChangeEvent({
          instrument: trackData.instrument,
          channel: trackIndex % 16,
        })
      );
    }

    trackData.notes.forEach((note) => {
      const pitches = resolvePitches(note.pitch, note.chord);
      const duration = normalizeDuration(note.duration);
      const velocity = note.velocity !== undefined ? note.velocity : 100;
      const channel = note.channel !== undefined ? note.channel % 16 : trackIndex % 16;

      let wait: string;
      if (note.beat !== undefined) {
        wait = convertBeatToWait(note.beat, tempo);
      } else {
        const startTime = note.startTime ?? note.time ?? 0;
        wait = `T${Math.round(startTime * 0.5)}`;
      }

      track.addEvent(
        // @ts-expect-error - NoteEvent is not properly exported in type definitions
        new MidiWriter.NoteEvent({
          pitch: pitches.length === 1 ? [pitches[0]] : pitches,
          duration: duration,
          velocity: velocity,
          channel: channel,
          wait: wait,
        })
      );
    });

    tracks.push(track);
  });

  // @ts-expect-error - Writer is not properly exported in type definitions
  const writer = new MidiWriter.Writer(tracks);
  const fileData: Uint8Array = writer.buildFile();
  let binary = '';
  for (let i = 0; i < fileData.length; i++) {
    binary += String.fromCharCode(fileData[i]);
  }
  return btoa(binary);
}

// ---------- Composition Preprocessing ----------

function preprocessComposition(raw: MidiComposition): MidiComposition {
  const composition = JSON.parse(JSON.stringify(raw)) as MidiComposition;

  if (!composition.bpm && composition.tempo) {
    composition.bpm = composition.tempo;
  }
  if (!composition.bpm) {
    composition.bpm = 120;
  }

  composition.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      if (typeof note.duration === 'number') {
        note.duration = normalizeDuration(note.duration);
      }
      if ('time' in note && note.startTime === undefined) {
        note.startTime = note.time;
        delete note.time;
      }
    });
  });

  return composition;
}

// ---------- MCP Server Factory ----------

const RESOURCE_URI = 'ui://midi-preview/app.html';

export function createServer(): McpServer {
  const chordQualities = getSupportedChordQualities();

  const server = new McpServer(
    {
      name: 'midi-mcp-server',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // --- Register App Resource (preview UI HTML) ---
  registerAppResource(server, 'MIDI Preview', RESOURCE_URI, {}, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: builtHtml,
      },
    ],
  }));

  // --- Register App Tool: create_midi ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (registerAppTool as any)(
    server,
    'create_midi',
    {
      title: 'Create MIDI',
      description: `Generate a MIDI file from structured composition data with chord support.\nSupports single notes, note arrays (chords), and chord names (${chordQualities.slice(0, 10).join(', ')}, etc.).\nReturns base64-encoded MIDI data and displays an interactive preview with piano-roll notation and playback.`,
      inputSchema: {
        title: z.string().describe('Title of the composition'),
        composition: z
          .any()
          .describe(
            'Composition object with bpm (number), optional timeSignature ({numerator, denominator}), and tracks (array of {name?, instrument?, notes: [{pitch, chord?, beat?, startTime?, duration, velocity?, channel?}]})'
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async ({ title, composition: rawComposition }: { title: string; composition: unknown }) => {
      try {
        const composition = preprocessComposition(rawComposition as MidiComposition);
        const midiBase64 = generateMidiBase64(composition);

        return {
          content: [
            {
              type: 'text' as const,
              text: `MIDI file "${title}" generated successfully. ${composition.tracks.length} track(s), ${composition.bpm} BPM.`,
            },
            {
              type: 'resource' as const,
              resource: {
                uri: `data:audio/midi;base64,${midiBase64}`,
                mimeType: 'audio/midi',
                text: midiBase64,
              },
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error generating MIDI: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // --- Register Tool: parse_chord (non-UI tool) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.tool as any)(
    'parse_chord',
    'Parse a chord name and return its component MIDI pitches. Useful for understanding chord voicings.',
    {
      chord: z.string().describe('Chord name (e.g., "Cmaj7", "Dm", "F#m7", "G7sus4")'),
      octave: z.number().optional().describe('Octave for the root note (default: 4)'),
    },
    async ({ chord, octave }: { chord: string; octave?: number }) => {
      try {
        const midiNumbers = parseChordName(chord, octave ?? 4);
        const noteNames = midiNumbers.map(midiNumberToNoteName);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ chord, octave: octave ?? 4, midiNumbers, noteNames }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error parsing chord: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
