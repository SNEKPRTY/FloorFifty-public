/**
 * How hard the world is pushing back.
 *
 * A climb that got further should feel like it got further: the track opening
 * up, the city brighter, the pulse deeper. This is that ramp, and the whole of it
 * is presentation.
 *
 * **It invents nothing.** The design's Non-Goals refuse rhythm scoring,
 * streaks, Flow and beat-dependent physics, and this is none of them. It reads
 * `progress`, which the snapshot already carries and the simulation already
 * owns: the share of the ascent a racer has collected. A reset clears
 * `visitedFloorIds` back to the starting floor, so that number *is* floors
 * climbed since the last reset, and losing an ascent turns the intensity down
 * because the ascent is what it was measuring. There is no second state to keep
 * in step and nothing new for a player to lose.
 *
 * **It is not a score and is never shown as one.** Nothing here is displayed,
 * counted, or compared between players. A player who never notices it has lost
 * nothing they could have played differently, which is the test of whether a
 * thing belongs on this side of the line.
 *
 * **Nothing it drives can change the race.** The music's filter, bloom, pulse
 * depth and camera breath, and nothing else. Mute the tab and the race is identical; the
 * same inputs produce the same landings at intensity zero and at one.
 */

import { logLerp } from "@floor-fifty/shared/common/math";

/**
 * The band each driven value moves within.
 *
 * Floors rather than zeroes at the bottom. A world that is silent and still at
 * the start of a climb reads as broken rather than as calm, and the ramp is
 * meant to be felt on arrival rather than noticed as an absence beforehand.
 */
export const MOMENTUM = {
  /**
   * The music's low-pass cutoff at no progress, and at a full ascent, in hertz.
   *
   * A filter rather than a gain. Turning a mastered track up reads as someone
   * reaching for the volume knob, and fights the build the song already has;
   * opening a filter reads as the track coming closer while it stays at the
   * level it was mixed at. The bottom is muffled but still the song -- the
   * melody survives under two kilohertz -- and the top is past what the ear
   * misses, so a full ascent hears the track exactly as mastered.
   */
  musicCutoffFloorHz: 1_800,
  musicCutoffCeilingHz: 20_000,
  /** How much of the world pulse is applied, at each end. */
  pulseFloor: 0.6,
  pulseCeiling: 1,
  /**
   * How fast intensity may move, per second.
   *
   * Slow enough that a single floor is a nudge rather than a step, so the ramp
   * reads as the climb building rather than as a meter ticking. Falling is the
   * same rate: a reset should feel like losing height, and height is lost by
   * falling through it rather than by being switched off -- the filter closes
   * like sinking under water rather than like a cut.
   */
  glidePerSecond: 0.55,
} as const;

/**
 * Intensity from a racer's share of the ascent.
 *
 * Eased rather than linear, and weighted late. The first few floors of a climb
 * are the teaching phrase and should stay quiet; the top is where the course
 * asks for three near-maximum commitments in a row, and that is where the world
 * should be loudest.
 */
export function intensityFor(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  // Smoothstep, then squared: smooth at both ends, and biased toward the top.
  const eased = clamped * clamped * (3 - 2 * clamped);
  return eased * eased;
}

const lerp = (from: number, to: number, at: number): number => from + (to - from) * at;

/**
 * How open the music is at an intensity.
 *
 * The square root undoes the squaring in `intensityFor`, leaving the plain
 * smoothstep of progress. The world's pulse wants the late weighting -- it is
 * what makes the top insistent -- but the ear hears a filter that stays shut
 * through half the climb as nothing happening, then as one sudden swell. The
 * music opens steadily from the first floor instead.
 */
const opennessFor = (intensity: number): number => Math.sqrt(intensity);

// Pitch is heard in octaves, so the cutoff moves evenly in octaves (`logLerp`):
// a linear sweep in hertz would spend the whole lower half of the climb in the
// top few kilohertz, where the change is hardest to hear.

/**
 * Eases toward the intensity a snapshot implies.
 *
 * A separate object from the function above because intensity is read every
 * frame and set every snapshot, twenty times a second: stepping straight to
 * each new value would make the music's filter audibly staircase. The glide is also
 * what turns a reset into a descent rather than a cut.
 */
export class MomentumTracker {
  private value = 0;
  private target = 0;

  /** The share of the ascent this racer has collected, from the snapshot. */
  observe(progress: number): void {
    this.target = intensityFor(progress);
  }

  /** Advances the glide. Returns the intensity to draw and mix at. */
  advance(deltaMs: number): number {
    const step = (MOMENTUM.glidePerSecond * deltaMs) / 1000;
    if (this.value < this.target) this.value = Math.min(this.target, this.value + step);
    else this.value = Math.max(this.target, this.value - step);
    return this.value;
  }

  get intensity(): number {
    return this.value;
  }

  /** The music's low-pass cutoff at the current intensity, in hertz. */
  get musicCutoffHz(): number {
    return logLerp(MOMENTUM.musicCutoffFloorHz, MOMENTUM.musicCutoffCeilingHz, opennessFor(this.value));
  }

  /** How much of the world pulse to apply at the current intensity. */
  get pulseScale(): number {
    return lerp(MOMENTUM.pulseFloor, MOMENTUM.pulseCeiling, this.value);
  }

  reset(): void {
    this.value = 0;
    this.target = 0;
  }
}
