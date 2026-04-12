/**
 * Client-side MCP App for MIDI preview and playback.
 * Uses the @modelcontextprotocol/ext-apps App class for host communication.
 * Audio: soundfont-player (HD, loaded from CDN) with oscillator fallback.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import {
  applyHostStyleVariables,
  applyDocumentTheme,
  applyHostFonts,
  getDocumentTheme,
} from '@modelcontextprotocol/ext-apps';
import MidiWriter from 'midi-writer-js';
import { resolvePitches, normalizeDuration } from './chord-utils.js';
import Soundfont, { Player as SfPlayer, InstrumentName } from 'soundfont-player';

// ---------- Types ----------

interface NoteData {
  pitch: number | string | (number | string)[];
  chord?: string;
  beat?: number;
  startTime?: number;
  duration: string | number;
  velocity?: number;
}

interface TrackData {
  name?: string;
  instrument?: number;
  notes: NoteData[];
}

interface CompositionData {
  bpm: number;
  tempo?: number;
  tracks: TrackData[];
}

interface ToolInput {
  title?: string;
  composition: CompositionData;
}

// ---------- GM Program → soundfont-player instrument name ----------

const GM_NAMES: Record<number, InstrumentName> = {
  0: 'acoustic_grand_piano', 1: 'bright_acoustic_piano',
  2: 'electric_grand_piano', 3: 'honkytonk_piano',
  4: 'electric_piano_1', 5: 'electric_piano_2',
  6: 'harpsichord', 7: 'clavinet',
  8: 'celesta', 9: 'glockenspiel', 10: 'music_box',
  11: 'vibraphone', 12: 'marimba', 13: 'xylophone',
  14: 'tubular_bells', 15: 'dulcimer',
  16: 'drawbar_organ', 17: 'percussive_organ', 18: 'rock_organ',
  19: 'church_organ', 20: 'reed_organ', 21: 'accordion',
  22: 'harmonica', 23: 'tango_accordion',
  24: 'acoustic_guitar_nylon', 25: 'acoustic_guitar_steel',
  26: 'electric_guitar_jazz', 27: 'electric_guitar_clean',
  28: 'electric_guitar_muted', 29: 'overdriven_guitar',
  30: 'distortion_guitar', 31: 'guitar_harmonics',
  32: 'acoustic_bass', 33: 'electric_bass_finger',
  34: 'electric_bass_pick', 35: 'fretless_bass',
  36: 'slap_bass_1', 37: 'slap_bass_2',
  38: 'synth_bass_1', 39: 'synth_bass_2',
  40: 'violin', 41: 'viola', 42: 'cello', 43: 'contrabass',
  44: 'tremolo_strings', 45: 'pizzicato_strings',
  46: 'orchestral_harp', 47: 'timpani',
  48: 'string_ensemble_1', 49: 'string_ensemble_2',
  50: 'synth_strings_1', 51: 'synth_strings_2',
  52: 'choir_aahs', 53: 'voice_oohs', 54: 'synth_choir',
  55: 'orchestra_hit',
  56: 'trumpet', 57: 'trombone', 58: 'tuba',
  59: 'muted_trumpet', 60: 'french_horn', 61: 'brass_section',
  62: 'synth_brass_1', 63: 'synth_brass_2',
  64: 'soprano_sax', 65: 'alto_sax', 66: 'tenor_sax', 67: 'baritone_sax',
  68: 'oboe', 69: 'english_horn', 70: 'bassoon', 71: 'clarinet',
  72: 'piccolo', 73: 'flute', 74: 'recorder', 75: 'pan_flute',
  76: 'blown_bottle', 77: 'shakuhachi', 78: 'whistle', 79: 'ocarina',
  80: 'lead_1_square', 81: 'lead_2_sawtooth', 82: 'lead_3_calliope',
  83: 'lead_4_chiff', 84: 'lead_5_charang', 85: 'lead_6_voice',
  86: 'lead_7_fifths', 87: 'lead_8_bass__lead',
  88: 'pad_1_new_age', 89: 'pad_2_warm', 90: 'pad_3_polysynth',
  91: 'pad_4_choir', 92: 'pad_5_bowed', 93: 'pad_6_metallic',
  94: 'pad_7_halo', 95: 'pad_8_sweep',
  104: 'sitar', 105: 'banjo', 106: 'shamisen', 107: 'koto',
  108: 'kalimba', 109: 'bagpipe', 110: 'fiddle', 111: 'shanai',
  112: 'tinkle_bell', 113: 'agogo', 114: 'steel_drums',
  115: 'woodblock', 116: 'taiko_drum', 117: 'melodic_tom',
  118: 'synth_drum', 119: 'reverse_cymbal',
  120: 'guitar_fret_noise', 121: 'breath_noise', 122: 'seashore',
  123: 'bird_tweet', 124: 'telephone_ring', 125: 'helicopter',
  126: 'applause', 127: 'gunshot',
};

function gmToName(program: number): InstrumentName {
  return GM_NAMES[program] ?? 'acoustic_grand_piano';
}

// ---------- Soundfont Instrument Cache ----------

/** Shared AudioContext (created suspended; resumed on play). */
let sharedCtx: AudioContext | null = null;
function getSharedCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

