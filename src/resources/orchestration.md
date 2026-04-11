# Orchestration Reference

## Instrument Ranges & GM Program Numbers

### Strings
| Instrument | GM # | MIDI Range | Notes |
|------------|------|------------|-------|
| Violin | 40 | G3–E7 (55–100) | Bright, singing; double-stops possible |
| Viola | 41 | C3–E6 (48–88) | Darker than violin |
| Cello | 42 | C2–C6 (36–72) | Rich low register; melodic tenor register |
| Contrabass | 43 | E1–C4 (28–60) | Foundation; pizzicato effective |
| String Ensemble | 48–49 | Wide | Pads, sustained harmony |

### Woodwinds
| Instrument | GM # | MIDI Range | Notes |
|------------|------|------------|-------|
| Flute | 73 | C4–D7 (60–98) | Bright high register; breathy low |
| Oboe | 68 | Bb3–A6 (58–81) | Penetrating; poignant |
| Clarinet | 71 | E3–C7 (52–96) | Warm; wide dynamic range |
| Bassoon | 70 | Bb1–Eb5 (34–75) | Dark, gruff low; sweet high |
| Alto Sax | 65 | Db3–Ab5 (49–80) | Smooth; jazz/blues |

### Brass
| Instrument | GM # | MIDI Range | Notes |
|------------|------|------------|-------|
| Trumpet | 56 | E3–C6 (52–84) | Brilliant; fanfare |
| Trombone | 57 | E2–Bb4 (40–70) | Rich, powerful |
| French Horn | 60 | B1–F5 (35–77) | Warm; blends well |
| Tuba | 58 | D1–F4 (26–65) | Foundation |
| Brass Section | 61 | — | Full ensemble |

### Keyboards & Other
| Instrument | GM # | Notes |
|------------|------|-------|
| Piano | 0 | Full range; poly; left hand bass |
| Electric Piano | 4–5 | Jazz, R&B, pop |
| Harpsichord | 6 | Baroque; no dynamics |
| Organ | 16–19 | Sustained; church or rock |
| Synth Pad | 88–95 | Ambient textures |

### Percussion (Channel 10)
- Use MIDI channel 10 (0-indexed: 9) for GM drums
- Key notes: Kick=36, Snare=38, Hi-hat closed=42, Hi-hat open=46, Crash=49, Ride=51

## Four-Part Harmony Voice Ranges

| Voice | MIDI Range | Typical Notes |
|-------|------------|---------------|
| Soprano | C4–G5 (60–79) | Melody, top line |
| Alto | G3–C5 (55–72) | Inner harmony |
| Tenor | C3–G4 (48–67) | Inner harmony |
| Bass | E2–C4 (40–60) | Harmonic foundation |

**Spacing rules:**
- Soprano–Alto gap: max 1 octave
- Alto–Tenor gap: max 1 octave
- Tenor–Bass gap: max 1 octave + 5th
- Avoid close position in the bass (below C3): use open voicing

## Orchestral Layers (Frequency Zones)

| Layer | Frequency | Instruments |
|-------|-----------|-------------|
| Sub bass | 20–80 Hz | Contrabass, Tuba |
| Bass | 80–250 Hz | Cello, Bassoon, Bass Trombone |
| Low-mid | 250–800 Hz | Viola, Cello upper, Horn |
| Mid | 800–2500 Hz | Violin lower, Clarinet, Oboe |
| High-mid | 2500–8000 Hz | Violin upper, Flute, Trumpet |
| Air | 8000+ Hz | Flute high, Piccolo, Cymbals |

## Texture Types

| Texture | Description | Example |
|---------|-------------|---------|
| Monophonic | Single melody, no harmony | Unaccompanied solo |
| Homophonic | Melody + chordal accompaniment | Hymn, pop song |
| Polyphonic | Multiple independent melodic lines | Fugue, counterpoint |
| Heterophonic | Multiple versions of same melody | Gamelan, folk |

## MIDI Multi-Track Template

```json
{
  "bpm": 120,
  "tracks": [
    {"name": "Melody",   "instrument": 40, "notes": []},
    {"name": "Harmony",  "instrument": 48, "notes": []},
    {"name": "Bass",     "instrument": 42, "notes": []},
    {"name": "Drums",    "instrument": 0,  "notes": []}
  ]
}
```
