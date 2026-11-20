/**
 * The race HUD's model.
 *
 * A pure function from one authority snapshot to everything the HUD shows, with
 * no Pixi, no DOM and no state. It exists so the numbers can be tested without a
 * renderer -- and, more importantly, so the move from the drawn HUD to the DOM
 * one could happen without re-deriving any of them.
 *
 * Three rules, and each is a way a HUD starts lying:
 *
 * 1. **Snapshot order is seat order.** A row's index is its seat, which is
 *    identity rather than rank. Sorting the roster by measured progress would
 *    invent a standings table the server never issued, and it would reshuffle
 *    rows while a player is reading them.
 * 2. **Nothing here is predicted.** The caller passes the same interpolated
 *    snapshot the world is drawn from. A HUD fed the local prediction would
 *    report a floor a round trip before the server agreed, and would have to
 *    take it back.
 * 3. **Finished means finished.** A racer's clock stops at their own result, and
 *    the roster says so in words, so status is never carried by colour alone.
 */

import * as m from "../../paraglide/messages.js";
import { TICK_HZ, TICK_MS } from "@floor-fifty/shared/common/constants";
import { floorIndexAt, isEndless } from "@floor-fifty/shared/simulation/endless";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { SeatScarf } from "../../lib/constants";

export type HudRow = Readonly<{
  id: PlayerId;
  /** The seat's position in the room, which is identity and not rank. */
  seat: number;
  name: string;
  scarf: SeatScarf;
  local: boolean;
  /** The ascent, 0..1, clamped. Authority's number, never a measurement. */
  progress: number;
  status: PlayerSnapshot["status"];
  /**
   * The seat said in words: number, name, and status when not racing. The
   * portrait pip's accessible name, since the pip itself is only a colour.
   */
  label: string;
  /** The lap this racer is on; another racer's chip shows it. */
  lap: number;
  /** Whether this racer's lap chip is pulsing for a lap just completed (race-flow spec §4.1). */
  pulse: boolean;
  /** In Infinite, whether this racer holds the best floor (race-options spec §5.5). Never in a finite race. */
  leader: boolean;
  /** In Survival, whether this racer fell below their edge and is out (survival spec §7). */
  out: boolean;
}>;

/** Infinite's own readouts (race-options spec §5.5). */
export type EndlessHud = Readonly<{
  /** The time left, `m:ss`, rounded up to the second. */
  clock: string;
  /** From 0:10 left; the view enlarges the digits, never only recolours them. */
  urgent: boolean;
  /** The floor the local racer is at now. */
  floor: number;
  /** The local racer's best floor. */
  best: number;
}>;

/**
 * A racer's status as a word, or `""` while connected and racing.
 *
 * Beside the seat colour rather than standing in for it: colour is the one
 * channel a player with a colour-vision difference cannot read.
 */
export function statusWord(status: PlayerSnapshot["status"]): string {
  // A ghost is a racer who dropped and whose seat is held for a reconnect.
  const words: Partial<Record<PlayerSnapshot["status"], string>> = {
    dns: m.race_status_dns(),
    ghost: m.race_status_offline(),
  };
  return words[status] ?? "";
}

export type HudModel = Readonly<{
  collected: number;
  floorCount: number;
  lap: number;
  lapCount: number;
  /** `m:ss.t`, including the local player's own finish time once they have one. */
  elapsed: string;
  /** The touch restart button's accessible name: what its face shows, and what it does. */
  restart: string;
  rows: readonly HudRow[];
  /** "LAP 2" or "FINAL LAP" while the local racer is held after a lap (race-flow spec §4.1). */
  lapBanner?: string;
  /** Present in an endless race only. */
  endless?: EndlessHud;
  /** Survival's danger, 0 to 1: how close the local racer is to their edge (survival spec §7). 0 otherwise. */
  danger: number;
  /** "OUT!" once the local racer has gone out in Survival. */
  outBanner?: string;
  /** Why, in one line under "OUT!": the lava caught her, and the race goes on. Present with `outBanner`. */
  outLine?: string;
  /**
   * The local racer's Survival edge is waiting for her first input
   * (first-race spec part 2), so the race asks her to start. False for a
   * watcher with no seat, a dropped seat, a racer already out, a finite race
   * and the countdown: none of them can be asked to press anything.
   */
  awaitingStart: boolean;
}>;