const sfCache = new Map<InstrumentName, Promise<SfPlayer>>();

function loadSfInstrument(name: InstrumentName): Promise<SfPlayer> {
  if (!sfCache.has(name)) {
    const ctx = getSharedCtx();
    sfCache.set(
      name,
      Soundfont.instrument(ctx, name, { soundfont: 'MusyngKite', format: 'mp3' })
    );
  }
  return sfCache.get(name)!;
}

// Active sfPlayer instances for stop() support
let activeSfPlayers: SfPlayer[] = [];

/** Pre-load all instruments needed by a composition (runs in background). */
async function preloadSoundfonts(composition: CompositionData): Promise<boolean> {
  const programs = new Set(
    composition.tracks.map((t, i) => t.instrument ?? [0, 48, 25, 33, 73, 56, 40, 19][i % 8])
  );
  try {
    await Promise.all([...programs].map((p) => loadSfInstrument(gmToName(p))));
    return true;
  } catch (_e) {
    return false;
  }
}

// ---------- Oscillator Fallback (Web Audio synthesis) ----------

type InstrumentFamily =
  | 'piano' | 'chromatic' | 'organ' | 'guitar' | 'bass'
  | 'strings' | 'ensemble' | 'brass' | 'reed' | 'pipe'
  | 'synth-lead' | 'synth-pad' | 'other';

function getInstrumentFamily(program: number): InstrumentFamily {
  const p = Math.max(0, Math.min(127, program));
  if (p < 8)  return 'piano';   if (p < 16) return 'chromatic';
  if (p < 24) return 'organ';   if (p < 32) return 'guitar';
  if (p < 40) return 'bass';    if (p < 48) return 'strings';
  if (p < 56) return 'ensemble';if (p < 64) return 'brass';
  if (p < 72) return 'reed';    if (p < 80) return 'pipe';
  if (p < 88) return 'synth-lead'; if (p < 96) return 'synth-pad';
  return 'other';
}

function createReverbBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2.0);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * 0.4;
  }
  return buf;
}

// Oscillator synthesis nodes for stop()
let oscillatorNodes: OscillatorNode[] = [];
let oscDryBus: GainNode | null = null;
let oscReverbConv: ConvolverNode | null = null;
let oscWetBus: GainNode | null = null;

function initOscNodes(ctx: AudioContext) {
  if (oscDryBus) return;
  oscDryBus = ctx.createGain(); oscDryBus.gain.value = 0.7; oscDryBus.connect(ctx.destination);
  oscReverbConv = ctx.createConvolver(); oscReverbConv.buffer = createReverbBuffer(ctx);
  oscWetBus = ctx.createGain(); oscWetBus.gain.value = 0.25;
  oscReverbConv.connect(oscWetBus); oscWetBus.connect(ctx.destination);
}

