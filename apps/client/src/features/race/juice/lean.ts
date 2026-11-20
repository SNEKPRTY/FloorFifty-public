/**
 * Racers lean into their motion (Wonder spec §4.1): each sprite skews toward
 * its drawn sideways velocity on its own spring, so a turn swings through
 * upright with a little overshoot. Drawn on `lean.stepDeg` steps, so it reads
 * as pixel art. Drawing only: nothing here reaches the hitbox or the race.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { JuiceTuning } from "@floor-fifty/shared/content/game-content";
import { SecondOrder, snapTo } from "../../../lib/second-order";

const DEG = Math.PI / 180;
/** How far past the cap a turn's overshoot may draw. */
const LEAN_OVERSHOOT = 1.25;

/** The lean a racer moving at `vx` springs toward: against the motion's sign (skew.x < 0 leans right), capped. */
export function leanTarget(vx: number, lean: JuiceTuning["lean"]): number {
  const share = Math.max(-1, Math.min(1, vx / lean.fullSpeed));
  const target = -share * lean.maxDeg * DEG;
  return target === 0 ? 0 : target;
}

/** Each racer's lean on its own spring. */
export class LeanBook {
  private readonly springs = new Map<PlayerId, SecondOrder>();
  private readonly braces = new Map<PlayerId, { readonly target: number; readonly untilMs: number }>();
  private step = 3 * DEG;
  /** The most a drawn lean may show: a quarter over the cap, whatever the spring is tuned to. */
  private limit = 15 * DEG;

  /** Sharp lateral brace tilt toward a contacted wall face. */
  brace(id: PlayerId, towardLeft: boolean, nowMs: number): void {
    const target = (towardLeft ? -18 : 18) * DEG;
    this.braces.set(id, { target, untilMs: nowMs + 100 });
  }

  /** Steps every racer's lean toward its motion, except the frozen one's (hit-stop). */
  update(
    racers: readonly { readonly id: PlayerId; readonly vx: number }[],
    dtSeconds: number,
    tuning: JuiceTuning,
    frozenId?: PlayerId,
  ): void {
    this.step = tuning.lean.stepDeg * DEG;
    this.limit = tuning.lean.maxDeg * LEAN_OVERSHOOT * DEG;
    for (const racer of racers) {
      let spring = this.springs.get(racer.id);
      if (spring === undefined) {
        spring = new SecondOrder(tuning.springs.lean);
        this.springs.set(racer.id, spring);
      }
      spring.retune(tuning.springs.lean);
      if (racer.id !== frozenId) spring.update(dtSeconds, leanTarget(racer.vx, tuning.lean));
    }
  }

  /** A racer's lean as drawn, in radians on whole steps. */
  drawnOf(id: PlayerId, nowMs?: number): number {
    if (nowMs !== undefined) {
      const activeBrace = this.braces.get(id);
      if (activeBrace !== undefined) {
        if (nowMs < activeBrace.untilMs) {
          return activeBrace.target;
        }
        this.braces.delete(id);
      }
    }
    const value = this.springs.get(id)?.value ?? 0;
    // Clamped onto a whole step inside the limit: a loose spring overshoots, the drawing never runs away.
    const bound = Math.floor(this.limit / this.step + 1e-9) * this.step;
    return snapTo(Math.max(-bound, Math.min(bound, value)), this.step);
  }

  forget(id: PlayerId): void {
    this.springs.delete(id);
    this.braces.delete(id);
  }

  /** Every racer upright at once: reduced motion, a restart. */
  settle(): void {
    this.braces.clear();
    for (const spring of this.springs.values()) spring.set(0);
  }
}

