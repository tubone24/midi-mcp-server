/**
 * Client-side MCP App for MIDI preview and playback.
 * Uses the @modelcontextprotocol/ext-apps App class for host communication.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import {
  applyHostStyleVariables,
  applyDocumentTheme,
  applyHostFonts,
  getDocumentTheme,
} from '@modelcontextprotocol/ext-apps';

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

// ---------- Audio Playback ----------

class MidiPlayer {
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private scheduledNodes: OscillatorNode[] = [];
  private startTime = 0;
  private duration = 0;
  private animFrame: number | null = null;
  public progressCallback: ((progress: number) => void) | null = null;

  init() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  playComposition(composition: CompositionData) {
    this.stop();
    this.init();
    const ctx = this.audioContext!;
    const bpm = composition.bpm || 120;
    const beatDuration = 60 / bpm;
    this.startTime = ctx.currentTime + 0.1;
    let maxEndTime = 0;

    composition.tracks.forEach((track, trackIndex) => {
      let currentBeat = 0;

      track.notes.forEach((note) => {
        let noteBeat: number;
        if (note.beat !== undefined) {
          noteBeat = note.beat - 1;
        } else if (note.startTime !== undefined) {
          noteBeat = note.startTime;
        } else {
          noteBeat = currentBeat;
        }

        const durBeats = durationToBeats(note.duration);
        const pitches = resolvePitchesForUI(note.pitch, note.chord);
        const velocity = (note.velocity || 100) / 127;

        pitches.forEach((p) => {
          const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
          const freq = midiToFreq(midi);
          const startSec = this.startTime + noteBeat * beatDuration;
          const durSec = durBeats * beatDuration;

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          const waveforms: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];
          osc.type = waveforms[trackIndex % waveforms.length];
          osc.frequency.setValueAtTime(freq, startSec);

          gain.gain.setValueAtTime(0, startSec);
          gain.gain.linearRampToValueAtTime(velocity * 0.3, startSec + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, startSec + durSec);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startSec);
          osc.stop(startSec + durSec + 0.05);

          this.scheduledNodes.push(osc);
          const endTime = startSec + durSec;
          if (endTime > maxEndTime) maxEndTime = endTime;
        });

        if (note.beat === undefined && note.startTime === undefined) {
          currentBeat += durBeats;
        }
      });
    });

    this.duration = maxEndTime - this.startTime;
    this.isPlaying = true;
    this.updateProgress();

    setTimeout(
      () => {
        if (this.isPlaying) this.stop();
      },
      (this.duration + 0.5) * 1000
    );
  }

  stop() {
    this.isPlaying = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.scheduledNodes.forEach((node) => {
      try {
        node.stop();
      } catch (_e) {
        /* already stopped */
      }
    });
    this.scheduledNodes = [];
    if (this.progressCallback) this.progressCallback(0);
  }

  /** Close AudioContext on app teardown. */
  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private updateProgress() {
    if (!this.isPlaying || !this.audioContext) return;
    const elapsed = this.audioContext.currentTime - this.startTime;
    const progress = Math.min(elapsed / this.duration, 1);
    if (this.progressCallback) this.progressCallback(progress);
    if (progress < 1) {
      this.animFrame = requestAnimationFrame(() => this.updateProgress());
    }
  }
}

// ---------- Utility Functions ----------

function durationToBeats(dur: string | number): number {
  if (typeof dur === 'number') {
    const map: Record<number, number> = { 0.125: 0.125, 0.25: 0.25, 0.5: 0.5, 1: 1, 2: 2, 4: 4 };
    return map[dur] ?? 1;
  }
  const s = String(dur);
  if (s.startsWith('dd')) return (4 / parseInt(s.slice(2))) * 1.75;
  if (s.startsWith('d')) return (4 / parseInt(s.slice(1))) * 1.5;
  if (s.startsWith('T')) return (4 / parseInt(s.slice(1))) * (2 / 3);
  const n = parseInt(s);
  if (!isNaN(n) && n > 0) return 4 / n;
  return 1;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteNameToMidi(name: string): number {
  const map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const m = name.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return 60;
  let semi = map[m[1].toUpperCase()] || 0;
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  return (parseInt(m[3]) + 1) * 12 + semi;
}

const CHORD_INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  '9': [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14],
  power: [0, 7],
  '5': [0, 7],
};