function scheduleOscNote(
  ctx: AudioContext,
  freq: number,
  startSec: number,
  durSec: number,
  velocity: number,
  instrument: number
) {
  initOscNodes(ctx);
  const family = getInstrumentFamily(instrument);
  type OscConf = { type: OscillatorType; detune: number; mul?: number };
  let oscs: OscConf[] = [{ type: 'sine', detune: 0 }];
  let attack = 0.015, decayRatio = 0.6, release = 0.15, filterHz = 5000;

  switch (family) {
    case 'piano':
      oscs = [{ type: 'sawtooth', detune: -3 }, { type: 'triangle', detune: 0, mul: 0.8 }, { type: 'sine', detune: 2, mul: 0.5 }];
      attack = 0.006; decayRatio = 0.35; release = 0.6; filterHz = 4500; break;
    case 'organ':
      oscs = [{ type: 'sine', detune: 0 }, { type: 'sine', detune: 1200, mul: 0.6 }, { type: 'sine', detune: 1902, mul: 0.4 }];
      attack = 0.008; decayRatio = 1.0; release = 0.02; filterHz = 8000; break;
    case 'strings': case 'ensemble':
      oscs = [{ type: 'sawtooth', detune: -8 }, { type: 'sawtooth', detune: 8 }];
      attack = 0.18; decayRatio = 0.85; release = 0.5; filterHz = 2500; break;
    case 'brass':
      oscs = [{ type: 'sawtooth', detune: 0 }, { type: 'square', detune: 0, mul: 0.35 }];
      attack = 0.04; decayRatio = 0.85; release = 0.12; filterHz = 3800; break;
    case 'reed': case 'pipe':
      oscs = [{ type: 'square', detune: 0 }, { type: 'triangle', detune: 7, mul: 0.5 }];
      attack = 0.02; decayRatio = 0.9; release = 0.1; filterHz = 3500; break;
    case 'synth-pad':
      oscs = [{ type: 'sawtooth', detune: -7 }, { type: 'triangle', detune: 0 }, { type: 'sawtooth', detune: 7, mul: 0.7 }];
      attack = 0.4; decayRatio = 0.7; release = 1.2; filterHz = 1800; break;
    default:
      oscs = [{ type: 'sawtooth', detune: -3 }, { type: 'sine', detune: 0, mul: 0.7 }];
      attack = 0.01; decayRatio = 0.7; release = 0.15; filterHz = 5000;
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = filterHz;
  const env = ctx.createGain();
  const peak = (velocity / oscs.length) * 0.35;
  const sus = peak * decayRatio;
  env.gain.setValueAtTime(0, startSec);
  env.gain.linearRampToValueAtTime(peak, startSec + attack);
  if (decayRatio < 1) env.gain.linearRampToValueAtTime(sus, startSec + attack + 0.06);
  const relStart = Math.max(startSec + attack + 0.06, startSec + durSec);
  env.gain.setValueAtTime(sus, relStart);
  env.gain.exponentialRampToValueAtTime(0.0001, relStart + release);

  oscs.forEach(({ type, detune, mul = 1 }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    if (family === 'organ') {
      osc.frequency.value = freq * Math.pow(2, detune / 1200);
    } else {
      osc.frequency.value = freq;
      osc.detune.value = detune;
    }
    const og = ctx.createGain(); og.gain.value = mul;
    osc.connect(og); og.connect(filter);
    osc.start(startSec); osc.stop(relStart + release + 0.1);
    oscillatorNodes.push(osc);
  });

  filter.connect(env);
  env.connect(oscDryBus!);
  env.connect(oscReverbConv!);
}

// ---------- Unified MidiPlayer ----------

class MidiPlayer {
  private isPlaying = false;
  private startTime = 0;
  private duration = 0;
  private animFrame: number | null = null;
  public sfMode = false;       // true = soundfont was used for last play
  public sfReady = false;      // soundfonts loaded for current composition
  public sfLoading = false;    // currently loading
  public progressCallback: ((progress: number) => void) | null = null;
  public statusCallback: ((msg: string) => void) | null = null;

  private getCtx(): AudioContext {
    const ctx = getSharedCtx();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async preload(composition: CompositionData) {
    if (this.sfReady || this.sfLoading) return;
    this.sfLoading = true;
    this.statusCallback?.('Loading HD audio…');
    const ok = await preloadSoundfonts(composition);
    this.sfLoading = false;
    this.sfReady = ok;
    if (ok) {
      this.statusCallback?.('Ready to play · HD audio ready');
    }
  }

  async play(composition: CompositionData) {
    this.stop();
    const ctx = this.getCtx();
    const bpm = composition.bpm || 120;
    const beatDuration = 60 / bpm;

    if (this.sfReady) {
      await this.playSoundfont(ctx, composition, bpm, beatDuration);
      this.sfMode = true;
    } else {
      this.playOscillator(ctx, composition, bpm, beatDuration);
      this.sfMode = false;
    }
  }

  private async playSoundfont(
    ctx: AudioContext,
    composition: CompositionData,
    bpm: number,
    beatDuration: number
  ) {
    const fallbackPrograms = [0, 48, 25, 33, 73, 56, 40, 19];
    // Load all needed instruments (should already be cached)
    const trackInstruments = composition.tracks.map((t, i) => t.instrument ?? fallbackPrograms[i % 8]);
    const sfPlayers = await Promise.all(trackInstruments.map((p) => loadSfInstrument(gmToName(p))));
    activeSfPlayers = sfPlayers;

    this.startTime = ctx.currentTime + 0.3;
    let maxEnd = this.startTime;

    composition.tracks.forEach((track, ti) => {
      const sfp = sfPlayers[ti];
      let currentBeat = 0;
      track.notes.forEach((note) => {
        let noteBeat: number;
        if (note.beat !== undefined) noteBeat = note.beat - 1;
        else if (note.startTime !== undefined) noteBeat = note.startTime;
        else noteBeat = currentBeat;

        const durBeats = durationToBeats(note.duration);
        const pitches = resolvePitchesForUI(note.pitch, note.chord);
        const gain = ((note.velocity ?? 100) / 127) * 0.75;
        const startSec = this.startTime + noteBeat * beatDuration;
        const durSec = Math.max(durBeats * beatDuration, 0.05);

        pitches.forEach((p) => {
          const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
          sfp.play(String(midi), startSec, { duration: durSec, gain });
          const end = startSec + durSec + 0.5;
          if (end > maxEnd) maxEnd = end;
        });

        if (note.beat === undefined && note.startTime === undefined) currentBeat += durBeats;
      });
    });

    this.duration = maxEnd - this.startTime;
    this.isPlaying = true;
    this.updateProgress();
    setTimeout(() => { if (this.isPlaying) this.stop(); }, (this.duration + 0.5) * 1000);
  }

  private playOscillator(
    ctx: AudioContext,
    composition: CompositionData,
    bpm: number,
    beatDuration: number
  ) {
    oscillatorNodes = [];
    this.startTime = ctx.currentTime + 0.1;
    let maxEnd = this.startTime;
    const fallback = [0, 48, 25, 33, 73, 56, 40, 19];

    composition.tracks.forEach((track, ti) => {
      const instrument = track.instrument ?? fallback[ti % fallback.length];
      let currentBeat = 0;
      track.notes.forEach((note) => {
        let noteBeat: number;
        if (note.beat !== undefined) noteBeat = note.beat - 1;
        else if (note.startTime !== undefined) noteBeat = note.startTime;
        else noteBeat = currentBeat;

        const durBeats = durationToBeats(note.duration);
        const pitches = resolvePitchesForUI(note.pitch, note.chord);
        const velocity = (note.velocity ?? 100) / 127;
        const startSec = this.startTime + noteBeat * beatDuration;
        const durSec = Math.max(durBeats * beatDuration, 0.05);

        pitches.forEach((p) => {
          const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
          scheduleOscNote(ctx, midiToFreq(midi), startSec, durSec, velocity, instrument);
          const end = startSec + durSec + 1.5;
          if (end > maxEnd) maxEnd = end;
        });

        if (note.beat === undefined && note.startTime === undefined) currentBeat += durBeats;
      });
    });

    this.duration = maxEnd - this.startTime;
    this.isPlaying = true;
    this.updateProgress();
    setTimeout(() => { if (this.isPlaying) this.stop(); }, (this.duration + 0.5) * 1000);
  }

  stop() {
    this.isPlaying = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;

    // Stop soundfont players
    activeSfPlayers.forEach((p) => { try { p.stop(); } catch (_e) {} });
    activeSfPlayers = [];

    // Stop oscillators
    oscillatorNodes.forEach((n) => { try { n.stop(); } catch (_e) {} });
    oscillatorNodes = [];

    if (this.progressCallback) this.progressCallback(0);
  }

  destroy() {
    this.stop();
    if (sharedCtx) { sharedCtx.close(); sharedCtx = null; }
    sfCache.clear();
    oscDryBus = null; oscReverbConv = null; oscWetBus = null;
  }

  invalidateSf() {
    this.sfReady = false;
    this.sfMode = false;
  }

  private updateProgress() {
    if (!this.isPlaying || !sharedCtx) return;
    const elapsed = sharedCtx.currentTime - this.startTime;
    const progress = Math.min(elapsed / this.duration, 1);
    if (this.progressCallback) this.progressCallback(progress);
    if (progress < 1) this.animFrame = requestAnimationFrame(() => this.updateProgress());
  }
}

// ---------- Utility Functions ----------

function durationToBeats(dur: string | number): number {
  if (typeof dur === 'number') {
    const m: Record<number, number> = { 0.125: 0.125, 0.25: 0.25, 0.5: 0.5, 1: 1, 2: 2, 4: 4 };
    return m[dur] ?? 1;
  }
  const s = String(dur);
  if (s.startsWith('dd')) return (4 / parseInt(s.slice(2))) * 1.75;
  if (s.startsWith('d'))  return (4 / parseInt(s.slice(1))) * 1.5;
  if (s.startsWith('T'))  return (4 / parseInt(s.slice(1))) * (2 / 3);
  const n = parseInt(s);
  if (!isNaN(n) && n > 0) return 4 / n;
  return 1;
}

function midiToFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

function noteNameToMidi(name: string): number {
  const map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const m = name.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return 60;
  let s = map[m[1].toUpperCase()] || 0;
  if (m[2] === '#') s += 1; else if (m[2] === 'b') s -= 1;
  return (parseInt(m[3]) + 1) * 12 + s;
}

const CHORD_INTERVALS: Record<string, number[]> = {
  '': [0,4,7], maj:[0,4,7], m:[0,3,7], min:[0,3,7], dim:[0,3,6], aug:[0,4,8],
  '7':[0,4,7,10], maj7:[0,4,7,11], M7:[0,4,7,11], m7:[0,3,7,10],
  dim7:[0,3,6,9], m7b5:[0,3,6,10], sus2:[0,2,7], sus4:[0,5,7],
  '6':[0,4,7,9], '9':[0,4,7,10,14], add9:[0,4,7,14], power:[0,7], '5':[0,7],
};

function parseChordForUI(chordName: string): number[] {
  const m = chordName.match(/^([A-Ga-g])([#b]?)(\d)?(.*)$/);
  if (!m) return [60];
  const root = noteNameToMidi(m[1] + (m[2] || '') + (m[3] || '4'));
  return (CHORD_INTERVALS[m[4]] || [0,4,7]).map((i) => root + i);
}

function resolvePitchesForUI(
  pitch: number | string | (number | string)[], chord?: string
): (number | string)[] {
  if (chord) return parseChordForUI(chord);
  if (Array.isArray(pitch)) return pitch;
  return [pitch];
}

// ---------- Browser-Side MIDI Generation ----------

function convertBeatToWait(beat: number, bpm: number): string {
  const PPQ = 128;
  return `T${Math.round(((beat - 1) * PPQ) / bpm)}`;
}

function generateMidiBase64(composition: CompositionData): string {
  const tracks: unknown[] = [];
  const tempo = composition.bpm || 120;
  composition.tracks.forEach((trackData, ti) => {
    // @ts-expect-error - midi-writer-js types incomplete
    const track = new MidiWriter.Track();
    if (trackData.name) track.addTrackName(trackData.name);
    track.setTempo(tempo);
    if (trackData.instrument !== undefined) {
      // @ts-expect-error - midi-writer-js types incomplete
      track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: trackData.instrument, channel: ti % 16 }));
    }
    trackData.notes.forEach((note) => {
      const pitches = resolvePitches(note.pitch, note.chord);
      const duration = normalizeDuration(note.duration);
      const wait = note.beat !== undefined
        ? convertBeatToWait(note.beat, tempo)
        : `T${Math.round((note.startTime ?? 0) * 0.5)}`;
      track.addEvent(
        // @ts-expect-error - midi-writer-js types incomplete
        new MidiWriter.NoteEvent({
          pitch: pitches.length === 1 ? [pitches[0]] : pitches,
          duration, velocity: note.velocity ?? 100, channel: ti % 16, wait,
        })
      );
    });
    tracks.push(track);
  });
  // @ts-expect-error - midi-writer-js types incomplete
  const writer = new MidiWriter.Writer(tracks);
  const data: Uint8Array = writer.buildFile();
  let b = '';
  for (let i = 0; i < data.length; i++) b += String.fromCharCode(data[i]);
  return btoa(b);
}


// ---------- Minimal Markdown Renderer ----------

function escapeHtml(t: string): string {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inlineMd(t: string): string {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n'), html: string[] = [];
  let inTable = false, tableHead = false, inList = false, inPre = false;
  const closeTable = () => { if (inTable) { html.push('</table>'); inTable = false; tableHead = false; } };
  const closeList  = () => { if (inList)  { html.push('</ul>');    inList  = false; } };
  for (const line of lines) {
    if (line.startsWith('```')) {
      closeTable(); closeList();
      inPre ? (html.push('</code></pre>'), inPre = false) : (html.push('<pre><code>'), inPre = true);
      continue;
    }
    if (inPre) { html.push(escapeHtml(line)); continue; }
    if      (line.startsWith('### ')) { closeTable(); closeList(); html.push(`<h4>${inlineMd(line.slice(4))}</h4>`); }
    else if (line.startsWith('## '))  { closeTable(); closeList(); html.push(`<h3>${inlineMd(line.slice(3))}</h3>`); }
    else if (line.startsWith('# '))   { closeTable(); closeList(); html.push(`<h2>${inlineMd(line.slice(2))}</h2>`); }
    else if (line.startsWith('|') && line.endsWith('|')) {
      closeList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^[-:| ]+$/.test(c))) {
        if (inTable && !tableHead) { html[html.length-1] = html[html.length-1].replace(/<td>/g,'<th>').replace(/<\/td>/g,'</th>'); tableHead = true; }
        continue;
      }
      if (!inTable) { html.push('<table>'); inTable = true; }
      html.push('<tr>' + cells.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
    }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      closeTable(); if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inlineMd(line.slice(2))}</li>`);
    }
    else if (/^---+$/.test(line.trim())) { closeTable(); closeList(); html.push('<hr>'); }
    else if (!line.trim()) { closeTable(); closeList(); }
    else { closeTable(); closeList(); html.push(`<p>${inlineMd(line)}</p>`); }
  }
  closeTable(); closeList();
  if (inPre) html.push('</code></pre>');
  return html.join('\n');
}

// ---------- Notation Rendering ----------

function renderNotation(composition: CompositionData, container: HTMLElement) {
  container.innerHTML = '';
  const tracks = composition.tracks || [];
  if (!tracks.length) { container.innerHTML = '<p class="status">No tracks</p>'; return; }

  let minPitch = 127, maxPitch = 0, totalBeats = 0;
  const resolvedTracks = tracks.map((track, ti) => {
    let cb = 0;
    const notes = track.notes.map((note) => {
      let beat = note.beat !== undefined ? note.beat - 1 : note.startTime !== undefined ? note.startTime : cb;
      const durBeats = durationToBeats(note.duration);
      const pitches = resolvePitchesForUI(note.pitch, note.chord);
      pitches.forEach((p) => {
        const m = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
        if (m < minPitch) minPitch = m; if (m > maxPitch) maxPitch = m;
      });
      const end = beat + durBeats;
      if (end > totalBeats) totalBeats = end;
      if (note.beat === undefined && note.startTime === undefined) cb += durBeats;
      return { beat, durBeats, pitches, velocity: note.velocity || 100, trackIndex: ti };
    });
    return { name: track.name || `Track ${ti + 1}`, notes };
  });

  const pitchRange = Math.max(maxPitch - minPitch + 1, 12), pad = 2;
  const effMin = minPitch - pad, effRange = pitchRange + pad * 2;
  const nh = 10, bw = 60, lm = 50, tm = 20;
  const svgW = lm + totalBeats * bw + 40, svgH = tm + effRange * nh + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(svgW)); svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  const isDark = getDocumentTheme() === 'dark';
  const gridColor = isDark ? '#2a2a4a' : '#e9ecef', textColor = isDark ? '#aaa' : '#666';

  for (let b = 0; b <= totalBeats; b++) {
    const x = lm + b * bw;
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1',String(x));ln.setAttribute('y1',String(tm));
    ln.setAttribute('x2',String(x));ln.setAttribute('y2',String(svgH-20));
    ln.setAttribute('stroke',b%4===0?(isDark?'#444':'#adb5bd'):gridColor);
    ln.setAttribute('stroke-width',b%4===0?'1.5':'0.5');
    svg.appendChild(ln);
    if (b % 4 === 0) {
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',String(x));t.setAttribute('y',String(svgH-5));
      t.setAttribute('fill',textColor);t.setAttribute('font-size','9');t.setAttribute('text-anchor','middle');
      t.textContent = String(Math.floor(b/4)+1); svg.appendChild(t);
    }
  }

  for (let p = effMin; p <= effMin + effRange; p++) {
    if (p % 12 === 0) {
      const y = tm + (effMin + effRange - p) * nh;
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',String(lm-5));t.setAttribute('y',String(y+4));
      t.setAttribute('fill',textColor);t.setAttribute('font-size','9');t.setAttribute('text-anchor','end');
      t.textContent = `C${Math.floor(p/12)-1}`; svg.appendChild(t);
      const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1',String(lm));ln.setAttribute('y1',String(y));
      ln.setAttribute('x2',String(svgW-40));ln.setAttribute('y2',String(y));
      ln.setAttribute('stroke',gridColor);ln.setAttribute('stroke-width','0.5');
      svg.appendChild(ln);
    }
  }

  const colors=['#4361ee','#e63946','#06d6a0','#ff9f1c','#9d4edd','#118ab2','#ef476f','#ffd166'];
  resolvedTracks.forEach((track, ti) => {
    const color = colors[ti % colors.length];
    track.notes.forEach((n) => {
      n.pitches.forEach((p) => {
        const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x',String(lm+n.beat*bw));
        rect.setAttribute('y',String(tm+(effMin+effRange-midi)*nh-nh/2));
        rect.setAttribute('width',String(Math.max(n.durBeats*bw-2,4)));
        rect.setAttribute('height',String(nh-1));
        rect.setAttribute('rx','2');rect.setAttribute('fill',color);
        rect.setAttribute('opacity',String(0.4+(n.velocity/127)*0.6));
        svg.appendChild(rect);
      });
    });
  });
  container.appendChild(svg);
}

// ---------- App State ----------

const player = new MidiPlayer();
let currentComposition: CompositionData | null = null;
let currentMidiBase64: string | null = null;

// ---------- DOM ----------

const btnPlay       = document.getElementById('btn-play')       as HTMLButtonElement;
const btnStop       = document.getElementById('btn-stop')       as HTMLButtonElement;
const btnDownload   = document.getElementById('btn-download')   as HTMLButtonElement;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
const btnAskClaude  = document.getElementById('btn-ask-claude') as HTMLButtonElement;
const progressFill  = document.getElementById('progress-fill') as HTMLDivElement;
const notationDiv   = document.getElementById('notation')       as HTMLDivElement;
const trackListDiv  = document.getElementById('track-list')     as HTMLDivElement;
const tempoDisplay  = document.getElementById('tempo-display')  as HTMLSpanElement;
const statusText    = document.getElementById('status-text')    as HTMLDivElement;
const titleEl       = document.getElementById('title')          as HTMLHeadingElement;
const chordInput    = document.getElementById('chord-input')    as HTMLInputElement;
const chordOctave   = document.getElementById('chord-octave')   as HTMLSelectElement;
const btnAnalyze    = document.getElementById('btn-analyze')    as HTMLButtonElement;
const chordResult   = document.getElementById('chord-result')   as HTMLDivElement;
const theorySelect  = document.getElementById('theory-select')  as HTMLSelectElement;
const theoryContent = document.getElementById('theory-content') as HTMLDivElement;

// ---------- Player callbacks ----------

player.progressCallback = (p) => {
  progressFill.style.width = `${p * 100}%`;
  if (p >= 1) { btnPlay.disabled = false; btnStop.disabled = true; }
};
player.statusCallback = (msg) => { statusText.textContent = msg; };

// ---------- Playback controls ----------

btnPlay.addEventListener('click', async () => {
  if (!currentComposition) return;
  btnPlay.disabled = true; btnStop.disabled = false;
  if (!player.sfReady && !player.sfLoading && currentComposition) {
    await player.preload(currentComposition);
  }
  await player.play(currentComposition);
  const mode = player.sfMode ? '🎵 HD' : '🎹 Basic';
  statusText.textContent = `Playing… ${mode}`;
  app.sendLog({ level: 'info', data: `Play (${player.sfMode ? 'soundfont' : 'oscillator'}): ${titleEl.textContent}`, logger: 'midi-preview' });
});

btnStop.addEventListener('click', () => {
  player.stop();
  btnPlay.disabled = false; btnStop.disabled = true;
  progressFill.style.width = '0%';
  statusText.textContent = 'Ready to play';
  app.sendLog({ level: 'info', data: 'Stopped', logger: 'midi-preview' });
});

// ---------- Download ----------

btnDownload.addEventListener('click', async () => {
  if (!currentMidiBase64) return;
  const title = (titleEl.textContent || 'midi').replace(/[^a-zA-Z0-9_\- ]/g, '_');
  const filename = `${title}.mid`;
  await app.downloadFile({
    contents: [{
      type: 'resource',
      resource: {
        uri: `file:///${filename}`,
        mimeType: 'audio/midi',
        blob: currentMidiBase64,
      },
    }],
  });
  app.sendLog({ level: 'info', data: `Downloaded: ${filename}`, logger: 'midi-preview' });
});

