# Modes & Scales Reference

## The Seven Diatonic Modes (C as root)

| Mode | Notes (C root) | Formula | Character |
|------|----------------|---------|-----------|
| Ionian (Major) | C D E F G A B | W W H W W W H | Bright, happy |
| Dorian | C D Eb F G A Bb | W H W W W H W | Minor, but sophisticated (raised 6th) |
| Phrygian | C Db Eb F G Ab Bb | H W W W H W W | Dark, Spanish, exotic |
| Lydian | C D E F# G A B | W W W H W W H | Dreamy, ethereal, floating |
| Mixolydian | C D E F G A Bb | W W H W W H W | Bluesy, rock, unresolved major |
| Aeolian (Natural Minor) | C D Eb F G Ab Bb | W H W W H W W | Sad, dark |
| Locrian | C Db Eb F Gb Ab Bb | H W W H W W W | Extremely unstable; rare in practice |

## Minor Scale Variants

| Scale | Formula | Notes (A root) | Use |
|-------|---------|----------------|-----|
| Natural Minor (Aeolian) | W H W W H W W | A B C D E F G | Folk, pop, rock |
| Harmonic Minor | W H W W H A H | A B C D E F G# | Classical, Middle Eastern |
| Melodic Minor (ascending) | W H W W W W H | A B C D E F# G# | Jazz, classical |

(Melodic minor descends as natural minor)

## Pentatonic Scales

| Scale | Formula | Notes (C root) | Genre |
|-------|---------|----------------|-------|
| Major Pentatonic | W W m3 W m3 | C D E G A | Country, pop, folk |
| Minor Pentatonic | m3 W W m3 W | C Eb F G Bb | Blues, rock, pop |
| Minor Blues | m3 W H H m3 W | C Eb F F# G Bb | Blues, rock |

## Other Important Scales

| Scale | Semitones | Character |
|-------|-----------|-----------|
| Whole Tone | 2 2 2 2 2 2 | Impressionist, dreamlike (Debussy) |
| Chromatic | 1 1 1 1 1 1 1 1 1 1 1 1 | Tension, atonal passages |
| Diminished (octatonic) | W H W H W H W H | Jazz, tense |
| Augmented | m3 H m3 H m3 H | Mysterious |

## Genre → Scale/Mode Guide

| Genre | Recommended Scales/Modes |
|-------|--------------------------|
| Classical/Baroque | Ionian, Aeolian, Harmonic Minor, Dorian |
| Jazz | Dorian, Mixolydian, Lydian, Melodic Minor, Diminished |
| Blues | Minor Blues, Minor Pentatonic, Mixolydian |
| Rock | Minor Pentatonic, Aeolian, Mixolydian |
| Folk | Major Pentatonic, Ionian, Dorian |
| Spanish/Flamenco | Phrygian, Harmonic Minor |
| Film / Cinematic | Aeolian, Dorian, Lydian (wonder), Locrian (horror) |
| Electronic / Ambient | Dorian, Lydian, Whole Tone |

## Mode Application in MIDI

- Use `chord` field with the root of the mode's tonic chord
- For Dorian: use `m7` chords on I and IV (e.g., `"Dm7"`, `"Gm7"`)
- For Mixolydian: use dominant chords (`"G7"`) resolving to `"C"` without classical cadence
- For Phrygian: characteristic bII chord (e.g., in E Phrygian, `"F"` → `"Em"`)
- For Lydian: raised 4th creates the `#4` / `#11` color — use `maj7#11` chords