function parseChordForUI(chordName: string): number[] {
  const m = chordName.match(/^([A-Ga-g])([#b]?)(\d)?(.*)$/);
  if (!m) return [60];
  const root = noteNameToMidi(m[1] + (m[2] || '') + (m[3] || '4'));
  const intervals = CHORD_INTERVALS[m[4]] || [0, 4, 7];
  return intervals.map((i) => root + i);
}

function resolvePitchesForUI(
  pitch: number | string | (number | string)[],
  chord?: string
): (number | string)[] {
  if (chord) return parseChordForUI(chord);
  if (Array.isArray(pitch)) return pitch;
  return [pitch];
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ---------- Minimal Markdown Renderer ----------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inTable = false;
  let tableHasHeader = false;
  let inList = false;
  let inPre = false;

  const closeTable = () => { if (inTable) { html.push('</table>'); inTable = false; tableHasHeader = false; } };
  const closeList = () => { if (inList) { html.push('</ul>'); inList = false; } };

  for (const line of lines) {
    // Code fence toggle
    if (line.startsWith('```')) {
      closeTable(); closeList();
      if (inPre) { html.push('</code></pre>'); inPre = false; }
      else { html.push('<pre><code>'); inPre = true; }
      continue;
    }
    if (inPre) { html.push(escapeHtml(line)); continue; }

    // Headings
    if (line.startsWith('### ')) {
      closeTable(); closeList();
      html.push(`<h4>${inlineMarkdown(line.slice(4))}</h4>`);
    } else if (line.startsWith('## ')) {
      closeTable(); closeList();
      html.push(`<h3>${inlineMarkdown(line.slice(3))}</h3>`);
    } else if (line.startsWith('# ')) {
      closeTable(); closeList();
      html.push(`<h2>${inlineMarkdown(line.slice(2))}</h2>`);
    // Table rows
    } else if (line.startsWith('|') && line.endsWith('|')) {
      closeList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      // Separator row (|---|---|): marks previous row as header
      if (cells.every((c) => /^[-:| ]+$/.test(c))) {
        // Wrap previously added row cells in <th>
        if (inTable && !tableHasHeader) {
          const last = html[html.length - 1];
          html[html.length - 1] = last.replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
          tableHasHeader = true;
        }
        continue;
      }
      if (!inTable) { html.push('<table>'); inTable = true; }
      html.push('<tr>' + cells.map((c) => `<td>${inlineMarkdown(c)}</td>`).join('') + '</tr>');
    // List items
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      closeTable();
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
    // Horizontal rule
    } else if (/^---+$/.test(line.trim())) {
      closeTable(); closeList();
      html.push('<hr>');
    // Empty line
    } else if (line.trim() === '') {
      closeTable(); closeList();
    // Paragraph
    } else {
      closeTable(); closeList();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  closeTable(); closeList();
  if (inPre) html.push('</code></pre>');
  return html.join('\n');
}

// ---------- Notation Rendering (Piano Roll) ----------

function renderNotation(composition: CompositionData, container: HTMLElement) {
  container.innerHTML = '';
  const tracks = composition.tracks || [];
  if (tracks.length === 0) {
    container.innerHTML = '<p class="status">No tracks</p>';
    return;
  }

  let minPitch = 127,
    maxPitch = 0,
    totalBeats = 0;

  const resolvedTracks = tracks.map((track, ti) => {
    let currentBeat = 0;
    const notes = track.notes.map((note) => {
      let beat: number;
      if (note.beat !== undefined) beat = note.beat - 1;
      else if (note.startTime !== undefined) beat = note.startTime;
      else beat = currentBeat;

      const durBeats = durationToBeats(note.duration);
      const pitches = resolvePitchesForUI(note.pitch, note.chord);

      pitches.forEach((p) => {
        const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
        if (midi < minPitch) minPitch = midi;
        if (midi > maxPitch) maxPitch = midi;
      });

      const endBeat = beat + durBeats;
      if (endBeat > totalBeats) totalBeats = endBeat;

      if (note.beat === undefined && note.startTime === undefined) {
        currentBeat += durBeats;
      }

      return { beat, durBeats, pitches, velocity: note.velocity || 100, trackIndex: ti };
    });
    return { name: track.name || `Track ${ti + 1}`, instrument: track.instrument, notes };
  });

  const pitchRange = Math.max(maxPitch - minPitch + 1, 12);
  const pad = 2;
  const effMin = minPitch - pad;
  const effRange = pitchRange + pad * 2;
  const nh = 10,
    bw = 60,
    lm = 50,
    tm = 20;

  const svgW = lm + totalBeats * bw + 40;
  const svgH = tm + effRange * nh + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  const theme = getDocumentTheme();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#2a2a4a' : '#e9ecef';
  const textColor = isDark ? '#aaa' : '#666';

  for (let b = 0; b <= totalBeats; b++) {
    const x = lm + b * bw;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('y1', String(tm));
    line.setAttribute('x2', String(x));
    line.setAttribute('y2', String(svgH - 20));
    line.setAttribute('stroke', b % 4 === 0 ? (isDark ? '#444' : '#adb5bd') : gridColor);
    line.setAttribute('stroke-width', b % 4 === 0 ? '1.5' : '0.5');
    svg.appendChild(line);

    if (b % 4 === 0) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(x));
      txt.setAttribute('y', String(svgH - 5));
      txt.setAttribute('fill', textColor);
      txt.setAttribute('font-size', '9');
      txt.setAttribute('text-anchor', 'middle');
      txt.textContent = String(Math.floor(b / 4) + 1);
      svg.appendChild(txt);
    }
  }

  for (let p = effMin; p <= effMin + effRange; p++) {
    if (p % 12 === 0) {
      const y = tm + (effMin + effRange - p) * nh;
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(lm - 5));
      txt.setAttribute('y', String(y + 4));
      txt.setAttribute('fill', textColor);
      txt.setAttribute('font-size', '9');
      txt.setAttribute('text-anchor', 'end');
      txt.textContent = `C${Math.floor(p / 12) - 1}`;
      svg.appendChild(txt);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(lm));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(svgW - 40));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', gridColor);
      line.setAttribute('stroke-width', '0.5');
      svg.appendChild(line);
    }
  }

  const colors = [
    '#4361ee',
    '#e63946',
    '#06d6a0',
    '#ff9f1c',
    '#9d4edd',
    '#118ab2',
    '#ef476f',
    '#ffd166',
  ];

  resolvedTracks.forEach((track, ti) => {
    const color = colors[ti % colors.length];
    track.notes.forEach((n) => {
      n.pitches.forEach((p) => {
        const midi = typeof p === 'string' ? noteNameToMidi(p) : (p as number);
        const x = lm + n.beat * bw;
        const w = Math.max(n.durBeats * bw - 2, 4);
        const y = tm + (effMin + effRange - midi) * nh - nh / 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(nh - 1));
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', color);
        rect.setAttribute('opacity', String(0.4 + (n.velocity / 127) * 0.6));
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

// ---------- DOM References ----------

const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
const btnAskClaude = document.getElementById('btn-ask-claude') as HTMLButtonElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const notationDiv = document.getElementById('notation') as HTMLDivElement;
const trackListDiv = document.getElementById('track-list') as HTMLDivElement;
const tempoDisplay = document.getElementById('tempo-display') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLDivElement;
const titleEl = document.getElementById('title') as HTMLHeadingElement;

// Chord analyzer
const chordInput = document.getElementById('chord-input') as HTMLInputElement;
const chordOctave = document.getElementById('chord-octave') as HTMLSelectElement;
const btnAnalyze = document.getElementById('btn-analyze') as HTMLButtonElement;
const chordResult = document.getElementById('chord-result') as HTMLDivElement;

// Theory panel
const theorySelect = document.getElementById('theory-select') as HTMLSelectElement;
const theoryContent = document.getElementById('theory-content') as HTMLDivElement;

// ---------- Playback Controls ----------

player.progressCallback = (p) => {
  progressFill.style.width = `${p * 100}%`;
  if (p >= 1) {
    btnPlay.disabled = false;
    btnStop.disabled = true;
  }
};

btnPlay.addEventListener('click', () => {
  if (!currentComposition) return;
  player.playComposition(currentComposition);
  btnPlay.disabled = true;
  btnStop.disabled = false;
  app.sendLog({ level: 'info', data: `Playback started: ${titleEl.textContent}`, logger: 'midi-preview' });
});

btnStop.addEventListener('click', () => {
  player.stop();
  btnPlay.disabled = false;
  btnStop.disabled = true;
  progressFill.style.width = '0%';
  app.sendLog({ level: 'info', data: 'Playback stopped', logger: 'midi-preview' });
});

// ---------- Download MIDI ----------

btnDownload.addEventListener('click', () => {
  if (!currentMidiBase64) return;
  const title = titleEl.textContent || 'midi';
  const blob = base64ToBlob(currentMidiBase64, 'audio/midi');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '_')}.mid`;
  a.click();
  URL.revokeObjectURL(url);
  app.sendLog({ level: 'info', data: `MIDI downloaded: ${title}.mid`, logger: 'midi-preview' });
});

// ---------- Display Mode Toggle ----------

function updateDisplayModeButton(mode: string) {
  btnFullscreen.textContent = mode === 'fullscreen' ? '⊡' : '⛶';
  btnFullscreen.title = mode === 'fullscreen' ? 'Exit fullscreen' : 'Enter fullscreen';
}

btnFullscreen.addEventListener('click', async () => {
  const context = app.getHostContext();
  const available = (context?.availableDisplayModes ?? []) as string[];
  const current = context?.displayMode ?? 'inline';
  const next = current === 'fullscreen' ? 'inline' : 'fullscreen';
  if (!available.includes(next)) {
    app.sendLog({ level: 'notice', data: `Display mode "${next}" not available`, logger: 'midi-preview' });
    return;
  }
  try {
    await app.requestDisplayMode({ mode: next as 'inline' | 'fullscreen' | 'pip' });
    updateDisplayModeButton(next);
    app.sendLog({ level: 'info', data: `Display mode changed to: ${next}`, logger: 'midi-preview' });
  } catch (e) {
    app.sendLog({ level: 'warning', data: `requestDisplayMode failed: ${(e as Error).message}`, logger: 'midi-preview' });
  }
});

// ---------- Ask Claude to Extend ----------

btnAskClaude.addEventListener('click', async () => {
  if (!currentComposition) return;
  const title = titleEl.textContent || 'this piece';
  const bpm = currentComposition.bpm;
  const trackNames = currentComposition.tracks.map((t) => t.name || 'unnamed').join(', ');
  try {
    await app.sendMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Please continue "${title}" by adding 8 more bars. Keep the same key, tempo (${bpm} BPM), and style. Tracks: ${trackNames}.`,
        },
      ],
    });
    app.sendLog({ level: 'info', data: `Sent extend request to Claude for: ${title}`, logger: 'midi-preview' });
  } catch (e) {
    app.sendLog({ level: 'warning', data: `sendMessage not supported: ${(e as Error).message}`, logger: 'midi-preview' });
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
    app.sendLog({ level: 'debug', data: `Analyzing chord: ${chord} oct${octave}`, logger: 'midi-preview' });
    const result = await app.callServerTool({ name: 'parse_chord', arguments: { chord, octave } });

    if (result.isError) {
      const msg = (result.content[0] as { type: string; text: string }).text;
      chordResult.innerHTML = `<span class="chord-error">${escapeHtml(msg)}</span>`;
      return;
    }

    const data = JSON.parse((result.content[0] as { type: string; text: string }).text) as {
      chord: string;
      octave: number;
      midiNumbers: number[];
      noteNames: string[];
    };

    chordResult.innerHTML = `
      <div class="chord-name">${escapeHtml(data.chord)}</div>
      <div class="chord-notes">Notes: <strong>${data.noteNames.join(' – ')}</strong></div>
      <div class="chord-midi">MIDI: ${data.midiNumbers.join(', ')}</div>
    `;
    app.sendLog({ level: 'info', data: `Chord: ${chord} → ${data.noteNames.join(', ')}`, logger: 'midi-preview' });
  } catch (e) {
    chordResult.innerHTML = `<span class="chord-error">${escapeHtml((e as Error).message)}</span>`;
  } finally {
    btnAnalyze.disabled = false;
  }
}