// ---------- Fullscreen ----------

function updateFsBtn(mode: string) {
  btnFullscreen.textContent = mode === 'fullscreen' ? '⊡' : '⛶';
  btnFullscreen.title = mode === 'fullscreen' ? 'Exit fullscreen' : 'Enter fullscreen';
}

btnFullscreen.addEventListener('click', async () => {
  const ctx2 = app.getHostContext();
  const avail = (ctx2?.availableDisplayModes ?? []) as string[];
  const cur = ctx2?.displayMode ?? 'inline';
  const next = cur === 'fullscreen' ? 'inline' : 'fullscreen';
  if (!avail.includes(next)) return;
  try {
    await app.requestDisplayMode({ mode: next as 'inline' | 'fullscreen' | 'pip' });
    updateFsBtn(next);
  } catch (_e) {}
});

// ---------- Continue (sendMessage) ----------

btnAskClaude.addEventListener('click', async () => {
  if (!currentComposition) return;
  const title = titleEl.textContent || 'this piece';
  const bpm = currentComposition.bpm;
  const tracks = currentComposition.tracks.map((t) => t.name || 'unnamed').join(', ');
  try {
    await app.sendMessage({
      role: 'user',
      content: [{ type: 'text', text: `Please continue "${title}" by adding 8 more bars. Keep the same key, tempo (${bpm} BPM), and style. Tracks: ${tracks}.` }],
    });
    app.sendLog({ level: 'info', data: `Continue request sent for: ${title}`, logger: 'midi-preview' });
  } catch (e) {
    app.sendLog({ level: 'warning', data: `sendMessage failed: ${(e as Error).message}`, logger: 'midi-preview' });
  }
});

