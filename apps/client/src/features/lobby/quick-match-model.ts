/**
 * What a public ready room says about its clocks (quick-match spec §7.3).
 *
 * Pure reads of a snapshot: the room decides the clocks, and this only words
 * them. Seconds are drawn from ticks as the countdown is, so every client shows
 * the same clock however late it connected.
 */

import * as m from "../../paraglide/messages.js";
import { QUICK_MATCH_START_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";

export type QuickMatchClock =
  | { kind: "searching"; seconds: number }
  | { kind: "solo-ready" }
  | { kind: "starting"; seconds: number };

const secondsUntil = (snapshot: RoomSnapshot, tick: number): number =>
  Math.max(0, Math.ceil((tick - snapshot.tick) / TICK_HZ));

/** The clock a public lobby is running, or undefined: private, not the lobby, or no snapshot. */
export function quickMatchClock(snapshot: RoomSnapshot | undefined): QuickMatchClock | undefined {
  if (snapshot === undefined || snapshot.access !== "public" || snapshot.phase !== "lobby") return undefined;
  if (snapshot.startsAtTick !== undefined) {
    return { kind: "starting", seconds: secondsUntil(snapshot, snapshot.startsAtTick) };
  }
  if (snapshot.soloFromTick !== undefined) {
    return snapshot.tick < snapshot.soloFromTick
      ? { kind: "searching", seconds: secondsUntil(snapshot, snapshot.soloFromTick) }
      : { kind: "solo-ready" };
  }
  return undefined;
}

/** `m:ss`. */
export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The ready room's status line while a clock runs. */
export function clockLine(clock: QuickMatchClock): string {
  switch (clock.kind) {
    case "searching":
      return m.ready_clock_searching({ clock: formatClock(clock.seconds) });
    case "starting":
      return m.ready_clock_starting({ clock: formatClock(clock.seconds) });
    case "solo-ready":
      return m.ready_clock_solo();
  }
}

/** The Ready button's text: Race CPUs while alone, Not ready for a racer who is ready. */
export function readyLabel(clock: QuickMatchClock | undefined, localIsReady: boolean): string {
  if (localIsReady) return m.ready_not_ready();
  return clock?.kind === "searching" || clock?.kind === "solo-ready" ? m.ready_race_cpus() : m.ready_ready();
}

/**
 * What a screen reader hears once, when a clock begins. Never each second.
 *
 * The start clock says the seconds left when it was heard, not the full thirty:
 * a racer who joins with twelve to go is told twelve.
 */
export function announcementFor(
  kind: QuickMatchClock["kind"] | undefined,
  seconds: number = QUICK_MATCH_START_TICKS / TICK_HZ,
): string {
  switch (kind) {
    case "starting":
      return m.ready_start_announcement({ seconds });
    case "searching":
      return m.ready_announce_searching();
    case "solo-ready":
      return m.ready_announce_solo();
    case undefined:
      return "";
  }
}
