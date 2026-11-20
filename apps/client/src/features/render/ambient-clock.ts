/**
 * The ambient clock.
 *
 * The one thing that advances the optical effects: the refraction phase, the
 * cloud drift, the caustics, the window twinkle. It exists so those four cannot
 * disagree about what time it is, and so the uncomfortable cases -- a hidden
 * tab, a player who turns reduced motion on mid-race -- are answered once
 * rather than four times.
 *
 * Three rules, and each is a bug that shipped somewhere else first:
 *
 * 1. **A foreground delta is clamped to 100ms.** A frame that took a second --
 *    a garbage collection, a tab regaining focus -- must not advance the optics
 *    by a second, or the refraction jumps to a phase nothing eased into.
 *
 * 2. **The first delta after a resume is discarded.** A tab that was hidden for
 *    a minute has one enormous delta waiting for it. Without this the effect
 *    lurches forward by exactly the time the player was not watching, which is
 *    the one thing a background tab must never cost.
 *
 * 3. **Reduced motion freezes rather than pauses.** The optical time stops at
 *    the still pose, not at zero and not wherever it happened to be. Reduced
 *    motion means the picture arrives, never that it disappears -- and a frozen
 *    loop phase is a still image, while a paused one at an arbitrary phase is
 *    an arbitrary image.
 */

import { DAWN_REFRACTION_STILL_SECONDS } from "./filters/dawn-refraction";

/**
 * The longest delta that may advance ambient time, in milliseconds.
 *
 * About six frames at 60 Hz. Large enough that an ordinary hitch costs nothing
 * noticeable, small enough that a stall cannot teleport the phase.
 */
export const AMBIENT_DELTA_CLAMP_MS = 100;

export class AmbientClock {
  private elapsedSeconds = 0;
  private hidden = false;
  private reduced = false;
  /**
   * Set when time resumes, and consumed by the next advance.
   *
   * A flag rather than a timestamp comparison because the delta the caller
   * hands over is already the thing that is wrong; comparing it against a
   * wall-clock reading would need a second clock to disagree with.
   */
  private discardNextDelta = false;

  /**
   * Advances by `deltaMs` and returns the ambient time in seconds.
   *
   * Called once per rendered frame by whichever controller owns the effect.
   */
  advance(deltaMs: number): number {
    // Hidden first: nothing may move while the player is not looking, including
    // a reduced-motion freeze that would otherwise happen off screen.
    if (this.hidden) return this.seconds;

    if (this.discardNextDelta) {
      this.discardNextDelta = false;
      return this.seconds;
    }

    if (this.reduced) {
      this.elapsedSeconds = DAWN_REFRACTION_STILL_SECONDS;
      return this.seconds;
    }

    const clamped = Math.min(Math.max(0, deltaMs), AMBIENT_DELTA_CLAMP_MS);
    this.elapsedSeconds += clamped / 1_000;
    return this.seconds;
  }

  /**
   * Reports the document's visibility.
   *
   * Resuming discards the next delta; hiding does not, because the delta that
   * arrives while hidden is already ignored by the guard above.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!hidden) this.discardNextDelta = true;
  }

  /**
   * Reports the motion preference, which can change while the game is open.
   *
   * Turning it on freezes the clock at the still pose immediately, so the
   * change is visible on the frame it is made rather than on the next advance.
   * Turning it off resumes without catch-up, exactly as a tab does.
   */
  setReducedMotion(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    if (reduced) this.elapsedSeconds = DAWN_REFRACTION_STILL_SECONDS;
    else this.discardNextDelta = true;
  }

  get seconds(): number {
    return this.elapsedSeconds;
  }
}
