/**
 * The respawn flicker (race-flow spec §5.1).
 *
 * A fall's cue: the racer's body blinks, its nameplate stays solid. Keyed by
 * event ID so nothing replays it; started on the render clock, at once for the
 * local prediction and at the drawn moment for the room's batch.
 */

import type { RaceEvent } from "@floor-fifty/shared/common/protocol";

/** How long the body blinks after a reset. */
export const FLICKER_MS = 600;
/** Blinks per second: dim and solid each take half of one. */
export const FLICKER_HZ = 12;
/** The dim half's alpha: faint, never gone, so the racer is never lost. */
export const FLICKER_LOW_ALPHA = 0.2;
/** Reduced motion: a steady half alpha for the same 0.6 s instead of a blink. */
const REDUCED_ALPHA = 0.5;

/**
 * A fall's cue (race-flow spec §5.1): the racer's body blinks for 0.6 s.
 * Keyed by event ID, so a replayed snapshot, or the room confirming a reset
 * already predicted, never starts it again. It grants nothing; the game has
 * no damage. A lap is not a reset and emits none, so it never plays there.
 */
export class RespawnFlicker {
  private readonly seen = new Set<string>();
  private readonly since = new Map<string, number>();
  private pending: RaceEvent[] = [];

  /** Starts now: the local racer's predicted reset, drawn as it happens. */
  note(events: readonly RaceEvent[], nowMs: number): void {
    for (const event of events) {
      if (event.type !== "playerReset" || this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      this.since.set(event.playerId, nowMs);
    }
  }

  /**
   * Starts when the drawn moment reaches the event's tick: the room's batch
   * arrives an interpolation delay before its racers are drawn there, and a
   * blink on arrival would blink a racer still falling.
   */
  noteAt(events: readonly RaceEvent[]): void {
    for (const event of events) {
      if (event.type !== "playerReset" || this.seen.has(event.id)) continue;
      if (this.pending.some((queued) => queued.id === event.id)) continue;
      this.pending.push(event);
    }
  }

  /** Starts every queued reset the drawn moment has now reached. */
  reach(drawnTick: number, nowMs: number): void {
    const due = this.pending.filter((event) => event.tick <= drawnTick);
    if (due.length === 0) return;
    this.pending = this.pending.filter((event) => event.tick > drawnTick);
    this.note(due, nowMs);
  }

  alpha(playerId: string, nowMs: number, reduced: boolean): number {
    const start = this.since.get(playerId);
    if (start === undefined) return 1;
    const age = nowMs - start;
    if (age >= FLICKER_MS || age < 0) {
      this.since.delete(playerId);
      return 1;
    }
    if (reduced) return REDUCED_ALPHA;
    const half = Math.floor((age * FLICKER_HZ * 2) / 1000);
    return half % 2 === 0 ? FLICKER_LOW_ALPHA : 1;
  }

  clear(): void {
    this.seen.clear();
    this.since.clear();
    this.pending = [];
  }
}
