/**
 * The victory sequence (race-flow spec §5.2).
 *
 * How fast presentation time runs through the finish, measured on wall time.
 * Pure; Gameplay feeds its scale to the render clock, the scene and the song.
 */

/** The slowest presentation runs: a quarter, while the winner's landing plays. */
export const SLOW_SCALE = 0.25;
/** The ease from full speed down to `SLOW_SCALE`. */
export const EASE_MS = 150;
/** How long the slow motion holds before Results, in wall time. */
export const HOLD_MS = 1_200;
/** Published by a timer if frames stop, as they do in a hidden tab. */
export const STALL_FALLBACK_MS = 2_000;

/**
 * The winner's last landing, slowed on every screen (race-flow spec §5.2):
 * presentation time eases to a quarter over 150 ms and holds for 1.2 s of
 * wall time, then hands off to Results. Reduced motion keeps the hold and
 * drops the slow-down. Wall time, not presentation time, measures it.
 */
export class FinishSequence {
  constructor(
    private readonly startedAtMs: number,
    private readonly reduced: boolean,
  ) {}

  scale(nowMs: number): number {
    if (this.reduced) return 1;
    const t = Math.max(0, nowMs - this.startedAtMs);
    return t >= EASE_MS ? SLOW_SCALE : 1 - (1 - SLOW_SCALE) * (t / EASE_MS);
  }

  done(nowMs: number): boolean {
    return nowMs - this.startedAtMs >= (this.reduced ? HOLD_MS : EASE_MS + HOLD_MS);
  }
}
