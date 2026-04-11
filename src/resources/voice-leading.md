# Voice Leading Reference

## Core Principles

1. **Minimal motion** — Each voice moves the shortest distance to the next chord tone
2. **Contrary motion preferred** — If bass moves up, soprano moves down (and vice versa)
3. **Common tones held** — Notes shared between chords stay in the same voice
4. **Smooth inner voices** — Alto and tenor should move by step when possible
5. **Resolve tendency tones** — Leading tone (7̂) → tonic (1̂); chordal 7ths resolve down by step

## Forbidden Parallels

| Error | Description | Example |
|-------|-------------|---------|
| Parallel 5ths | Two voices both move by a 5th in the same direction | C→G + G→D |
| Parallel 8ths/octaves | Two voices in octaves moving the same direction | C4→D4 + C5→D5 |
| Direct 5ths/octaves | Jump to 5th/8th in similar motion (outer voices) | Soprano/bass leap to octave |

## Voice Range Guidelines

| Voice | Comfortable Range | MIDI |
|-------|-----------------|------|
| Soprano | C4–G5 | 60–79 |
| Alto | G3–C5 | 55–72 |
| Tenor | C3–G4 | 48–67 |
| Bass | E2–C4 | 40–60 |

**Spacing rules:**
- Soprano–Alto: avoid more than an octave gap
- Alto–Tenor: avoid more than an octave gap
- Tenor–Bass: up to an octave + a 5th is acceptable

## Chord Voicing Strategies

### Close Position
All four notes within one octave. Rich, tight sound. Use in mid–high register.

### Open Position
Spread voices beyond an octave. Fuller, orchestral sound. Use in full ensemble writing.

### Drop-2 Voicing (Jazz)
Take the second voice from the top in close position and drop it an octave. Creates a wider, jazz-like sound.

**Example — C major close vs drop-2:**
- Close: G5 (S), E5 (A), C5 (T), C4 (B)
- Drop-2: G5 (S), C5 (T+1 dropped), E5 (A), C4 (B) → G5, E5, C4, C3

## Resolving V7 → I

The dominant 7th chord (V7) has two tendency tones:
- **7th of the chord** (4̂ in major) → resolves DOWN by step to 3̂
- **Leading tone** (7̂) → resolves UP by step to 8̂ (tonic)

In G7→C:
- F (7th) → E (3rd of C)
- B (leading tone) → C (root of C)

**Exception**: The 5th (D) can be omitted in the V7 to avoid parallel 5ths; double the root instead.

## Passing Tones & Non-Chord Tones

| Type | Description | Beat |
|------|-------------|------|
| Passing tone | Step between two chord tones | Weak |
| Neighbor tone | Step away and back | Weak |
| Suspension | Held over from previous chord | Strong → resolves down |
| Appoggiatura | Leap to non-chord tone, then step to chord tone | Strong |
| Escape tone | Step then leap away | Weak |

## Multi-Track MIDI Voice Leading Tips

- Assign each voice to a **separate track** with its own instrument/channel
- Use `beat` field for absolute positioning to synchronize voices
- Keep bass an octave below tenor when possible (avoid muddy low intervals)
- Frequency masking: avoid having two instruments playing the same pitch range simultaneously
- For keyboard voicings: right hand plays Soprano+Alto, left hand plays Tenor+Bass

## Checklist Before Generating MIDI

- [ ] No parallel perfect 5ths or octaves between any two voices
- [ ] Leading tone (7̂) resolves up
- [ ] Chordal 7ths resolve down by step
- [ ] Each voice stays within its natural range
- [ ] Voices do not cross (soprano remains highest, bass remains lowest)
- [ ] Leaps larger than a 4th are followed by stepwise motion in the opposite direction