// ---------- Chord Analyzer ----------

async function analyzeChord() {
  const chord = chordInput.value.trim();
  if (!chord) return;
  const octave = parseInt(chordOctave.value, 10);
  chordResult.innerHTML = '<span style="opacity:0.6">Analyzing…</span>';
  btnAnalyze.disabled = true;
  try {
    const result = await app.callServerTool({ name: 'parse_chord', arguments: { chord, octave } });
    if (result.isError) {
      chordResult.innerHTML = `<span class="chord-error">${escapeHtml((result.content[0] as {text:string}).text)}</span>`;
      return;
    }
    const data = JSON.parse((result.content[0] as {text:string}).text) as {
      chord: string; octave: number; midiNumbers: number[]; noteNames: string[];
    };
    chordResult.innerHTML = `
      <div class="chord-name">${escapeHtml(data.chord)}</div>
      <div class="chord-notes">Notes: <strong>${data.noteNames.join(' – ')}</strong></div>
      <div class="chord-midi">MIDI: ${data.midiNumbers.join(', ')}</div>
    `;
    app.sendLog({ level: 'info', data: `Chord ${chord} → ${data.noteNames.join(', ')}`, logger: 'midi-preview' });
  } catch (e) {
    chordResult.innerHTML = `<span class="chord-error">${escapeHtml((e as Error).message)}</span>`;
  } finally { btnAnalyze.disabled = false; }
}

