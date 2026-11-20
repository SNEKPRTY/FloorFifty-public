/**
 * Holding a room's clocks, for the browser suite.
 *
 * A select step, a reveal and the countdown each end on a tick of the room's
 * own clock, and that clock runs at the speed of whatever machine hosts it:
 * under load a room has been seen to lose seconds to a stalled process. A spec
 * that looks at a screen for as long as it needs to, or reloads a page and waits
 * for it to come back, cannot ask the machine for speed. It asks the room to keep
 * the screen up instead.
 *
 * Holding does not stop the room. Ticks keep coming, snapshots keep going out,
 * and a client that joins or comes back is still seated on the next tick, which
 * is why the room is not simply stopped. What stands still is the deadline: each
 * tick a held clock's end is pushed back by that tick, so the ticks left on the
 * step, the one number a client reads, stay what they were.
 *
 * A seat that drops while anything is held is held too. A spec that reloads a
 * page into a held step is waiting on a boot, the splash's fonts and song and
 * bundle behind a stalled machine, and the thirty seconds a dropped seat is
 * kept are as much a clock as the step's fifteen: a reload that outlasted them
 * came back to "Your last room has closed". So the seat's deadline in ticks is
 * pushed back with the rest, and Colyseus, which counts its reconnection
 * window in wall seconds from the moment of the drop, is asked to wait long
 * enough for any reload (`graceSeconds`).
 *
 * A hold lasts as long as someone is connected to look at the room. When the
 * last seat has dropped the room lets go of it (`RaceRoom.stepOnce`), so a spec
 * that ends with a clock still held leaves a room that closes like any other,
 * not one whose ghosts never expire.
 *
 * Only a test asks for this (`room-driver.ts`, behind its token); nothing in a
 * race reads or sets it.
 */

import { RECONNECT_GRACE_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { RaceState } from "@floor-fifty/shared/common/state";
import type { SelectStep } from "@floor-fifty/shared/room/select";
import { STEP_ORDER } from "@floor-fifty/shared/room/select";

/** A clock a room can be asked to hold: a select step, or the countdown after it. */
export type ClockName = SelectStep | "countdown";

export const CLOCK_NAMES: readonly ClockName[] = [...STEP_ORDER, "countdown"];

export function isClockName(value: unknown): value is ClockName {
  return typeof value === "string" && (CLOCK_NAMES as readonly string[]).includes(value);
}

/** Whether people sat in the room and every one of them has since dropped or left. CPUs do not look at a screen. */
export function abandonedByPeople(race: RaceState): boolean {
  const people = Object.values(race.players).filter((player) => !player.cpu);
  return people.length > 0 && people.every((player) => player.status !== "connected");
}

/** How long Colyseus keeps a seat that dropped while the room was held, in wall seconds. */
export const HELD_GRACE_SECONDS = 10 * 60;

/** The wall seconds a seat that has just dropped is kept for. */
export function graceSeconds(held: ReadonlySet<ClockName>): number {
  return held.size > 0 ? HELD_GRACE_SECONDS : RECONNECT_GRACE_TICKS / TICK_HZ;
}

/**
 * Called once per tick, after the tick has passed and before anything looks at
 * a deadline: pushes the end of the clock the room is on back by one tick, if
 * that clock is held, and every dropped seat's with it while anything is held. A
 * clock that is not running (the room is not in select, or not counting down)
 * has no end to move.
 */
export function holdClocks(race: RaceState, held: ReadonlySet<ClockName>): void {
  if (held.size === 0) return;
  for (const player of Object.values(race.players)) {
    if (player.ghostDeadlineTick !== undefined) player.ghostDeadlineTick += 1;
  }
  if (race.phase === "select" && race.select !== undefined && held.has(race.select.step)) {
    race.select.endsAtTick += 1;
  }
  if (race.phase === "countdown" && race.countdownEndsAtTick !== undefined && held.has("countdown")) {
    race.countdownEndsAtTick += 1;
  }
}
