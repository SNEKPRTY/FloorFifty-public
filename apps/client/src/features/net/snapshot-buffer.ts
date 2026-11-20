/**
 * Remote interpolation.
 *
 * Authority arrives at the snapshot rate while the screen draws at the display
 * rate, so remote players are rendered a little behind the newest snapshot and
 * interpolated between the pair that brackets that render time. Holding a delay
 * is what turns a 20 Hz feed into smooth motion without predicting anything.
 *
 * This buffer never extrapolates. Past the newest snapshot it holds, because a
 * guessed position that the next snapshot contradicts reads as a stutter, and
 * the client is not entitled to guess in the first place.
 *
 * Which moment to ask for is not this buffer's decision. `RenderClock` owns
 * that, because choosing it from the newest snapshot -- the obvious thing, and
 * what this module used to offer a helper for -- quantises the answer to packet
 * arrivals and leaves `sample` interpolating between a pair it has already
 * passed.
 */

import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { INTERPOLATION_DELAY_TICKS } from "../../lib/constants";

/** How much history to keep. Comfortably more than the interpolation delay. */
const WINDOW_TICKS = INTERPOLATION_DELAY_TICKS * 8;

/**
 * Horizontal distance past which a change is a wrap rather than movement.
 *
 * A player crossing the edge reappears on the far side; interpolating that pair
 * would drag them back across the whole viewport.
 */
const WRAP_THRESHOLD = VIEWPORT.width / 2;

export class SnapshotBuffer {
  private readonly snapshots: RoomSnapshot[] = [];

  get size(): number {
    return this.snapshots.length;
  }

  latest(): RoomSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /** The oldest tick still held: the earliest moment a slowed draw can show. */
  get oldestTick(): number | undefined {
    return this.snapshots[0]?.tick;
  }

  /**
   * Accepts a snapshot, ignoring one that arrives out of order.
   *
   * Transport reordering must never move a remote player backward, so a
   * snapshot at or before the newest tick is dropped rather than inserted.
   */
  push(snapshot: RoomSnapshot): void {
    const newest = this.latest();
    if (newest !== undefined && snapshot.tick <= newest.tick) return;

    this.snapshots.push(snapshot);

    const horizon = snapshot.tick - WINDOW_TICKS;
    while (this.snapshots.length > 2 && (this.snapshots[0]?.tick ?? 0) < horizon) {
      this.snapshots.shift();
    }
  }

  /** Interpolates one player's position between two authority states. */
  private blend(from: PlayerSnapshot, to: PlayerSnapshot, t: number): PlayerSnapshot {
    const wrapped = Math.abs(to.x - from.x) > WRAP_THRESHOLD;
    return {
      // Discrete state comes from the older snapshot: at the render time being
      // sampled, the newer one has not happened yet.
      ...from,
      x: wrapped ? to.x : from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      facingRight: to.facingRight,
    };
  }

  /**
   * The room as it looked at `renderTick`.
   *
   * Outside the buffered range this is the nearest snapshot verbatim, so a
   * caller always receives a real authority state rather than an invented one.
   */
  sample(renderTick: number): RoomSnapshot {
    const oldest = this.snapshots[0];
    const newest = this.latest();
    if (oldest === undefined || newest === undefined) {
      throw new Error("the snapshot buffer is empty");
    }
    if (renderTick <= oldest.tick) return oldest;
    if (renderTick >= newest.tick) return newest;

    let before = oldest;
    let after = newest;
    for (let index = 0; index < this.snapshots.length - 1; index += 1) {
      const candidate = this.snapshots[index]!;
      const next = this.snapshots[index + 1]!;
      if (renderTick < candidate.tick || renderTick > next.tick) continue;
      before = candidate;
      after = next;
      break;
    }

    const span = after.tick - before.tick;
    const t = span === 0 ? 0 : (renderTick - before.tick) / span;

    const previous = new Map<PlayerId, PlayerSnapshot>(
      before.players.map((player) => [player.id, player]),
    );

    const players = after.players.map((player) => {
      const earlier = previous.get(player.id);
      // A player who appears only in the newer snapshot has nothing to
      // interpolate from, so they are shown where authority says they are.
      return earlier === undefined ? player : this.blend(earlier, player, t);
    });

    return { ...before, players, events: after.events };
  }

  clear(): void {
    this.snapshots.length = 0;
  }
}
