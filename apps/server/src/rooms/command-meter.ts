/**
 * Each seat's command budget: a token bucket on the room clock (audit B2).
 *
 * `input` and `ping` had budgets of their own; every other command was parsed,
 * handled, projected and answered without one, so a script that looped on any
 * of them cost every room on the process. A seat banks up to
 * `COMMAND_BUDGET.burst` commands and earns `COMMAND_BUDGET.perSecond` back a
 * second. Over budget the command is dropped: no handler, no projection, no
 * answer. Measured on the room clock, as the input budget is, so a client
 * cannot widen it by stalling the server.
 *
 * No I/O and no timer: credit is worked out from the tick at each spend, so an
 * idle seat costs nothing per tick.
 */

import { COMMAND_BUDGET, TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";

type Credit = { credits: number; tick: number };

export class CommandMeter {
  private readonly seats = new Map<PlayerId, Credit>();

  /** Spends one command for `playerId` at room tick `tick`, and says whether there was one to spend. */
  spend(playerId: PlayerId, tick: number): boolean {
    const held = this.seats.get(playerId);
    const earned = held === undefined ? 0 : Math.max(0, tick - held.tick) * (COMMAND_BUDGET.perSecond / TICK_HZ);
    const credits = Math.min(COMMAND_BUDGET.burst, (held?.credits ?? COMMAND_BUDGET.burst) + earned);
    const allowed = credits >= 1;
    this.seats.set(playerId, { credits: allowed ? credits - 1 : credits, tick });
    return allowed;
  }

  /** Drops a seat's budget, for a player who has left for good. */
  forget(playerId: PlayerId): void {
    this.seats.delete(playerId);
  }
}