btnAnalyze.addEventListener('click', analyzeChord);
chordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeChord(); });

// ---------- Theory Reference ----------

const THEORY_RESOURCE_LIST = [
  { uri: 'music-theory://harmony',            name: 'Harmony & Music Theory' },
  { uri: 'music-theory://chord-progressions', name: 'Chord Progressions' },
  { uri: 'music-theory://counterpoint',       name: 'Counterpoint' },
  { uri: 'music-theory://modes-scales',       name: 'Modes & Scales' },
  { uri: 'music-theory://orchestration',      name: 'Orchestration' },
  { uri: 'music-theory://rhythm-patterns',    name: 'Rhythm Patterns' },
  { uri: 'music-theory://voice-leading',      name: 'Voice Leading' },
] as const;

function populateTheoryDropdown() {
  theorySelect.innerHTML = '<option value="">— Select a reference —</option>';
  THEORY_RESOURCE_LIST.forEach((r) => {
    const opt = Object.assign(document.createElement('option'), { value: r.uri, textContent: r.name });
    theorySelect.appendChild(opt);
  });
}

theorySelect.addEventListener('change', async () => {
  const uri = theorySelect.value;
  if (!uri) { theoryContent.innerHTML = ''; return; }
  theoryContent.innerHTML = '<p style="opacity:0.6">Loading…</p>';
  try {
    const result = await app.readServerResource({ uri });
    theoryContent.innerHTML = renderMarkdown(result.contents[0]?.text ?? '');
    app.sendLog({ level: 'info', data: `Theory loaded: ${uri}`, logger: 'midi-preview' });
  } catch (e) {
    theoryContent.innerHTML = `<p class="error">Failed: ${escapeHtml((e as Error).message)}</p>`;
  }
});

