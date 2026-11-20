/**
 * Which snapshot the race's mix is in (see `MIXES` in `audio.ts`).
 *
 * The pause muffles the race heard through it. "LAST FLOOR!" holds the breath
 * -- the room pulled out from under the player one floor from the goal -- and
 * the finish lets it go, so the fanfare lands against near-silence: the film
 * mix's trick of taking everything away just before the hit. A reset or a fall
 * lets it go too, as does a breath held too long, so a player stuck on the
 * last floor is not left in a hush.
 *
 * Pure, and on the scene's presentation clock: nothing here reads the audio
 * graph, and nothing here reaches the race.
 */

import type { MixName } from "./";

/** The longest a breath holds before the race comes back in, in presentation time. */
export const BREATH_MAX_MS = 6_000;

export type RaceMixFrame = {
  readonly nowMs: number;
  /** "LAST FLOOR!" started this frame. */
  readonly lastFloor: boolean;
  /** Something that ends a breath reached the picture this frame: the finish, or the local racer's reset or out. */
  readonly release: boolean;
};

export class RaceMix {
  private breathFromMs: number | undefined;
  private paused = false;

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** The snapshot this frame wants. */
  frame(input: RaceMixFrame): MixName {
    if (input.release) this.breathFromMs = undefined;
    else if (input.lastFloor) this.breathFromMs = input.nowMs;
    if (this.breathFromMs !== undefined && input.nowMs - this.breathFromMs >= BREATH_MAX_MS) this.breathFromMs = undefined;
    if (this.paused) return "paused";
    return this.breathFromMs === undefined ? "race" : "breath";
  }

  /** Forgets a held breath: a rewind starts the race's story over. */
  reset(): void {
    this.breathFromMs = undefined;
  }
}
