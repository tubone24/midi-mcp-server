import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import MidiWriter from 'midi-writer-js';
import {
  resolvePitches,
  normalizeDuration,
  getSupportedChordQualities,
  parseChordName,
  midiNumberToNoteName,
} from './chord-utils.js';
import { getMcpAppHtml } from './ui-html.js';

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
  // Convert Uint8Array to base64 string
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

const RESOURCE_URI = 'ui://midi-preview/app';

export function createServer(): Server {
  const chordQualities = getSupportedChordQualities();
  const htmlContent = getMcpAppHtml();

  const server = new Server(
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

  // --- List Resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: RESOURCE_URI,
        name: 'MIDI Preview App',
        description: 'Interactive MIDI preview with piano-roll notation and audio playback',
        mimeType: 'text/html',
      },
    ],
  }));

  // --- Read Resource ---
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === RESOURCE_URI) {
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: 'text/html',
            text: htmlContent,
          },
        ],
      };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
  });

  // --- List Tools ---
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'create_midi',
        description: `Generate a MIDI file from structured composition data with chord support.\nSupports single notes, note arrays (chords), and chord names (${chordQualities.slice(0, 10).join(', ')}, etc.).\nReturns base64-encoded MIDI data and triggers a preview UI for playback and notation display.`,
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Title of the composition' },
            composition: {
              type: 'object',
              description: 'Composition data',
              properties: {
                bpm: { type: 'number', description: 'Tempo in BPM (20-300)' },
                tempo: { type: 'number', description: 'Alias for bpm' },
                timeSignature: {
                  type: 'object',
                  properties: {
                    numerator: { type: 'number' },
                    denominator: { type: 'number' },
                  },
                },
                tracks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Track name' },
                      instrument: {
                        type: 'number',
                        description: 'GM MIDI instrument (0-127)',
                      },
                      notes: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            pitch: {
                              description:
                                'MIDI note number (0-127), note name ("C4"), or array of pitches for chord',
                              oneOf: [
                                { type: 'number' },
                                { type: 'string' },
                                {
                                  type: 'array',
                                  items: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                                },
                              ],
                            },
                            chord: {
                              type: 'string',
                              description:
                                'Chord name (e.g., "Cmaj7", "Dm", "G7") - expands to pitches',
                            },
                            beat: {
                              type: 'number',
                              description: 'Beat position (1.0 = first beat, 1.5 = between beats)',
                            },
                            startTime: { type: 'number', description: 'Start time in ticks' },
                            duration: {
                              description:
                                "Note duration: '1'=whole, '2'=half, '4'=quarter, '8'=eighth, '16'=16th, 'd4'=dotted quarter, 'T4'=triplet quarter",
                              oneOf: [{ type: 'string' }, { type: 'number' }],
                            },
                            velocity: {
                              type: 'number',
                              description: 'Note velocity (0-127, default: 100)',
                            },
                            channel: {
                              type: 'number',
                              description: 'MIDI channel (0-15)',
                            },
                          },
                          required: ['duration'],
                        },
                      },
                    },
                    required: ['notes'],
                  },
                },
              },
              required: ['bpm', 'tracks'],
            },
          },
          required: ['title', 'composition'],
        },
      },
      {
        name: 'parse_chord',
        description:
          'Parse a chord name and return its component MIDI pitches. Useful for understanding chord voicings.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            chord: {
              type: 'string',
              description: 'Chord name (e.g., "Cmaj7", "Dm", "F#m7", "G7sus4")',
            },
            octave: {
              type: 'number',
              description: 'Octave for the root note (default: 4)',
            },
          },
          required: ['chord'],
        },
      },
    ],
  }));

  // --- Call Tool ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'create_midi') {
      try {
        const typedArgs = args as {
          title: string;
          composition: MidiComposition;
        };

        const composition = preprocessComposition(typedArgs.composition);
        const midiBase64 = generateMidiBase64(composition);

        return {
          content: [
            {
              type: 'text' as const,
              text: `MIDI file "${typedArgs.title}" generated successfully. ${composition.tracks.length} track(s), ${composition.bpm} BPM.`,
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
          _meta: {
            ui: {
              resourceUri: RESOURCE_URI,
            },
          },
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

    if (name === 'parse_chord') {
      try {
        const typedArgs = args as { chord: string; octave?: number };
        const midiNumbers = parseChordName(typedArgs.chord, typedArgs.octave ?? 4);
        const noteNames = midiNumbers.map(midiNumberToNoteName);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  chord: typedArgs.chord,
                  octave: typedArgs.octave ?? 4,
                  midiNumbers,
                  noteNames,
                },
                null,
                2
              ),
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

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  });

  server.onerror = (error) => console.error('[MCP Error]', error);

  return server;
}
