#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import MidiWriter from 'midi-writer-js';

const durationMap = {
  0.125: "32", // 32分音符
  0.25: "16",  // 16分音符
  0.5: "8",    // 8分音符
  1: "4",      // 4分音符
  2: "2"       // 2分音符
};

interface MidiNote {
  pitch: number | string;
  startTime?: number;
  time?: number;
  duration: number;
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

class MidiMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
        {
          name: "midi-mcp-server",
          version: "0.1.0",
        },
        {
          capabilities: {
            tools: {},
          },
        }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "create_midi",
          description: "テキスト形式の音楽データからMIDIファイルを生成します",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "曲のタイトル",
              },
              composition: {
                type: "string",
                description: "音楽データのオブジェクト。以下の形式に従ってください：\n" +
                    "{" +
                    "  bpm: number," +
                    "  timeSignature: { numerator: number, denominator: number }," +
                    "  tracks: [" +
                    "    {" +
                    "      name: string," +
                    "      instrument: number," +
                    "      notes: [" +
                    "        { pitch: number, start: number, duration: number, velocity: number }" +
                    "      ]" +
                    "    }" +
                    "  ]," +
                    "}\n" +
                    "各プロパティの説明：\n" +
                    "- bpm: テンポ（1分間の拍数）\n" +
                    "- timeSignature: 拍子（例：4/4拍子の場合 {numerator: 4, denominator: 4}）\n" +
                    "- tracks: 楽器トラックの配列\n" +
                    "  - name: トラック名\n" +
                    "  - instrument: MIDIプログラム番号（0-127）\n" +
                    "  - notes: 音符の配列\n" +
                    "    - pitch: 音の高さ（MIDIノート番号、0-127）\n" +
                    "    - start: 開始時間（拍単位）\n" +
                    "    - duration: 音の長さ（拍単位）\n" +
                    "    - velocity: 音の強さ（0-127）\n"
              },
              output_path: {
                type: "string",
                description: "出力ファイルパス",
              },
            },
            required: ["title", "composition", "output_path"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(
        CallToolRequestSchema,
        async (request) => {
          const toolName = request.params.name;

          try {
            if (toolName !== "create_midi") {
              throw new McpError(
                  ErrorCode.MethodNotFound,
                  `Unknown tool: ${toolName}`
              );
            }

            const args = request.params.arguments as {
              title: string;
              composition: string;
              output_path: string;
            };

            let composition: MidiComposition;
            try {
              if (typeof args.composition === "string") {
                composition = JSON.parse(args.composition);
              } else {
                composition = args.composition as unknown as MidiComposition;
              }

              composition.tracks.forEach(track => {
                track.notes.forEach(note => {
                  if ('time' in note && note.startTime === undefined) {
                    note.startTime = note.time;
                    delete note.time;
                  }
                });
              });

            } catch (e) {
              throw new McpError(
                  ErrorCode.InvalidParams,
                  `Invalid composition format: ${(e as Error).message}`
              );
            }

            const midiFilePath = this.createMidiFile(
                args.title,
                composition,
                args.output_path
            );

            return {
              content: [
                {
                  type: "text",
                  text: `「${args.title}」のMIDIファイルを生成しました。ファイルは ${midiFilePath} に保存されました。`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `エラーが発生しました: ${(error as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        }
    );
  }

  private noteToMidiNumber(note: string | number): string | number {
    if (typeof note === "number") {
      return note;
    }
    return note;
  }

  private createMidiFile(
      title: string,
      composition: MidiComposition,
      outputPath: string
  ): string {
    // MidiWriterJSを使用してMIDIファイルを生成
    const tracks: any[] = [];

    // 各トラックを処理
    composition.tracks.forEach((trackData, trackIndex) => {
      // midi-writer-jsの型ファイルがおかしいっぽい。
      // @ts-ignore
      const track = new MidiWriter.Track();

      // トラック名を設定
      if (trackData.name) {
        track.addTrackName(trackData.name);
      }

      // テンポを設定
      const tempo = composition.bpm || composition.tempo || 120;
      track.setTempo(tempo);

      // 拍子記号を設定
      const timeSignature = composition.timeSignature || { numerator: 4, denominator: 4 };
      track.setTimeSignature(timeSignature.numerator, timeSignature.denominator);

      // 楽器を設定
      if (trackData.instrument !== undefined) {
        // midi-writer-jsの型ファイルがおかしいっぽい。
        // @ts-ignore
        track.addEvent(new MidiWriter.ProgramChangeEvent({
          instrument: trackData.instrument,
          channel: trackIndex % 16
        }));
      }

      // ノートを追加
      trackData.notes.forEach(note => {
        const pitch = this.noteToMidiNumber(note.pitch);
        const velocity = note.velocity !== undefined ? note.velocity : 100;
        const channel = note.channel !== undefined ? note.channel % 16 : trackIndex % 16;
        const startTime = note.startTime || 0;

        // midi-writer-jsの型ファイルがおかしいっぽい。
        // @ts-ignore
        track.addEvent(new MidiWriter.NoteEvent({
          pitch: [pitch],
          // @ts-ignore
          duration: durationMap[note.duration] || '4', // 適切な音符の長さに変換
          velocity: velocity,
          channel: channel,
          wait: Math.round(startTime * 128) // 待機時間の指定方法を修正
        }));
      });

      tracks.push(track);
    });

    // midi-writer-jsの型ファイルがおかしいっぽい。
    // @ts-ignore
    const writer = new MidiWriter.Writer(tracks);

    // 出力パスの処理
    let outputFilePath;
    if (path.isAbsolute(outputPath)) {
      outputFilePath = outputPath;
    } else {
      const safeBaseDir = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
      const midiDir = path.join(safeBaseDir, 'midi-files');
      if (!fs.existsSync(midiDir)) {
        fs.mkdirSync(midiDir, { recursive: true });
      }
      const fileName = path.basename(outputPath);
      outputFilePath = path.join(midiDir, fileName);
    }

    fs.writeFileSync(outputFilePath, Buffer.from(writer.buildFile(), 'base64'), 'binary');

    return outputFilePath;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MIDI MCP server running on stdio");
  }
}

const server = new MidiMcpServer();

async function main() {
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