/** How close a racer is to their edge, 0 (a third of a view clear) to 1 (on it), eased (survival spec §7). */
export function survivalDanger(y: number, edgeY: number, tuning: Pick<ResolvedTuning, "SURVIVAL_VIEW_HEIGHT">): number {
  const t = Math.min(1, Math.max(0, 1 - (y - edgeY) / (0.35 * tuning.SURVIVAL_VIEW_HEIGHT)));
  return t * t * (3 - 2 * t);
}

/** Ticks left on an endless race's clock, read against `clockTick`, never below zero. */
export function endlessTicksLeft(
  snapshot: Pick<RoomSnapshot, "tuning" | "raceStartedAtTick">,
  clockTick: number,
): number {
  const limit = snapshot.tuning.RACE_TIME_LIMIT_TICKS;
  return Math.max(0, limit - (clockTick - (snapshot.raceStartedAtTick ?? clockTick)));
}

/** Seconds left on an endless race's clock, read against the authority tick, never below zero. */
function endlessHud(snapshot: RoomSnapshot, local: PlayerSnapshot | undefined, clockTick: number): EndlessHud {
  const remaining = endlessTicksLeft(snapshot, clockTick);
  const seconds = Math.ceil(remaining / TICK_HZ);
  return {
    clock: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    urgent: remaining > 0 && remaining <= 10 * TICK_HZ,
    floor: floorIndexAt(local?.y ?? 0, snapshot.tuning, Math.max(1, snapshot.floorCount)),
    best: local?.bestFloor ?? 0,
  };
}

/**
 * Ticks the local player's clock should read.
 *
 * A finished player's clock stops at their own result; everyone else's runs
 * against the room's race start. Exported because both the HUD and any
 * world-space readout draw it, and the two must never disagree.
 *
 * `raceStartedAtTick` is absent before the room starts racing, and a clock that
 * subtracted `undefined` would read as the whole tick count. Falling back to the
 * current tick makes it zero, which is what a race that has not begun is worth.
 */
export function elapsedTicks(snapshot: RoomSnapshot, localPlayerId: PlayerId | undefined): number {
  const local = snapshot.players.find((player) => player.id === localPlayerId);
  const running = Math.max(0, snapshot.tick - (snapshot.raceStartedAtTick ?? snapshot.tick));
  return local?.finishedAtTick ?? running;
}