// ---------- Load Composition ----------

function loadComposition(input: ToolInput, opts: { generateMidi?: boolean } = {}) {
  try {
    const composition = input.composition;
    currentComposition = composition;
    player.invalidateSf(); // New composition → reload soundfonts

    if (input.title) titleEl.textContent = input.title;
    renderNotation(composition, notationDiv);

    trackListDiv.innerHTML = '';
    (composition.tracks || []).forEach((track, i) => {
      const div = document.createElement('div');
      div.className = 'track-info';
      const name = track.name || `Track ${i + 1}`;
      const inst = track.instrument !== undefined ? ` (GM: ${track.instrument})` : '';
      const n = track.notes?.length ?? 0;
      div.innerHTML = `<span class="track-name">${escapeHtml(name)}</span><span class="track-detail">${escapeHtml(inst)} - ${n} notes</span>`;
      trackListDiv.appendChild(div);
    });

    tempoDisplay.textContent = `${composition.bpm || 120} BPM`;
    btnPlay.disabled = false;
    btnAskClaude.disabled = false;

    if (opts.generateMidi) {
      try {
        currentMidiBase64 = generateMidiBase64(composition);
        btnDownload.disabled = false;
        statusText.textContent = 'Ready to play';
      } catch (_e) {
        statusText.textContent = 'Ready to play';
      }
      // Kick off soundfont preload in the background
      player.preload(composition).catch(() => {});
    } else {
      statusText.textContent = 'Loading…';
    }

    app.sendLog({
      level: 'info',
      data: { event: 'loaded', title: input.title, bpm: composition.bpm, tracks: composition.tracks.length },
      logger: 'midi-preview',
    });
  } catch (e) {
    notationDiv.innerHTML = `<p class="error">Error: ${escapeHtml((e as Error).message)}</p>`;
  }
}

