/**
 * Reading a race result off a snapshot.
 *
 * There is no code path here that orders players or picks a winner. The order
 * comes from `snapshot.standings` and the winner from `snapshot.winnerId`, both
 * decided by the server. If the snapshot does not say, these do not say either.
 *
 * Kept as plain functions so the screen and the panel that draws it share one
 * implementation. Two copies of "who came first" is exactly how a client grows
 * an opinion about a race it does not own.
 */

import { modeName as localisedModeName } from "../i18n/content";
import * as m from "../../paraglide/messages.js";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";

/** Ticks as `m:ss.hh`, the results screen's precision. */
function formatResultTime(ticks: number): string {
  const totalMs = ticks * TICK_MS;
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const hundredths = Math.floor((totalMs % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/**
 * Whether this racer never started. A DNS the room keeps because the racer
 * left is not one if they finished or went out first (audit S12): a player
 * reads "DNS" as "did not start", so such a racer's row stays the finished row
 * it is, with its place and its time.
 */
export function didNotStart(player: PlayerSnapshot): boolean {
  return player.status === "dns" && player.finishedAtTick === undefined && player.outAtTick === undefined;
}

/** Formats a finish time, or says why there isn't one. */
export function resultTime(player: PlayerSnapshot): string {
  if (didNotStart(player)) return m.race_status_dns();
  if (player.finishedAtTick === undefined) return "—";
  return formatResultTime(player.finishedAtTick);
}

/** A Survival result: the best floor and when it was reached, or when the racer went out (survival spec §7). */
export function resultBest(player: PlayerSnapshot): string {
  if (player.outAtTick !== undefined) return m.results_out_at({ floor: player.bestFloor, time: formatResultTime(player.outAtTick) });
  if (player.bestFloorAtTick === undefined) return m.results_best_floor({ floor: player.bestFloor });
  return m.results_best_floor_at({ floor: player.bestFloor, time: formatResultTime(player.bestFloorAtTick) });
}

/**
 * One racer's result as the list says it: a Survival race's best floor and
 * when, a finisher's time, and for a floors race's non-finisher how far they
 * got, never a dash (a racer who never started still says so).
 */
export function resultLine(player: PlayerSnapshot, snapshot: RoomSnapshot | undefined): string {
  if (didNotStart(player)) return m.race_status_dns();
  if (endedOnClock(snapshot)) return resultBest(player);
  if (player.finishedAtTick === undefined) return m.results_best_floor({ floor: player.bestFloor });
  return formatResultTime(player.finishedAtTick);
}

/** Whether a race ended on a clock rather than at a top floor. */
export function endedOnClock(snapshot: RoomSnapshot | undefined): boolean {
  return (snapshot?.tuning.RACE_TIME_LIMIT_TICKS ?? 0) > 0;
}

/** The mode's name for the results header, from the catalog; nothing for an unknown mode. */
export function modeName(
  snapshot: RoomSnapshot | undefined,
  modes: readonly { readonly id: string; readonly displayName: string }[],
): string | undefined {
  const mode = modes.find((candidate) => candidate.id === snapshot?.modeId);
  return mode === undefined ? undefined : localisedModeName(mode);
}

/** The winner's name as the server named them, or nothing. */
export function winnerName(snapshot: RoomSnapshot | undefined): string | undefined {
  if (snapshot?.winnerId === undefined) return undefined;
  return snapshot.players.find((player) => player.id === snapshot.winnerId)?.name;
}

/**
 * Results in the server's finish order.
 *
 * Players the server never placed follow, without a place of their own (the
 * client does not invent one), but in the order a reader expects: the higher
 * floor first, then whoever reached it first; one who never started is last.
 */
export function orderedResults(snapshot: RoomSnapshot | undefined): PlayerSnapshot[] {
  if (snapshot === undefined) return [];

  const byId = new Map(snapshot.players.map((player) => [player.id, player]));
  const placed = snapshot.standings
    .map((id) => byId.get(id))
    .filter((player): player is PlayerSnapshot => player !== undefined);

  const placedIds = new Set(placed.map((player) => player.id));
  const unplaced = snapshot.players
    .filter((player) => !placedIds.has(player.id))
    .map((player, roster) => ({ player, roster }))
    .sort(
      (a, b) =>
        Number(didNotStart(a.player)) - Number(didNotStart(b.player)) ||
        b.player.bestFloor - a.player.bestFloor ||
        (a.player.bestFloorAtTick ?? Infinity) - (b.player.bestFloorAtTick ?? Infinity) ||
        a.roster - b.roster,
    )
    .map(({ player }) => player);
  return [...placed, ...unplaced];
}

/**
 * Whether the server gave this player a place at all. A DNS never has one:
 * Infinite's standings list them after the placed racers (race-options spec
 * §5.2), and that order is not a place.
 */
export function wasPlaced(snapshot: RoomSnapshot | undefined, player: PlayerSnapshot): boolean {
  // A Survival racer who went out and then left keeps the place the fall earned (survival spec §4).
  // So does one who finished and then left the results: the room keeps their row as a DNS (audit S12).
  return !didNotStart(player) && snapshot?.standings.includes(player.id) === true;
}

/**
 * The placed racers whose result matches another placed racer's: the same
 * finish tick, or on a clock the same best floor reached on the same tick.
 *
 * Not an order and not a winner: the server still resolves a tie to one order
 * (`step.ts`) and one winner, and those stand. This only says that the order
 * between these racers was the server's tie-break, not a gap on the clock.
 */
export function tiedResults(snapshot: RoomSnapshot | undefined): ReadonlySet<string> {
  if (snapshot === undefined) return new Set();
  const onClock = endedOnClock(snapshot);
  const keyOf = (player: PlayerSnapshot): string | undefined => {
    if (!wasPlaced(snapshot, player) || player.finishedAtTick === undefined) return undefined;
    // On a clock, two racers tie only if they went out together (or both stood) on the same best floor at the same tick.
    return onClock
      ? `${player.outAtTick ?? "standing"}:${player.bestFloor}:${player.bestFloorAtTick ?? "never"}`
      : String(player.finishedAtTick);
  };
  const byKey = new Map<string, string[]>();
  for (const player of snapshot.players) {
    const key = keyOf(player);
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), player.id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

/** A result's parts, split at " · ", so each can be kept whole on one line. */
export function resultParts(line: string): string[] {
  return line.split(" · ");
}