btnAnalyze.addEventListener('click', analyzeChord);
chordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeChord(); });

// ---------- Music Theory Reference ----------

async function loadTheoryResources() {
  try {
    const result = await app.listServerResources();
    const theoryResources = result.resources.filter((r) => r.uri.startsWith('music-theory://'));

    if (theoryResources.length === 0) return;

    theorySelect.innerHTML = '<option value="">— Select a reference —</option>';
    theoryResources.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.uri;
      opt.textContent = r.name;
      theorySelect.appendChild(opt);
    });

    app.sendLog({ level: 'info', data: `Loaded ${theoryResources.length} theory resources`, logger: 'midi-preview' });
  } catch (e) {
    app.sendLog({ level: 'warning', data: `listServerResources failed: ${(e as Error).message}`, logger: 'midi-preview' });
  }
}

theorySelect.addEventListener('change', async () => {
  const uri = theorySelect.value;
  if (!uri) { theoryContent.innerHTML = ''; return; }

  theoryContent.innerHTML = '<p style="opacity:0.6">Loading…</p>';

  try {
    app.sendLog({ level: 'debug', data: `Loading theory resource: ${uri}`, logger: 'midi-preview' });
    const result = await app.readServerResource({ uri });
    const text = result.contents[0]?.text ?? '';
    theoryContent.innerHTML = renderMarkdown(text);
    app.sendLog({ level: 'info', data: `Theory resource displayed: ${uri}`, logger: 'midi-preview' });
  } catch (e) {
    theoryContent.innerHTML = `<p class="error">Failed to load: ${escapeHtml((e as Error).message)}</p>`;
  }
});

