/**
 * The room's events, held until the drawn picture reaches them.
 *
 * Snapshots arrive ahead of the moment the client draws, so an event answered
 * on arrival would land before the picture showed it. This is the
 * `noteAt`/`reach` pattern `RespawnFlicker` uses for the room's resets. Each ID
 * is answered once, so a batch delivered twice (a reconnect, a lagged tab
 * catching up) starts nothing twice.
 */

import type { RaceEvent } from "@floor-fifty/shared/common/protocol";

/** How far behind the drawn tick an ID is kept, to refuse a late replay; then it is forgotten. */
const MEMORY_TICKS = 600;
/** How far behind the drawn tick an event may still be answered: half a second at 60 Hz. */
const STALE_TICKS = 30;

export class RoomBeats {
  private pending: RaceEvent[] = [];
  private readonly seen = new Map<string, number>();

  noteAt(events: readonly RaceEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.set(event.id, event.tick);
      this.pending.push(event);
    }
  }

  /**
   * The events the drawn tick has reached, oldest first; each is given once.
   * One the picture passed more than `STALE_TICKS` ago is dropped unanswered:
   * a tab back from the background would otherwise play every pop and burst
   * it missed in one frame.
   */
  reach(drawnTick: number): RaceEvent[] {
    if (this.pending.length === 0) return [];
    const due = this.pending
      .filter((event) => event.tick <= drawnTick && event.tick >= drawnTick - STALE_TICKS)
      .sort((a, b) => a.tick - b.tick);
    this.pending = this.pending.filter((event) => event.tick > drawnTick);
    for (const [id, tick] of this.seen) if (tick < drawnTick - MEMORY_TICKS) this.seen.delete(id);
    return due;
  }

  /** IDs still remembered. */
  get remembered(): number {
    return this.seen.size;
  }

  clear(): void {
    this.pending = [];
    this.seen.clear();
  }
}
