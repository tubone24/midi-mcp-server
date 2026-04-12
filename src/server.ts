import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { z } from 'zod';
import { Midi } from '@tonejs/midi';
import {
  resolvePitches,
  normalizeDuration,
  parseNoteName,
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

// ---------- Load music theory resources ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadResource(filename: string): string {
  try {
    return readFileSync(join(__dirname, 'resources', filename), 'utf-8');
  } catch {
    return `# Resource Not Found\n\nCould not load ${filename}.`;
  }
}

const MUSIC_THEORY_RESOURCES = [
  {
    name: 'Harmony & Music Theory',
    uri: 'music-theory://harmony',
    description: 'Intervals, chord types, diatonic chords, cadences, and voice leading rules',
    file: 'harmony.md',
  },
  {
    name: 'Chord Progressions',
    uri: 'music-theory://chord-progressions',
    description: 'Common progressions by mood/genre, substitutions, and modulation strategies',
    file: 'chord-progressions.md',
  },
  {
    name: 'Counterpoint',
    uri: 'music-theory://counterpoint',
    description: "Species counterpoint rules (Fux's five species), consonance/dissonance, motion types",
    file: 'counterpoint.md',
  },
  {
    name: 'Modes & Scales',
    uri: 'music-theory://modes-scales',
    description: 'Seven diatonic modes, minor scale variants, pentatonic/blues scales, genre guide',
    file: 'modes-scales.md',
  },
  {
    name: 'Orchestration',
    uri: 'music-theory://orchestration',
    description: 'Instrument ranges, GM program numbers, four-part harmony ranges, texture types',
    file: 'orchestration.md',
  },
  {
    name: 'Rhythm Patterns',
    uri: 'music-theory://rhythm-patterns',
    description: 'Time signatures, MIDI duration reference, genre grooves, velocity and tempo guides',
    file: 'rhythm-patterns.md',
  },
  {
    name: 'Voice Leading',
    uri: 'music-theory://voice-leading',
    description: 'Forbidden parallels, chord voicing strategies, non-chord tones, MIDI tips',
    file: 'voice-leading.md',
  },
] as const;

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

/**
 * duration文字列（normalizeDuration出力）を四分音符数（beats）に変換する。
 * 四分音符 = 1 beat。全音符 = 4 beats。
 */
function durationToBeats(duration: string): number {
  switch (duration) {
    case '1':   return 4;      // 全音符
    case '2':   return 2;      // 二分音符
    case '4':   return 1;      // 四分音符
    case '8':   return 0.5;    // 八分音符
    case '16':  return 0.25;   // 十六分音符
    case '32':  return 0.125;  // 三十二分音符
    case '64':  return 0.0625; // 六十四分音符
    case 'd1':  return 6;      // 付点全音符 (4 × 1.5)
    case 'd2':  return 3;      // 付点二分音符 (2 × 1.5)
    case 'd4':  return 1.5;    // 付点四分音符 (1 × 1.5)
    case 'd8':  return 0.75;   // 付点八分音符 (0.5 × 1.5)
    case 'd16': return 0.375;  // 付点十六分音符 (0.25 × 1.5)
    case 'dd4': return 1.75;   // ダブル付点四分音符 (1 + 0.5 + 0.25)
    default: {
      // 三連符: 'T4' → 四分音符三連符 (2/3 beat), 'T8' → 八分音符三連符 (1/3 beat)
      if (duration.startsWith('T')) {
        const base = durationToBeats(duration.slice(1));
        return base * (2 / 3);
      }
      return 1; // フォールバック: 四分音符
    }
  }
}

export function generateMidiBase64(composition: MidiComposition): string {
  const bpm = composition.bpm || composition.tempo || 120;
  const timeSignature = composition.timeSignature || { numerator: 4, denominator: 4 };
  const secondsPerBeat = 60 / bpm;

  const midi = new Midi();

  // テンポ・拍子設定
  midi.header.tempos = [{ ticks: 0, bpm }];
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: [timeSignature.numerator, timeSignature.denominator] },
  ];
  midi.header.update();

  composition.tracks.forEach((trackData, trackIndex) => {
    const track = midi.addTrack();

    if (trackData.name) {
      track.name = trackData.name;
    }
    if (trackData.instrument !== undefined) {
      track.instrument.number = trackData.instrument;
    }
    // @tonejs/midi はチャンネルをトラック単位で管理する。
    // note.channel は @tonejs/midi の addNote API では指定不可のため、
    // トラックインデックスをチャンネルとして使用する。
    track.channel = trackIndex % 16;

    trackData.notes.forEach((note) => {
      const pitches = resolvePitches(note.pitch, note.chord);
      const durationSec = durationToBeats(normalizeDuration(note.duration)) * secondsPerBeat;
      // velocity: @tonejs/midi は 0.0〜1.0 の正規化値
      const velocity = Math.min(1, Math.max(0, (note.velocity ?? 100) / 127));

      // 開始時間（秒）: beat は 1 始まりなので -1 してからbeats→秒変換
      const timeSec =
        note.beat !== undefined
          ? (note.beat - 1) * secondsPerBeat
          : (note.startTime ?? note.time ?? 0);

      // 和音（複数ピッチ）は同一 time に複数ノートを追加
      pitches.forEach((pitch) => {
        const midiNum = typeof pitch === 'string' ? parseNoteName(pitch) : (pitch as number);
        track.addNote({
          midi: midiNum,
          time: timeSec,
          duration: durationSec,
          velocity,
        });
      });
    });
  });

  return Buffer.from(midi.toArray()).toString('base64');
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

  // --- Register Music Theory Resources ---
  for (const res of MUSIC_THEORY_RESOURCES) {
    const content = loadResource(res.file);
    const uri = res.uri;
    server.registerResource(
      res.name,
      res.uri,
      { description: res.description, mimeType: 'text/markdown' },
      async (_resourceUri) => ({
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      })
    );
  }

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
      outputSchema: z.object({
        midiBase64: z.string(),
        title: z.string(),
        bpm: z.number(),
        trackCount: z.number(),
      }),
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
          ],
          structuredContent: {
            midiBase64,
            title,
            bpm: composition.bpm,
            trackCount: composition.tracks.length,
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
  );

  // --- Register Tool: parse_chord (non-UI tool) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    'parse_chord',
    {
      description:
        'Parse a chord name and return its component MIDI pitches. Useful for understanding chord voicings.',
      inputSchema: {
        chord: z.string().describe('Chord name (e.g., "Cmaj7", "Dm", "F#m7", "G7sus4")'),
        octave: z.number().optional().describe('Octave for the root note (default: 4)'),
      },
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
