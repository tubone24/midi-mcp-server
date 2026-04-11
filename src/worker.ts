/**
 * Cloudflare Workers entry point for the MIDI MCP Server.
 *
 * Deploy with: npx wrangler deploy
 *
 * This exposes the MCP server over Streamable HTTP transport,
 * suitable for use as a remote MCP server from Claude Desktop,
 * Claude.ai, or any MCP-compatible client.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import MidiWriter from 'midi-writer-js';
import {
  resolvePitches,
  normalizeDuration,
  getSupportedChordQualities,
  parseChordName,
  midiNumberToNoteName,
} from './chord-utils.js';
// The built HTML is imported as a text module by Wrangler.
// After running `npm run build:ui`, the file exists at dist/src/mcp-app.html.
// Wrangler bundles it as a text module via the rule in wrangler.toml.
import builtHtml from '../dist/src/mcp-app.html';
// Music theory resources are imported as text modules via the **/*.md rule in wrangler.toml.
import harmonyMd from './resources/harmony.md';
import chordProgressionsMd from './resources/chord-progressions.md';
import counterpointMd from './resources/counterpoint.md';
import modesScalesMd from './resources/modes-scales.md';
import orchestrationMd from './resources/orchestration.md';
import rhythmPatternsMd from './resources/rhythm-patterns.md';
import voiceLeadingMd from './resources/voice-leading.md';

// ---------- Types ----------

interface MidiNote {
  pitch: number | string | (number | string)[];
  chord?: string;
  beat?: number;
  startTime?: number;
  time?: number;
  duration: string | number;
  velocity?: number;
  channel?: number;
}

interface MidiTrack {
  name?: string;
  instrument?: number;
  notes: MidiNote[];
}

interface TimeSignature {
  numerator: number;
  denominator: number;
}

interface MidiComposition {
  bpm: number;
  tempo?: number;
  timeSignature?: TimeSignature;
  tracks: MidiTrack[];
}

// ---------- MIDI Generation ----------

function convertBeatToWait(beat: number, bpm: number): string {
  const PPQ = 128;
  const adjustedBeat = beat - 1;
  const ticks = Math.round((adjustedBeat * PPQ) / bpm);
  return `T${ticks}`;
}

function generateMidiBase64(composition: MidiComposition): string {
  const tracks: unknown[] = [];
  const tempo = composition.bpm || composition.tempo || 120;
  const timeSignature = composition.timeSignature || { numerator: 4, denominator: 4 };

  composition.tracks.forEach((trackData, trackIndex) => {
    // @ts-expect-error - Track type
    const track = new MidiWriter.Track();

    if (trackData.name) track.addTrackName(trackData.name);
    track.setTempo(tempo);
    track.setTimeSignature(timeSignature.numerator, timeSignature.denominator);

    if (trackData.instrument !== undefined) {
      track.addEvent(
        // @ts-expect-error - ProgramChangeEvent type
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
        // @ts-expect-error - NoteEvent type
        new MidiWriter.NoteEvent({
          pitch: pitches.length === 1 ? [pitches[0]] : pitches,
          duration,
          velocity,
          channel,
          wait,
        })
      );
    });

    tracks.push(track);
  });

  // @ts-expect-error - Writer type
  const writer = new MidiWriter.Writer(tracks);
  const fileData: Uint8Array = writer.buildFile();
  let binary = '';
  for (let i = 0; i < fileData.length; i++) {
    binary += String.fromCharCode(fileData[i]);
  }
  return btoa(binary);
}

