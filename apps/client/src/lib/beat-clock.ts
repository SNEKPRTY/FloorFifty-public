/**
 * The beat clock.
 *
 * The authored grid: beat phase from the simulation tick and the stage song's
 * measured tempo. Where the song is audibly playing, the world keeps time to
 * the song itself instead (`beatPhaseOf` a beat from `playingSongBeat`), so
 * the pulse is on the music the player hears even when the song started late
 * or drifted from the tick. This grid is what it keeps where nothing audible
 * says where the beat is, and it never reads an `AudioContext`'s clock.
 * Three consequences follow for those stretches:
 *
 * - A late browser unlock moves the music, not the visuals. A player who
 *   clicks to start audio twenty seconds in sees the same pulse they were
 *   already seeing, because it was never reading the audio.
 * - A muted tab pulses identically to an unmuted one, so the game teaches the
 *   same thing either way.
 * - Two clients on the same tick agree about the beat without exchanging
 *   anything, because they are both reading a number the server already
 *   guarantees.
 *
 * None of this is authority and none of it is a rule. Nothing here is read by
 * the simulation, nothing here reaches `RaceState`, and there is no verdict, score,
 * streak, or penalty anywhere in this file. A landing on the beat and a landing
 * off it do exactly the same thing; only the emphasis differs. That boundary is
 * enforced structurally by `tests/shared/simulation/music-presentation.test.ts`.
 *
 * The song's `beatOffsetTicks` is a whole tick, which at 60 Hz quantises the
 * downbeat to 16.667 ms. That is deliberate: the residual is a fraction of one
 * frame, far below what reads as early or late, and an offset expressed in
 * ticks is one a reviewer can reason about against the simulation's own clock.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";

/** Beats in a bar. Four, for every song the slice ships. */
export const BEATS_PER_BAR = 4;

/**
 * The timing an authored song contributes.
 *
 * A structural subset of `SongContent` rather than the whole thing, so that
 * nothing here can reach for a loop point or an alias it has no business
 * reading.
 */
export type SongTiming = {
  readonly bpm: number;
  readonly beatOffsetTicks: number;
};

export type BeatPhase = {
  /**
   * Whole beats since the first downbeat. Negative before it, which is an
   * ordinary state during a countdown rather than something to clamp away.
   */
  readonly beat: number;
  /** Position inside the current beat: 0 exactly on it, approaching 1 before the next. */
  readonly phase: number;
  /** Which beat of the bar this is, 0-based. */
  readonly beatInBar: number;
  /** Whole bars since the first downbeat. */
  readonly bar: number;
};

/** Simulation ticks in one beat. Fractional, and deliberately not rounded. */
export const ticksPerBeat = (bpm: number): number => (TICK_HZ * 60) / bpm;

/**
 * Where in the music a tick falls.
 *
 * Pure: the same tick and the same song always give the same answer, on every
 * client, forever. `tick` is the authoritative simulation tick, not a frame
 * count and not a wall clock.
 */
export function beatPhaseAt(tick: number, song: SongTiming): BeatPhase {
  return beatPhaseOf((tick - song.beatOffsetTicks) / ticksPerBeat(song.bpm));
}

/**
 * Where in the music a count of beats since the first downbeat falls:
 * `beatPhaseAt` without the tick, for a beat read off the playing song
 * (`playingSongBeat`) rather than derived from the simulation.
 */
export function beatPhaseOf(elapsed: number): BeatPhase {
  // `Math.floor` rather than truncation so the beats before the first downbeat
  // count backwards properly instead of folding onto zero.
  const beat = Math.floor(elapsed);
  const phase = elapsed - beat;
  const bar = Math.floor(beat / BEATS_PER_BAR);

  return {
    beat,
    phase,
    // Modulo in JavaScript keeps the sign of the dividend, which would give a
    // negative beat-in-bar before the downbeat. The shift makes it an index.
    beatInBar: ((beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR,
    bar,
  };
}

/** Whether a beat boundary falls between two consecutive ticks. */
export const crossedBeat = (previousTick: number, tick: number, song: SongTiming): boolean =>
  beatPhaseAt(previousTick, song).beat !== beatPhaseAt(tick, song).beat;

/**
 * Tunable presentation bounds.
 *
 * Named and bounded because the design permits tuning visual lead-in, pulse
 * strength, and phrasing, and requires that every accepted change be recorded.
 * They live in client code rather than in authored content on purpose: they are
 * not race inputs, and putting them in a stage file would drag them into
 * `contentRevision` and invite them to look like rules.
 */
export const PULSE = {
  /**
   * How far ahead of a beat the swell begins, in beats.
   *
   * A pulse that starts exactly on the beat reads as late, because the eye
   * needs the motion to already be under way when the ear arrives.
   */
  leadIn: 0.25,
  /** Peak strength of an ordinary beat, 0 to 1. */
  strength: 0.35,
  /** Peak strength on the first beat of a bar, which carries the phrasing. */
  downbeatStrength: 0.6,
} as const;

/**
 * Pulse envelope at a tick, from 0 to the applicable peak.
 *
 * Rises over `leadIn` beats into the beat and falls away across the rest of it,
 * so the shape is an anticipation followed by a decay rather than a symmetric
 * blink. Callers multiply this into a scale, a brightness, or a camera offset;
 * it carries no opinion about which.
 */
export function pulseAt(tick: number, song: SongTiming): number {
  return pulseOf(beatPhaseAt(tick, song));
}

/** The pulse envelope at a beat phase; see `pulseAt`. */
export function pulseOf({ phase, beatInBar }: BeatPhase): number {
  const peak = beatInBar === 0 ? PULSE.downbeatStrength : PULSE.strength;

  // Distance to the next beat, in beats. Zero exactly on one.
  const untilNext = 1 - phase;

  if (untilNext <= PULSE.leadIn) {
    // Swelling into the beat.
    return peak * (1 - untilNext / PULSE.leadIn);
  }

  // Decaying out of the beat just passed, across whatever is left of it.
  const decayWindow = 1 - PULSE.leadIn;
  return peak * Math.max(0, 1 - phase / decayWindow);
}