// ---------- Load Composition ----------

function loadComposition(input: ToolInput) {
  try {
    const composition = input.composition;
    currentComposition = composition;

    if (input.title) {
      titleEl.textContent = input.title;
    }

    renderNotation(composition, notationDiv);

    trackListDiv.innerHTML = '';
    (composition.tracks || []).forEach((track, i) => {
      const div = document.createElement('div');
      div.className = 'track-info';
      const name = track.name || `Track ${i + 1}`;
      const inst = track.instrument !== undefined ? ` (GM: ${track.instrument})` : '';
      const noteCount = track.notes ? track.notes.length : 0;
      div.innerHTML = `<span class="track-name">${escapeHtml(name)}</span><span class="track-detail">${escapeHtml(inst)} - ${noteCount} notes</span>`;
      trackListDiv.appendChild(div);
    });

    tempoDisplay.textContent = `${composition.bpm || 120} BPM`;
    btnPlay.disabled = false;
    btnAskClaude.disabled = false;
    statusText.textContent = 'Ready to play';

    app.sendLog({
      level: 'info',
      data: { event: 'composition-loaded', title: input.title, bpm: composition.bpm, tracks: composition.tracks.length },
      logger: 'midi-preview',
    });
  } catch (e) {
    notationDiv.innerHTML = `<p class="error">Error: ${escapeHtml((e as Error).message)}</p>`;
  }
}

