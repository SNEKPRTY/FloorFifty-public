/**
 * The countdown on the stage (race-flow spec §3.4).
 *
 * Which of 3, 2, 1 and GO shows this frame, from the room's end tick and the
 * render clock's estimate of authority. Pure, so it is tested without Pixi or
 * the DOM; `Countdown.svelte` draws what it says.
 */

import { TICK_HZ, TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";

/** What the count shows: a whole second, or GO from the end tick. */
export type CountLabel = "3" | "2" | "1" | "GO";

/**
 * How long GO stays up after the end tick (race-flow spec §3.4). The burst in
 * `Countdown.svelte` runs the same 600 ms; this is what clears the label.
 */
export const GO_SHOWS_MS = 600;

/**
 * The count over the stage, read from the room's own end tick against the
 * render clock's estimate of authority, so every screen says "2" on the same
 * tick. The end tick is remembered, because racing snapshots no longer carry
 * it and GO shows after it.
 */
export class CountdownClock {
  private endsAt: number | undefined;

  observe(snapshot: Pick<RoomSnapshot, "phase" | "countdownEndsAtTick">): void {
    if (snapshot.phase === "countdown" && snapshot.countdownEndsAtTick !== undefined) {
      this.endsAt = snapshot.countdownEndsAtTick;
    }
  }

  label(authorityTick: number | undefined): CountLabel | undefined {
    if (this.endsAt === undefined || authorityTick === undefined) return undefined;
    const remaining = this.endsAt - authorityTick;
    if (remaining > 0) return String(Math.min(3, Math.ceil(remaining / TICK_HZ))) as CountLabel;
    return -remaining * TICK_MS < GO_SHOWS_MS ? "GO" : undefined;
  }
}
