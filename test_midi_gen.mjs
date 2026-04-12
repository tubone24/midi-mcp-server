import pkg from '@tonejs/midi';
const { Midi } = pkg;

function generateMidiBase64(composition) {
  const bpm = composition.bpm || 120;
  const secondsPerBeat = 60 / bpm;
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm }];
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4] }];
  midi.header.update();

  composition.tracks.forEach((trackData, trackIndex) => {
    const track = midi.addTrack();
    if (trackData.name) {
      track.name = trackData.name;
    }
    if (trackData.instrument) {
      track.instrument.number = trackData.instrument;
    }
    track.channel = trackIndex % 16;
    
    trackData.notes.forEach((note) => {
      const durationSec = 1 * secondsPerBeat;
      const timeSec = (note.beat - 1) * secondsPerBeat;
      const midiNum = note.pitch;
      track.addNote({
        midi: midiNum,
        time: timeSec,
        duration: durationSec,
        velocity: 100 / 127,
      });
    });
  });

  return Buffer.from(midi.toArray()).toString('base64');
}

const composition = {
  bpm: 120,
  tracks: [
    { name: 'Piano', instrument: 0, notes: [{ pitch: 60, beat: 1 }] },
    { name: 'Bass', instrument: 32, notes: [{ pitch: 48, beat: 1 }] }
  ]
};

const base64 = generateMidiBase64(composition);
const arr = Buffer.from(base64, 'base64');

console.log('=== MIDI Generation Test ===');
console.log('Binary length:', arr.length);
console.log('Format:', arr[8]*256 + arr[9]);
console.log('NumTracks:', arr[10]*256 + arr[11]);
console.log('PPQ:', arr[12]*256 + arr[13]);