// ---------- Connect to MCP Host ----------

const app = new App({ name: 'midi-preview', version: '0.2.0' }, {});

// Tool input → render piano roll (may fire before result)
app.ontoolinput = (params) => {
  const args = params.arguments as unknown as ToolInput;
  loadComposition(args);
};

// Partial streaming → progressive rendering
app.ontoolinputpartial = (params) => {
  try {
    const args = params.arguments as unknown as ToolInput;
    if (args?.composition?.tracks) {
      loadComposition(args);
    }
  } catch (_e) {
    // Partial data may not be valid yet
  }
};

// Tool result → enable MIDI download
app.ontoolresult = (params) => {
  if (params.isError) return;
  const resourceBlock = params.content?.find((c) => c.type === 'resource');
  if (resourceBlock && resourceBlock.type === 'resource') {
    const res = (resourceBlock as { type: 'resource'; resource: { text?: string; uri?: string } }).resource;
    if (res.text) {
      currentMidiBase64 = res.text;
      btnDownload.disabled = false;
      statusText.textContent = 'Ready to play · MIDI ready for download';
      app.sendLog({ level: 'info', data: 'MIDI base64 received, download enabled', logger: 'midi-preview' });
    }
  }
};

// Tool cancelled → reset UI
app.ontoolcancelled = (_params) => {
  player.stop();
  currentMidiBase64 = null;
  btnPlay.disabled = true;
  btnStop.disabled = true;
  btnDownload.disabled = true;
  btnAskClaude.disabled = true;
  progressFill.style.width = '0%';
  statusText.textContent = 'Cancelled';
  app.sendLog({ level: 'info', data: 'Tool cancelled', logger: 'midi-preview' });
};

// Teardown → cleanup AudioContext
app.onteardown = (_params, _extra) => {
  app.sendLog({ level: 'info', data: 'App teardown — closing AudioContext', logger: 'midi-preview' });
  player.destroy();
  return {};
};

// Host context changed → re-apply styles and theme
app.onhostcontextchanged = (params) => {
  if (params.context) {
    applyHostStyleVariables(params.context);
    applyDocumentTheme(params.context);
    applyHostFonts(params.context);

    const mode = params.context.displayMode;
    if (mode) updateDisplayModeButton(mode);

    if (currentComposition) {
      renderNotation(currentComposition, notationDiv);
    }
  }
};

app
  .connect()
  .then(() => {
    const context = app.getHostContext();
    if (context) {
      applyHostStyleVariables(context);
      applyDocumentTheme(context);
      applyHostFonts(context);

      const mode = context.displayMode;
      if (mode) updateDisplayModeButton(mode);
    }
    // Populate theory resources from server
    loadTheoryResources();
  })
  .catch((err) => {
    console.error('Failed to connect to MCP host:', err);
    statusText.textContent = 'Standalone mode — waiting for data…';
  });
