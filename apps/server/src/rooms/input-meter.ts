/**
 * Each seat's input budget: a token bucket on the room clock.
 *
 * A player may bank up to one second of frames and spends one per accepted
 * frame, refilling a little faster than the tick rate so ordinary play never
 * touches the limit. Budgets are measured on the room clock rather than wall
 * time, so a client cannot widen them by stalling the server.
 *
 * A frame over budget is dropped, never answered with a disconnect: a burst is
 * far more often a slow frame than an attack, and dropping costs the player
 * one tick of intent.
 *
 * No I/O and no clock: the room calls `refill` once per tick.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";

/** The most frames a seat can bank: one second's worth. */
export const INPUT_CREDIT_CAPACITY = TICK_HZ;

/** Frames a seat earns back per room tick. */
export const INPUT_CREDITS_PER_TICK = 2;

export class InputMeter {
  private readonly credits = new Map<PlayerId, number>();

  /** Gives a seat a full budget: on joining, and again on reconnecting. */
  fill(playerId: PlayerId): void {
    this.credits.set(playerId, INPUT_CREDIT_CAPACITY);
  }

  /**
   * Spends one frame's credit.
   *
   * Returns false when the seat is out of credit, and the caller drops the
   * frame. A seat the meter has never seen has no credit.
   */
  spend(playerId: PlayerId): boolean {
    const credits = this.credits.get(playerId) ?? 0;
    if (credits <= 0) return false;
    this.credits.set(playerId, credits - 1);
    return true;
  }

  /** Earns each listed seat one tick's credit, up to the cap. Once per tick. */
  refill(playerIds: Iterable<PlayerId>): void {
    for (const playerId of playerIds) {
      const credits = this.credits.get(playerId) ?? 0;
      this.credits.set(playerId, Math.min(INPUT_CREDIT_CAPACITY, credits + INPUT_CREDITS_PER_TICK));
    }
  }

  /** Drops a seat's budget, for a player who has left for good. */
  forget(playerId: PlayerId): void {
    this.credits.delete(playerId);
  }
}
