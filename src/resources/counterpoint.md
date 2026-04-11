# Counterpoint Reference (Based on Fux's Species Counterpoint)

## Core Concepts

**Counterpoint** is the art of combining independent melodic lines. Each voice should be singable, have its own shape, and create interesting harmonic relationships with other voices.

## Consonance / Dissonance Classification

| Interval | Type | Treatment |
|----------|------|-----------|
| Unison, 8ve, 5th | Perfect consonance | Use freely; avoid too many in a row |
| 3rd, 6th | Imperfect consonance | Preferred; give warmth |
| 2nd, 7th, 9th | Dissonance | Only as passing tones or suspensions |
| Tritone (aug 4th/dim 5th) | Dissonance | Avoid melodically; resolve when harmonic |

## Types of Motion

| Type | Description | Preference |
|------|-------------|------------|
| Contrary | Voices move in opposite directions | Preferred; creates independence |
| Oblique | One voice stays, other moves | Good; pedal tones |
| Similar | Both voices move same direction, different intervals | Use sparingly |
| Parallel | Both voices move same direction, same interval | Avoid for 5ths and 8ths |

## The Five Species

### First Species (1:1, note-against-note)
- Use only consonances (unison, 3rd, 5th, 6th, 8ve)
- **Strictly forbid**: parallel 5ths, parallel octaves, parallel unisons
- Prefer contrary motion; avoid three or more similar motions in a row
- Begin and end on perfect consonances (usually unison or octave)

### Second Species (2:1, two notes per cantus note)
- Beat 1 (strong): consonance only
- Beat 2 (weak): consonance or passing dissonance (stepwise)
- Avoid parallel 5ths/8ths between strong beats
- Passing tones connect consecutive notes by step

### Third Species (4:1, four notes per cantus note)
- Strong beat: consonance
- Weak beats: consonance or passing/neighbor dissonances
- **Cambiata figure**: down 2nd, down 3rd, up 2nd (classic escape figure)
- Neighbor tones (upper/lower) are allowed on weak beats

### Fourth Species (Syncopation & Suspensions)
- Notes are tied over the bar line; the dissonance falls on the strong beat
- **Suspension patterns** (dissonance – resolution):
  - 7–6 (most common)
  - 4–3 (over V chord; creates V7-I effect)
  - 9–8
  - 2–3 (in the bass)
- Resolution must be **one step downward** (except 2–3)
- No parallel 5ths/8ths when suspensions resolve

### Fifth Species (Florid Counterpoint)
- Freely combine techniques from all four species
- Aim for rhythmic variety; mix note values
- Climax note should be near the middle or two-thirds through
- End with authentic cadence (leading tone resolves up to tonic)

## MIDI Application Tips

When writing counterpoint in MIDI JSON:
- Place each independent voice in a **separate track**
- Use `beat` field for absolute position; ensure voices don't mask each other in register
- Keep voices within their natural ranges (see Orchestration resource)

**Example — simple two-voice first species (C major):**
```json
{
  "bpm": 80,
  "tracks": [
    {
      "name": "Soprano",
      "notes": [
        {"pitch": "E5", "duration": "4", "beat": 1},
        {"pitch": "D5", "duration": "4", "beat": 2},
        {"pitch": "C5", "duration": "4", "beat": 3},
        {"pitch": "D5", "duration": "4", "beat": 4},
        {"pitch": "E5", "duration": "2", "beat": 5}
      ]
    },
    {
      "name": "Bass (Cantus)",
      "notes": [
        {"pitch": "C4", "duration": "4", "beat": 1},
        {"pitch": "B3", "duration": "4", "beat": 2},
        {"pitch": "A3", "duration": "4", "beat": 3},
        {"pitch": "G3", "duration": "4", "beat": 4},
        {"pitch": "C4", "duration": "2", "beat": 5}
      ]
    }
  ]
}
```
