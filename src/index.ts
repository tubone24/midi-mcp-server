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

interface MidiNote {
  pitch: number | string;
  beat?: number; // 拍単位での位置（1.0 = 1拍目、1.5 = 1拍目と2拍目の間）
  startTime?: number;
  time?: number;
  duration: string; // 文字列型に変更
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
            // バッチ処理をサポートすることを明示
            batching: {
              supported: true
            }
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
          description: "テキスト形式の音楽データからMIDIファイルを生成します。compositionが長くなる場合はinputSchemaを一度JSONファイルに書き出して読み込んで渡すようにすると安定します。",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "曲のタイトル",
              },
              composition: {
                type: "object",
                description: "音楽データのオブジェクト",
                properties: {
                  bpm: { type: "number" },
                  timeSignature: {
                    type: "object",
                    properties: {
                      numerator: { type: "number" },
                      denominator: { type: "number" }
                    }
                  },
                  tracks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        instrument: { type: "number" },
                        notes: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              pitch: { type: "number" },
                              beat: {
                                type: "number",
                                description: "拍単位での位置（1.0 = 1拍目、1.5 = 1拍目と2拍目の間）"
                              },
                              startTime: { type: "number" },
                              duration: {
                                type: "string",
                                enum: ["1", "2", "4", "8", "16", "32", "64"],
                                description: "音符の長さ（'1'=全音符, '2'=2分音符, '4'=4分音符, '8'=8分音符, '16'=16分音符, '32'=32分音符, '64'=64分音符）"
                              },
                              velocity: { type: "number" }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                required: ["bpm", "tracks"]
              },
              composition_file: {
                type: "string",
                description: "音楽データが含まれるJSONファイルの絶対パス。compositionが大きい場合はこちらを使用してください。"
              },
              output_path: {
                type: "string",
                description: "出力ファイル絶対パス",
              },
            },
            required: ["title", "output_path"],
            oneOf: [
              { required: ["composition"] },
              { required: ["composition_file"] }
            ]
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
              composition?: MidiComposition | string;
              composition_file?: string;
              output_path: string;
            };

            // 進捗通知を送信
            this.server.notification({
              method: "notifications/progress",
              params: {
                progress: 0,
                message: "MIDI生成を開始しました"
              }
            });

            let composition: MidiComposition;

            // compositionとcomposition_fileの両方が指定されていない場合はエラー
            if (!args.composition && !args.composition_file) {
              throw new McpError(
                  ErrorCode.InvalidParams,
                  "composition または composition_file のいずれかを指定する必要があります"
              );
            }

            try {
              // composition_fileが指定されている場合はファイルから読み込む
              if (args.composition_file) {
                try {
                  const fileContent = fs.readFileSync(args.composition_file, 'utf8');
                  composition = JSON.parse(fileContent);
                } catch (e) {
                  throw new McpError(
                      ErrorCode.InvalidParams,
                      `JSONファイルの読み込みに失敗しました: ${(e as Error).message}`
                  );
                }
              } else if (typeof args.composition === "string") {
                composition = JSON.parse(args.composition);
              } else {
                composition = args.composition as MidiComposition;
              }

              // 数値のdurationを文字列に変換
              composition.tracks.forEach(track => {
                track.notes.forEach(note => {
                  if (typeof note.duration === 'number') {
                    // 数値のdurationを適切な文字列に変換
                    switch (note.duration) {
                      case 0.125: note.duration = '32'; break;
                      case 0.25: note.duration = '16'; break;
                      case 0.5: note.duration = '8'; break;
                      case 1: note.duration = '4'; break;
                      case 2: note.duration = '2'; break;
                      default: note.duration = '4'; // デフォルト値
                    }
                  }
                });
              });

              // time属性をstartTimeに変換
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

            const midiFilePath = await this.createMidiFile(
                args.title,
                composition,
                args.output_path
            );

            // 完了通知
            this.server.notification({
              method: "notifications/progress",
              params: {
                progress: 100,
                message: "MIDI生成が完了しました"
              }
            });

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

  private convertBeatToWait(beat: number, bpm: number): string {
    // MIDIライターのwait形式に変換
    const PPQ = 128;

    // beatは1から始まるので、実際の位置を計算するには1を引く
    // 例: beat 1.0は実際には0拍目（曲の先頭）
    const adjustedBeat = beat - 1;

    // 拍をティックに変換
    const ticks = Math.round((adjustedBeat * PPQ) / bpm);

    return `T${ticks}`;
  }

  private async processMidiComposition(composition: MidiComposition): Promise<void> {
    // 大きなcompositionを処理する場合、トラックごとに分割して処理
    const batchSize = 50; // 一度に処理するノート数
    const promises: Promise<any>[] = [];

    // 進捗通知用の変数
    const totalTracks = composition.tracks.length;
    let processedTracks = 0;

    for (const track of composition.tracks) {
      // トラックのノートを適切なサイズに分割
      if (track.notes.length > batchSize) {
        const chunks = this.chunkArray(track.notes, batchSize);
        const chunkPromises = chunks.map(chunk => this.processNoteChunk(chunk));
        await Promise.all(chunkPromises);
      } else {
        await this.processTrack(track);
      }

      processedTracks++;
      // 進捗を更新
      const progress = Math.floor((processedTracks / totalTracks) * 100);
      this.server.notification({
        method: "notifications/progress",
        params: {
          progress: progress,
          message: `トラック ${processedTracks}/${totalTracks} を処理中...`
        }
      });
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async processNoteChunk(notes: MidiNote[]): Promise<void> {
    // ノートチャンクの処理ロジック
    return new Promise((resolve) => {
      // 各ノートの処理（実際の処理はMIDIファイル生成時に行われる）
      resolve();
    });
  }

  private async processTrack(track: MidiTrack): Promise<void> {
    // トラック全体の処理ロジック
    return new Promise((resolve) => {
      // トラックの処理（実際の処理はMIDIファイル生成時に行われる）
      resolve();
    });
  }

  private async createMidiFile(
      title: string,
      composition: MidiComposition,
      outputPath: string
  ): Promise<string> {
    try {
      // 大きなcompositionを前処理
      await this.processMidiComposition(composition);

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

          // beatが指定されている場合はそれを使用、そうでなければstartTimeまたはtimeを使用
          let wait;
          if (note.beat !== undefined) {
            wait = this.convertBeatToWait(note.beat, composition.bpm);
          } else {
            const startTime = note.startTime || 0;
            wait = `T${Math.round(startTime * 0.5)}`;
          }

          // midi-writer-jsの型ファイルがおかしいっぽい。
          // @ts-ignore
          track.addEvent(new MidiWriter.NoteEvent({
            pitch: [pitch],
            duration: note.duration,
            velocity: velocity,
            channel: channel,
            wait: wait
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
    } catch (error) {
      console.error("MIDI生成中にエラーが発生しました:", error);
      throw new McpError(
          ErrorCode.InternalError,
          `MIDI生成中にエラーが発生しました: ${(error as Error).message}`
      );
    }
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