// ---------- MCP App ----------

const app = new App({ name: 'midi-preview', version: '0.3.0' }, {});

app.ontoolinputpartial = (params) => {
  try {
    const args = params.arguments as unknown as ToolInput;
    if (args?.composition?.tracks) loadComposition(args);
  } catch (_e) {}
};

app.ontoolinput = (params) => {
  loadComposition(params.arguments as unknown as ToolInput, { generateMidi: true });
};

app.ontoolresult = (params) => {
  if (params.isError || currentMidiBase64) return;

  // structuredContent から取得（LLMにトークンを消費させない）
  const sc = params.structuredContent;
  if (sc?.midiBase64 && typeof sc.midiBase64 === 'string') {
    currentMidiBase64 = sc.midiBase64;
    btnDownload.disabled = false;
    return;
  }

  // フォールバック：structuredContent 非対応の旧ホスト向け
  const rb = params.content?.find((c) => c.type === 'resource');
  if (rb?.type === 'resource') {
    const text = (rb as { type: 'resource'; resource: { text?: string } }).resource.text;
    if (text) { currentMidiBase64 = text; btnDownload.disabled = false; }
  }
};

app.ontoolcancelled = (_p) => {
  player.stop();
  currentMidiBase64 = null;
  btnPlay.disabled = true; btnStop.disabled = true;
  btnDownload.disabled = true; btnAskClaude.disabled = true;
  progressFill.style.width = '0%';
  statusText.textContent = 'Cancelled';
};

app.onteardown = (_p, _e) => {
  app.sendLog({ level: 'info', data: 'Teardown', logger: 'midi-preview' });
  player.destroy();
  return {};
};

app.onhostcontextchanged = (params) => {
  if (params.context) {
    applyHostStyleVariables(params.context);
    applyDocumentTheme(params.context);
    applyHostFonts(params.context);
    if (params.context.displayMode) updateFsBtn(params.context.displayMode);
    if (currentComposition) renderNotation(currentComposition, notationDiv);
  }
};

app
  .connect()
  .then(() => {
    const ctx2 = app.getHostContext();
    if (ctx2) {
      applyHostStyleVariables(ctx2);
      applyDocumentTheme(ctx2);
      applyHostFonts(ctx2);
      if (ctx2.displayMode) updateFsBtn(ctx2.displayMode);
    }
    populateTheoryDropdown();
  })
  .catch(() => {
    statusText.textContent = 'Standalone mode — waiting for data…';
    populateTheoryDropdown();
  });
