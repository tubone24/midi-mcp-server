/**
 * Returns the self-contained HTML for the MIDI preview/playback UI.
 * This HTML is served as an MCP resource and rendered by the MCP host.
 * Libraries (VexFlow, Tone.js) are loaded from CDN.
 */
export function getMcpAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MIDI Preview</title>
<style>
  :root {
    --bg: #ffffff;
    --text: #1a1a2e;
    --surface: #f8f9fa;
    --border: #dee2e6;
    --primary: #4361ee;
    --primary-hover: #3a56d4;
    --accent: #7209b7;
    --success: #06d6a0;
    --error: #ef476f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a2e;
      --text: #e8e8e8;
      --surface: #16213e;
      --border: #0f3460;
      --primary: #4361ee;
      --primary-hover: #5a7bff;
      --accent: #9d4edd;
      --success: #06d6a0;
      --error: #ef476f;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 16px;
    max-width: 900px;
    margin: 0 auto;
  }
  h2 {
    font-size: 1.2rem;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  button {
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.2s;
  }
  button:hover { background: var(--primary-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.stop { background: var(--error); }
  .tempo-display {
    font-size: 0.85rem;
    color: var(--text);
    opacity: 0.7;
    margin-left: auto;
  }
  #notation {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    min-height: 200px;
    overflow-x: auto;
    margin-bottom: 16px;
  }
  #notation svg { max-width: 100%; }
  .track-info {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }
  .track-info .track-name { font-weight: 600; }
  .track-info .track-detail { opacity: 0.7; margin-left: 8px; }
  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .progress-bar .fill {
    height: 100%;
    background: var(--primary);
    border-radius: 2px;
    transition: width 0.1s linear;
    width: 0%;
  }
  .status {
    font-size: 0.8rem;
    opacity: 0.6;
    text-align: center;
    margin-top: 8px;
  }
  .error { color: var(--error); font-weight: 600; }
  #download-link {
    display: inline-block;
    margin-top: 8px;
    color: var(--primary);
    text-decoration: none;
    font-size: 0.85rem;
  }
  #download-link:hover { text-decoration: underline; }
</style>
</head>
<body>
<h2>MIDI Preview</h2>

<div class="controls">
  <button id="btn-play" disabled>Play</button>
  <button id="btn-stop" class="stop" disabled>Stop</button>
  <span class="tempo-display" id="tempo-display"></span>
</div>

<div class="progress-bar"><div class="fill" id="progress-fill"></div></div>

<div id="notation"><p class="status">Waiting for MIDI data...</p></div>

<div id="track-list"></div>

<a id="download-link" style="display:none" download="composition.mid">Download MIDI</a>

<div class="status" id="status-text"></div>

<script type="module">
// --- Simple MIDI Parser (for playback from base64) ---
function parseMidiBase64(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return bytes;
}

// --- Audio Playback using Web Audio API ---
class MidiPlayer {
  constructor() {
    this.audioContext = null;
    this.isPlaying = false;
    this.scheduledNodes = [];
    this.startTime = 0;
    this.duration = 0;
    this.progressCallback = null;
    this.animFrame = null;
  }

  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * Play composition data directly using Web Audio synthesis.
   */
  playComposition(composition) {
    this.stop();
    this.init();

    const ctx = this.audioContext;
    const bpm = composition.bpm || 120;
    const beatDuration = 60 / bpm; // seconds per beat
    this.startTime = ctx.currentTime + 0.1;
    let maxEndTime = 0;

    composition.tracks.forEach((track, trackIndex) => {
      let currentBeat = 0; // running beat position for sequential notes

      track.notes.forEach(note => {
        // Determine beat position
        let noteBeat;
        if (note.beat !== undefined) {
          noteBeat = note.beat - 1; // convert 1-indexed to 0-indexed
        } else if (note.startTime !== undefined) {
          noteBeat = note.startTime;
        } else {
          noteBeat = currentBeat;
        }

        // Calculate duration in beats
        const durBeats = durationToBeats(note.duration);

        // Resolve pitches
        const pitches = resolvePitchesForUI(note.pitch, note.chord);
        const velocity = (note.velocity || 100) / 127;

        pitches.forEach(p => {
          const freq = midiToFreq(typeof p === 'string' ? noteNameToMidi(p) : p);
          const startSec = this.startTime + noteBeat * beatDuration;
          const durSec = durBeats * beatDuration;

          // Create oscillator + gain for each note
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          // Use different waveforms per track for variety
          const waveforms = ['sine', 'triangle', 'square', 'sawtooth'];
          osc.type = waveforms[trackIndex % waveforms.length];
          osc.frequency.setValueAtTime(freq, startSec);

          // ADSR-like envelope
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

        // Advance current beat for next note (if no explicit beat)
        if (note.beat === undefined && note.startTime === undefined) {
          currentBeat += durBeats;
        }
      });
    });

    this.duration = maxEndTime - this.startTime;
    this.isPlaying = true;
    this.updateProgress();

    // Auto-stop after playback ends
    setTimeout(() => {
      if (this.isPlaying) this.stop();
    }, (this.duration + 0.5) * 1000);
  }

  stop() {
    this.isPlaying = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.scheduledNodes.forEach(node => {
      try { node.stop(); } catch(e) { /* already stopped */ }
    });
    this.scheduledNodes = [];
    if (this.progressCallback) this.progressCallback(0);
  }

  updateProgress() {
    if (!this.isPlaying || !this.audioContext) return;
    const elapsed = this.audioContext.currentTime - this.startTime;
    const progress = Math.min(elapsed / this.duration, 1);
    if (this.progressCallback) this.progressCallback(progress);
    if (progress < 1) {
      this.animFrame = requestAnimationFrame(() => this.updateProgress());
    }
  }
}

// --- Utility Functions ---

function durationToBeats(dur) {
  if (typeof dur === 'number') {
    // Already in some numeric form
    switch (dur) {
      case 0.125: return 0.125;
      case 0.25: return 0.25;
      case 0.5: return 0.5;
      case 1: return 1;
      case 2: return 2;
      case 4: return 4;
      default: return 1;
    }
  }
  const s = String(dur);
  // Dotted durations
  if (s.startsWith('dd')) return (4 / parseInt(s.slice(2))) * 1.75;
  if (s.startsWith('d')) return (4 / parseInt(s.slice(1))) * 1.5;
  // Triplet
  if (s.startsWith('T')) return (4 / parseInt(s.slice(1))) * (2/3);
  // Standard
  const n = parseInt(s);
  if (!isNaN(n) && n > 0) return 4 / n;
  return 1; // default quarter note
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteNameToMidi(name) {
  const map = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  const m = name.match(/^([A-Ga-g])([#b]?)(\\-?\\d+)$/);
  if (!m) return 60;
  let semi = map[m[1].toUpperCase()] || 0;
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  return (parseInt(m[3]) + 1) * 12 + semi;
}

const CHORD_INTERVALS = {
  '': [0,4,7], 'maj': [0,4,7], 'm': [0,3,7], 'min': [0,3,7],
  'dim': [0,3,6], 'aug': [0,4,8], '7': [0,4,7,10], 'maj7': [0,4,7,11],
  'M7': [0,4,7,11], 'm7': [0,3,7,10], 'dim7': [0,3,6,9],
  'm7b5': [0,3,6,10], 'sus2': [0,2,7], 'sus4': [0,5,7],
  '6': [0,4,7,9], '9': [0,4,7,10,14], 'add9': [0,4,7,14],
  'power': [0,7], '5': [0,7]
};

function parseChordForUI(chordName) {
  const m = chordName.match(/^([A-Ga-g])([#b]?)(\\d+)?(.*)$/);
  if (!m) return [60];
  const root = noteNameToMidi(m[1] + (m[2]||'') + (m[3]||'4'));
  const intervals = CHORD_INTERVALS[m[4]] || [0,4,7];
  return intervals.map(i => root + i);
}

function resolvePitchesForUI(pitch, chord) {
  if (chord) return parseChordForUI(chord);
  if (Array.isArray(pitch)) return pitch;
  return [pitch];
}

function midiNumberToNoteName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

// --- Notation Rendering (Piano Roll style) ---

function renderNotation(composition, container) {
  container.innerHTML = '';

  const bpm = composition.bpm || 120;
  const tracks = composition.tracks || [];
  if (tracks.length === 0) {
    container.innerHTML = '<p class="status">No tracks in composition</p>';
    return;
  }

  // Calculate total beats and note ranges
  let minPitch = 127, maxPitch = 0, totalBeats = 0;

  const resolvedTracks = tracks.map((track, ti) => {
    let currentBeat = 0;
    const notes = track.notes.map(note => {
      let beat;
      if (note.beat !== undefined) beat = note.beat - 1;
      else if (note.startTime !== undefined) beat = note.startTime;
      else beat = currentBeat;

      const durBeats = durationToBeats(note.duration);
      const pitches = resolvePitchesForUI(note.pitch, note.chord);

      pitches.forEach(p => {
        const midi = typeof p === 'string' ? noteNameToMidi(p) : p;
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
    return { name: track.name || 'Track ' + (ti+1), instrument: track.instrument, notes };
  });

  // SVG dimensions
  const pitchRange = Math.max(maxPitch - minPitch + 1, 12);
  const paddingPitch = 2;
  const effMinPitch = minPitch - paddingPitch;
  const effRange = pitchRange + paddingPitch * 2;

  const noteHeight = 10;
  const beatWidth = 60;
  const leftMargin = 50;
  const topMargin = 20;

  const svgWidth = leftMargin + totalBeats * beatWidth + 40;
  const svgHeight = topMargin + effRange * noteHeight + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(svgWidth));
  svg.setAttribute('height', String(svgHeight));
  svg.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);

  // Background grid
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? '#2a2a4a' : '#e9ecef';
  const textColor = isDark ? '#aaa' : '#666';

  // Beat lines
  for (let b = 0; b <= totalBeats; b++) {
    const x = leftMargin + b * beatWidth;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x)); line.setAttribute('y1', String(topMargin));
    line.setAttribute('x2', String(x)); line.setAttribute('y2', String(svgHeight - 20));
    line.setAttribute('stroke', b % 4 === 0 ? (isDark ? '#444' : '#adb5bd') : gridColor);
    line.setAttribute('stroke-width', b % 4 === 0 ? '1.5' : '0.5');
    svg.appendChild(line);

    if (b % 4 === 0) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(x)); txt.setAttribute('y', String(svgHeight - 5));
      txt.setAttribute('fill', textColor); txt.setAttribute('font-size', '9');
      txt.setAttribute('text-anchor', 'middle');
      txt.textContent = String(Math.floor(b / 4) + 1);
      svg.appendChild(txt);
    }
  }

  // Pitch labels (every octave C)
  for (let p = effMinPitch; p <= effMinPitch + effRange; p++) {
    if (p % 12 === 0) {
      const y = topMargin + (effMinPitch + effRange - p) * noteHeight;
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(leftMargin - 5)); txt.setAttribute('y', String(y + 4));
      txt.setAttribute('fill', textColor); txt.setAttribute('font-size', '9');
      txt.setAttribute('text-anchor', 'end');
      txt.textContent = 'C' + (Math.floor(p / 12) - 1);
      svg.appendChild(txt);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(leftMargin)); line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(svgWidth - 40)); line.setAttribute('y2', String(y));
      line.setAttribute('stroke', gridColor); line.setAttribute('stroke-width', '0.5');
      svg.appendChild(line);
    }
  }

  // Note colors per track
  const trackColors = ['#4361ee', '#e63946', '#06d6a0', '#ff9f1c', '#9d4edd', '#118ab2', '#ef476f', '#ffd166'];

  // Draw notes
  resolvedTracks.forEach((track, ti) => {
    const color = trackColors[ti % trackColors.length];
    track.notes.forEach(n => {
      n.pitches.forEach(p => {
        const midi = typeof p === 'string' ? noteNameToMidi(p) : p;
        const x = leftMargin + n.beat * beatWidth;
        const w = Math.max(n.durBeats * beatWidth - 2, 4);
        const y = topMargin + (effMinPitch + effRange - midi) * noteHeight - noteHeight/2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(noteHeight - 1));
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', color);
        rect.setAttribute('opacity', String(0.4 + (n.velocity / 127) * 0.6));
        svg.appendChild(rect);
      });
    });
  });

  container.appendChild(svg);
}

// --- Main App Logic ---

const player = new MidiPlayer();
let currentComposition = null;
let midiBase64Data = null;

const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const progressFill = document.getElementById('progress-fill');
const notationDiv = document.getElementById('notation');
const trackList = document.getElementById('track-list');
const tempoDisplay = document.getElementById('tempo-display');
const statusText = document.getElementById('status-text');
const downloadLink = document.getElementById('download-link');

player.progressCallback = (p) => {
  progressFill.style.width = (p * 100) + '%';
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
});

btnStop.addEventListener('click', () => {
  player.stop();
  btnPlay.disabled = false;
  btnStop.disabled = true;
  progressFill.style.width = '0%';
});

// --- MCP Apps Communication ---
// Listen for tool input from the MCP host via postMessage

function handleToolInput(data) {
  try {
    currentComposition = data.composition || data;

    // Render notation
    renderNotation(currentComposition, notationDiv);

    // Show track info
    trackList.innerHTML = '';
    (currentComposition.tracks || []).forEach((track, i) => {
      const div = document.createElement('div');
      div.className = 'track-info';
      const name = track.name || 'Track ' + (i + 1);
      const inst = track.instrument !== undefined ? ' (GM: ' + track.instrument + ')' : '';
      const noteCount = track.notes ? track.notes.length : 0;
      div.innerHTML = '<span class="track-name">' + name + '</span>' +
        '<span class="track-detail">' + inst + ' - ' + noteCount + ' notes</span>';
      trackList.appendChild(div);
    });

    // Show tempo
    tempoDisplay.textContent = (currentComposition.bpm || 120) + ' BPM';

    // Enable play
    btnPlay.disabled = false;
    statusText.textContent = 'Ready to play';

    // Set up download link if MIDI base64 is available
    if (midiBase64Data) {
      downloadLink.href = 'data:audio/midi;base64,' + midiBase64Data;
      downloadLink.style.display = 'inline-block';
    }
  } catch(e) {
    notationDiv.innerHTML = '<p class="error">Error: ' + e.message + '</p>';
  }
}

// Listen for messages from MCP host
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  // Handle various message formats
  if (data.type === 'toolInput' || data.type === 'tool_input') {
    handleToolInput(data.input || data.data || data);
  } else if (data.composition) {
    handleToolInput(data);
  } else if (data.type === 'resource' && data.resource) {
    // Handle MIDI resource data
    if (data.resource.mimeType === 'audio/midi') {
      midiBase64Data = data.resource.text;
    }
  }
});

// Notify host that app is ready
window.parent?.postMessage({ type: 'ready' }, '*');

// Also check if data was passed via URL params (fallback)
const urlParams = new URLSearchParams(window.location.search);
const compositionParam = urlParams.get('composition');
if (compositionParam) {
  try {
    handleToolInput(JSON.parse(decodeURIComponent(compositionParam)));
  } catch(e) { /* ignore */ }
}
</script>
</body>
</html>`;
}