function preprocessComposition(raw: MidiComposition): MidiComposition {
  const composition = JSON.parse(JSON.stringify(raw)) as MidiComposition;

  if (!composition.bpm && composition.tempo) composition.bpm = composition.tempo;
  if (!composition.bpm) composition.bpm = 120;

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

// ---------- Music Theory Resources ----------

const MUSIC_THEORY_RESOURCES = [
  {
    name: 'Harmony & Music Theory',
    uri: 'music-theory://harmony',
    description: 'Intervals, chord types, diatonic chords, cadences, and voice leading rules',
    content: harmonyMd,
  },
  {
    name: 'Chord Progressions',
    uri: 'music-theory://chord-progressions',
    description: 'Common progressions by mood/genre, substitutions, and modulation strategies',
    content: chordProgressionsMd,
  },
  {
    name: 'Counterpoint',
    uri: 'music-theory://counterpoint',
    description: "Species counterpoint rules (Fux's five species), consonance/dissonance, motion types",
    content: counterpointMd,
  },
  {
    name: 'Modes & Scales',
    uri: 'music-theory://modes-scales',
    description: 'Seven diatonic modes, minor scale variants, pentatonic/blues scales, genre guide',
    content: modesScalesMd,
  },
  {
    name: 'Orchestration',
    uri: 'music-theory://orchestration',
    description: 'Instrument ranges, GM program numbers, four-part harmony ranges, texture types',
    content: orchestrationMd,
  },
  {
    name: 'Rhythm Patterns',
    uri: 'music-theory://rhythm-patterns',
    description: 'Time signatures, MIDI duration reference, genre grooves, velocity and tempo guides',
    content: rhythmPatternsMd,
  },
  {
    name: 'Voice Leading',
    uri: 'music-theory://voice-leading',
    description: 'Forbidden parallels, chord voicing strategies, non-chord tones, MIDI tips',
    content: voiceLeadingMd,
  },
] as const;

const theoryResourceMap = new Map(MUSIC_THEORY_RESOURCES.map((r) => [r.uri, r.content]));

// ---------- Server Factory ----------

const RESOURCE_URI = 'ui://midi-preview/app';

function createWorkerServer(): Server {
  const chordQualities = getSupportedChordQualities();
  const htmlContent = builtHtml;

  const server = new Server(
    { name: 'midi-mcp-server', version: '0.2.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: RESOURCE_URI,
        name: 'MIDI Preview App',
        description: 'Interactive MIDI preview with piano-roll notation and audio playback',
        mimeType: 'text/html;profile=mcp-app',
      },
      ...MUSIC_THEORY_RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: 'text/markdown',
      })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === RESOURCE_URI) {
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: htmlContent }],
      };
    }
    const theoryContent = theoryResourceMap.get(request.params.uri);
    if (theoryContent !== undefined) {
      return {
        contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: theoryContent }],
      };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
  });

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
                  properties: { numerator: { type: 'number' }, denominator: { type: 'number' } },
                },
                tracks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      instrument: { type: 'number', description: 'GM MIDI instrument (0-127)' },
                      notes: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            pitch: {
                              description: 'MIDI note number, note name, or array for chord',
                              oneOf: [
                                { type: 'number' },
                                { type: 'string' },
                                {
                                  type: 'array',
                                  items: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                                },
                              ],
                            },
                            chord: { type: 'string', description: 'Chord name (e.g., "Cmaj7")' },
                            beat: {
                              type: 'number',
                              description: 'Beat position (1.0 = first beat)',
                            },
                            startTime: { type: 'number' },
                            duration: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                            velocity: { type: 'number' },
                            channel: { type: 'number' },
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
        _meta: {
          ui: { resourceUri: RESOURCE_URI },
          'ui/resourceUri': RESOURCE_URI,
        },
      },
      {
        name: 'parse_chord',
        description: 'Parse a chord name and return its component MIDI pitches.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            chord: { type: 'string', description: 'Chord name (e.g., "Cmaj7")' },
            octave: { type: 'number', description: 'Octave (default: 4)' },
          },
          required: ['chord'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'create_midi') {
      try {
        const typedArgs = args as { title: string; composition: MidiComposition };
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
          _meta: { ui: { resourceUri: RESOURCE_URI } },
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
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
              text: JSON.stringify({ chord: typedArgs.chord, midiNumbers, noteNames }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  });

  return server;
}

// ---------- CORS Helper ----------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, mcp-session-id, mcp-protocol-version',
    'Access-Control-Expose-Headers': 'mcp-session-id',
  };
}

// ---------- Cloudflare Workers Fetch Handler ----------

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json(
        { status: 'ok', name: 'midi-mcp-server', version: '0.2.0' },
        { headers: corsHeaders() }
      );
    }

    // MCP endpoint
    if (url.pathname === '/mcp' || url.pathname === '/') {
      const server = createWorkerServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
      });

      await server.connect(transport);

      try {
        const response = await transport.handleRequest(request);

        // Add CORS headers to the response
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders()).forEach(([key, value]) => {
          headers.set(key, value);
        });

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } finally {
        await transport.close();
        await server.close();
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  },
};