/** Formats race time as `m:ss.t`, which stays readable at a glance while racing. */
export function formatElapsed(ticks: number): string {
  const totalMs = ticks * TICK_MS;
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const tenths = Math.floor((totalMs % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Whether the local racer's Survival edge is waiting for her first input
 * (first-race spec part 2), so the race asks her to start. The one reading
 * the HUD's prompt and the screen's start pulse share, so they never disagree.
 */
export function awaitingStart(snapshot: RoomSnapshot, localId: PlayerId | undefined): boolean {
  const local = snapshot.players.find((player) => player.id === localId);
  return (
    isEndless(snapshot.tuning) &&
    snapshot.phase === "racing" &&
    local?.status === "connected" &&
    local.awaitingInput &&
    local.outAtTick === undefined
  );
}

/**
 * Reads one snapshot into everything the HUD shows.
 *
 * `localId` may be absent -- before the first join resolves, or after a
 * reconnect has not yet been given a seat -- and every local figure then reads
 * as the state of a race nobody is in: no floors, lap one, and the room's own
 * clock. That is a legible frame rather than a blank one.
 */
export function hudModel(snapshot: RoomSnapshot, localId?: PlayerId, clockTick = snapshot.tick): HudModel {
  const local = snapshot.players.find((player) => player.id === localId);
  const held = local?.holdUntilTick !== undefined && snapshot.tick < local.holdUntilTick;
  const lapBanner = !held ? undefined : local!.lap >= snapshot.lapCount ? m.race_final_lap() : m.race_lap_banner({ lap: local!.lap });
  // Infinite ranks by best floor (D-O3), but seat order stays the identity
  // (rule 1): each row's bar is its best against the leader's, and the leader
  // is marked, rather than the rows being reordered.
  const endless = isEndless(snapshot.tuning);
  const leaderBest = Math.max(0, ...snapshot.players.map((player) => player.bestFloor ?? 0));
  const endlessView = endless ? endlessHud(snapshot, local, clockTick) : undefined;
  const elapsed = formatElapsed(elapsedTicks(snapshot, localId));

  const out = endless && local?.outAtTick !== undefined;

  return {
    ...(lapBanner === undefined ? {} : { lapBanner }),
    ...(endlessView === undefined ? {} : { endless: endlessView }),
    ...(out ? { outBanner: m.race_out(), outLine: m.race_out_line() } : {}),
    awaitingStart: awaitingStart(snapshot, localId),
    danger: endless && local !== undefined && !out ? survivalDanger(local.y, local.floorEdgeY, snapshot.tuning) : 0,
    // Progress is a fraction of the ascent, so the count is it read back
    // against the floor count the same snapshot carries.
    collected: local === undefined ? 0 : Math.round(local.progress * snapshot.floorCount),
    floorCount: snapshot.floorCount,
    lap: local?.lap ?? 1,
    lapCount: snapshot.lapCount,
    elapsed,
    restart: endlessView === undefined ? m.race_restart_at({ time: elapsed }) : m.race_restart_left({ clock: endlessView.clock }),
    // `map` rather than a sort: the server's order is the answer, and the seat
    // is the index because that is what the room means by a seat.
    rows: snapshot.players.map((player, seat) => {
      const leader = endless && leaderBest > 0 && player.bestFloor === leaderBest;
      return {
        id: player.id,
        seat,
        name: player.name,
        // The player's colour, not the seat's (select spec §6.7).
        scarf: player.colour,
        local: player.id === localId,
        progress: endless
          ? leaderBest === 0
            ? 0
            : (player.bestFloor ?? 0) / leaderBest
          : Math.min(1, Math.max(0, player.progress)),
        status: player.status,
        label: [
          endless ? m.race_row_best({ seat: seat + 1, name: player.name, best: player.bestFloor ?? 0 }) : `${seat + 1} ${player.name}`,
          statusWord(player.status),
          player.outAtTick !== undefined ? m.race_status_out() : "",
          leader ? m.race_row_leads() : "",
        ]
          .filter(Boolean)
          .join(", "),
        lap: player.lap,
        pulse: false,
        leader,
        out: player.outAtTick !== undefined,
      };
    }),
  };
}

/** How long another racer's lap chip pulses (race-flow spec §4.1). */
export const LAP_PULSE_MS = 600;

/**
 * Which other racers' lap chips pulse now: those whose lap went up in the last
 * 600 ms of presentation time. The first look is a baseline, and the local
 * racer is left out, because their lap gets the banner.
 */
export class LapPulses {
  private readonly laps = new Map<string, number>();
  private readonly until = new Map<string, number>();

  observe(rows: readonly HudRow[], nowMs: number): ReadonlySet<string> {
    for (const row of rows) {
      const before = this.laps.get(row.id);
      this.laps.set(row.id, row.lap);
      if (!row.local && before !== undefined && row.lap > before) this.until.set(row.id, nowMs + LAP_PULSE_MS);
    }
    const pulsing = new Set<string>();
    for (const [id, end] of this.until) {
      if (nowMs < end) pulsing.add(id);
      else this.until.delete(id);
    }
    return pulsing;
  }
}

/** A place as a player says it, in their language: 1st, 2nd, 3rd, 4th, 11th, 21st in English (an ordinal plural). */
export function ordinal(n: number): string {
  return m.race_place({ place: n });
}

/**
 * The standings in one line, for a screen too short for the roster
 * (UI layout system spec §4.4).
 *
 * A place derived from authority's progress, never a reorder of the rows (rule
 * 1): ties share a place, so the pill cannot claim an order the server did not
 * issue.
 */
export interface StandingsSummary {
  place: number;
  count: number;
  leader: string | undefined;
  selfLeads: boolean;
}

export function standingsSummary(rows: readonly HudRow[], localId: string): StandingsSummary {
  const self = rows.find((row) => row.id === localId);
  const best = Math.max(0, ...rows.map((row) => row.progress));
  const leader = rows.find((row) => row.progress === best);
  const place = self === undefined ? 0 : 1 + rows.filter((row) => row.progress > self.progress).length;
  return {
    place,
    count: rows.length,
    leader: leader?.name,
    selfLeads: self !== undefined && self.progress === best,
  };
}

export function standingsPillText(summary: StandingsSummary): string {
  const place = summary.place === 0 ? "" : `${ordinal(summary.place)} / ${summary.count}`;
  if (summary.selfLeads || summary.leader === undefined) return place;
  const leads = m.race_leads({ name: summary.leader });
  return place === "" ? leads : `${place} · ${leads}`;
}
