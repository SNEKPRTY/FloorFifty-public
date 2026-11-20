/**
 * The game's one scale: the minor pentatonic `generate-cues.ts` drafted the
 * landings in, in semitones above its root. No semitone steps, so any note of
 * it against any moment of a track agrees. The landings climb it with the
 * racer (`race-cues.ts`) and the results reveal climbs it toward the winner
 * (`results-motion.ts`); both read it here, so retuning one retunes both.
 */
export const PENTATONIC = [0, 3, 5, 7, 10] as const;

/** Semitones above the root of a scale degree, counting on past the octave. */
export const semitonesOf = (degree: number): number =>
  PENTATONIC[degree % PENTATONIC.length]! + 12 * Math.floor(degree / PENTATONIC.length);

/** The playback rate that raises a sound by `semitones`. */
export const rateFor = (semitones: number): number => 2 ** (semitones / 12);
