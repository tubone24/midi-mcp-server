/**
 * Cloudflare Workers entry point for the MIDI MCP Server.
 *
 * Deploy with: npx wrangler deploy
 *
 * This exposes the MCP server over Streamable HTTP transport,
 * suitable for use as a remote MCP server from Claude Desktop,
 * Claude.ai, or any MCP-compatible client.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import MidiWriter from 'midi-writer-js';
import {
  resolvePitches,
  normalizeDuration,
  getSupportedChordQualities,
  parseChordName,
  midiNumberToNoteName,
} from './chord-utils.js';
import { getMcpAppHtml } from './ui-html.js';

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

// ---------- Server Factory ----------

function createWorkerServer(): McpServer {
  const server = new McpServer(
    { name: 'midi-mcp-server', version: '0.2.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  const chordQualities = getSupportedChordQualities();
  const resourceUri = 'ui://midi-preview/app';
  const htmlContent = getMcpAppHtml();

  server.resource('midi-preview-app', resourceUri, async () => ({
    contents: [
      {
        uri: resourceUri,
        mimeType: 'text/html',
        text: htmlContent,
      },
    ],
  }));

  server.tool(
    'create_midi',
    `Generate a MIDI file from structured composition data with chord support.
Supports single notes, note arrays (chords), and chord names (${chordQualities.slice(0, 10).join(', ')}, etc.).
Returns base64-encoded MIDI data and triggers a preview UI for playback and notation display.`,
    {
      title: z.string().describe('Title of the composition'),
      composition: z
        .object({
          bpm: z.number().min(20).max(300),
          tempo: z.number().optional(),
          timeSignature: z
            .object({
              numerator: z.number().min(1).max(16),
              denominator: z.number().min(1).max(16),
            })
            .optional(),
          tracks: z.array(
            z.object({
              name: z.string().optional(),
              instrument: z.number().min(0).max(127).optional(),
              notes: z.array(
                z.object({
                  pitch: z.union([
                    z.number().min(0).max(127),
                    z.string(),
                    z.array(z.union([z.number(), z.string()])),
                  ]),
                  chord: z.string().optional(),
                  beat: z.number().optional(),
                  startTime: z.number().optional(),
                  duration: z.union([z.string(), z.number()]),
                  velocity: z.number().min(0).max(127).optional(),
                  channel: z.number().min(0).max(15).optional(),
                })
              ),
            })
          ),
        })
        .describe('Composition data'),
    },
    async (args) => {
      try {
        const composition = preprocessComposition(args.composition as MidiComposition);
        const midiBase64 = generateMidiBase64(composition);

        return {
          content: [
            {
              type: 'text' as const,
              text: `MIDI file "${args.title}" generated successfully. ${composition.tracks.length} track(s), ${composition.bpm} BPM.`,
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
            ui: { resourceUri },
          },
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'parse_chord',
    'Parse a chord name and return its component MIDI pitches.',
    {
      chord: z.string(),
      octave: z.number().min(0).max(8).optional(),
    },
    async (args) => {
      try {
        const midiNumbers = parseChordName(args.chord, args.octave ?? 4);
        const noteNames = midiNumbers.map(midiNumberToNoteName);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ chord: args.chord, midiNumbers, noteNames }, null, 2),
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
  );

  return server;
}

// ---------- Cloudflare Workers Fetch Handler ----------

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
          'Access-Control-Expose-Headers': 'mcp-session-id',
        },
      });
    }

    // Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json(
        { status: 'ok', name: 'midi-mcp-server', version: '0.2.0' },
        {
          headers: { 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    // MCP endpoint
    if (url.pathname === '/mcp' || url.pathname === '/') {
      const server = createWorkerServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      await server.connect(transport);

      // Convert the Request to a node-like req/res and handle
      // For Workers, we need to adapt the transport
      const body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Create a promise-based response handler
      return new Promise<Response>((resolve) => {
        const chunks: string[] = [];
        let statusCode = 200;
        const responseHeaders: Record<string, string> = {
          'Access-Control-Allow-Origin': '*',
        };

        const mockRes = {
          writeHead(code: number, hdrs?: Record<string, string>) {
            statusCode = code;
            if (hdrs) {
              Object.entries(hdrs).forEach(([k, v]) => {
                responseHeaders[k] = v;
              });
            }
          },
          setHeader(key: string, value: string) {
            responseHeaders[key] = value;
          },
          getHeader(key: string) {
            return responseHeaders[key];
          },
          write(chunk: string) {
            chunks.push(chunk);
            return true;
          },
          end(data?: string) {
            if (data) chunks.push(data);
            resolve(
              new Response(chunks.join(''), {
                status: statusCode,
                headers: responseHeaders,
              })
            );
          },
          on(_event: string, _handler: () => void) {
            // no-op for close event in workers
          },
        };

        const mockReq = {
          method: request.method,
          url: url.pathname,
          headers,
          on(event: string, handler: (data?: string) => void) {
            if (event === 'data') handler(body);
            if (event === 'end') handler();
          },
        };

        transport.handleRequest(mockReq as never, mockRes as never);
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
