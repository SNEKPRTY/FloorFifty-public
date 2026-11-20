/**
 * Survival's rising edge (survival spec §3).
 *
 * Each racer has their own edge: the bottom of a fixed logical view that
 * waits for that racer's first input (first-race spec §2), rests through a
 * grace period from there, then rises faster and faster to a cap, and is pushed up, at a capped speed, by a racer who climbs into the top of it. A racer
 * below their edge is out. Out reuses the finish's exclusions (`isSimulated`
 * reads `finishedAtTick`), so the solver, growth and the window drop them
 * with no new branch; `outAtTick` says why they stopped.
 */

import { TICK_SECONDS } from "../common/constants";
import { raceEventId } from "../common/ids";
import type { RaceEvent } from "../common/protocol";
import type { RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import { isEndless } from "./endless";

/** The edge's speed, in units/s, `elapsed` ticks after GO. */
export function riseSpeed(
  elapsed: number,
  tuning: Pick<
    ResolvedTuning,
    "SURVIVAL_GRACE_TICKS" | "SURVIVAL_RISE_START" | "SURVIVAL_RISE_STEP" | "SURVIVAL_RISE_STEP_TICKS" | "SURVIVAL_RISE_CAP"
  >,
): number {
  if (elapsed < tuning.SURVIVAL_GRACE_TICKS) return 0;
  const steps = Math.floor((elapsed - tuning.SURVIVAL_GRACE_TICKS) / tuning.SURVIVAL_RISE_STEP_TICKS);
  return Math.min(tuning.SURVIVAL_RISE_START + steps * tuning.SURVIVAL_RISE_STEP, tuning.SURVIVAL_RISE_CAP);
}

/** The tuning the band reads. */
export type BandTuning = Pick<
  ResolvedTuning,
  "SURVIVAL_BAND_AHEAD_STEP" | "SURVIVAL_BAND_AHEAD_MAX" | "SURVIVAL_BAND_BEHIND_STEP" | "SURVIVAL_BAND_BEHIND_MIN"
>;

/** A racer still standing, as the band sees them: best floor, as the standings rank. */
export type BandRacer = { readonly id: string; readonly bestFloor: number };

/**
 * The lava's rubber band (lava band): a multiplier on racer `id`'s rise, from
 * their best floor against the others still standing, toward the leader as the
 * CPUs band. The leader's lava rises faster for each floor they lead second
 * place by; everyone else's slower for each floor they trail the leader by.
 * Smooth rather than the CPUs' three moods, so it needs no memory and cannot
 * flicker. A racer alone, or not in `racers`, is not banded.
 */
export function riseBand(racers: readonly BandRacer[], id: string, tuning: BandTuning): number {
  const self = racers.find((racer) => racer.id === id);
  if (self === undefined || racers.length < 2) return 1;
  let best = Number.NEGATIVE_INFINITY;
  for (const racer of racers) if (racer.id !== id) best = Math.max(best, racer.bestFloor);
  const lead = self.bestFloor - best;
  if (lead > 0) return Math.min(1 + tuning.SURVIVAL_BAND_AHEAD_STEP * lead, tuning.SURVIVAL_BAND_AHEAD_MAX);
  const top = Math.max(best, self.bestFloor);
  const behind = top - self.bestFloor;
  return Math.max(1 - tuning.SURVIVAL_BAND_BEHIND_STEP * behind, tuning.SURVIVAL_BAND_BEHIND_MIN);
}

/** Racer `id`'s banded rise, in units/s, `elapsed` ticks after GO: never past the cap. */
export function bandedRiseSpeed(
  elapsed: number,
  racers: readonly BandRacer[],
  id: string,
  tuning: Parameters<typeof riseSpeed>[1] & BandTuning,
): number {
  return Math.min(riseSpeed(elapsed, tuning) * riseBand(racers, id, tuning), tuning.SURVIVAL_RISE_CAP);
}

/**
 * The ticks a racer's edge may wait for their first input. Read as 0 when the
 * tunable is missing: a replay's GO state carries the tuning it was recorded
 * with, and one recorded before the wait existed ran the old rule.
 */
const startWaitTicks = (tuning: { readonly SURVIVAL_START_WAIT_TICKS?: number | undefined }): number =>
  tuning.SURVIVAL_START_WAIT_TICKS ?? 0;

/**
 * Racer `id`'s edge speed, in units/s, `elapsed` ticks after GO: the one
 * function the room, prediction and the lava view all read. The grace rests
 * from the racer's first input (`edgeWaitTicks`), not from GO, and the race
 * clock still sets the speed once it ends, so a racer who waited is never
 * left with a slower edge than one who did not.
 */
export function edgeRiseSpeed(
  elapsed: number,
  racer: { readonly id: string; readonly edgeWaitTicks?: number | undefined },
  pack: readonly BandRacer[],
  tuning: Parameters<typeof bandedRiseSpeed>[3],
): number {
  if (elapsed < (racer.edgeWaitTicks ?? 0) + tuning.SURVIVAL_GRACE_TICKS) return 0;
  return bandedRiseSpeed(elapsed, pack, racer.id, tuning);
}

/** The racers the band counts: still standing (not out, not a DNS); a ghost stands until it is a DNS. */
export function bandRacers(players: Iterable<{ id: string; bestFloor: number; status: string; finishedAtTick?: number | undefined; outAtTick?: number | undefined }>): BandRacer[] {
  const standing: BandRacer[] = [];
  for (const player of players) {
    if (player.status === "dns" || player.finishedAtTick !== undefined || player.outAtTick !== undefined) continue;
    standing.push({ id: player.id, bestFloor: player.bestFloor });
  }
  return standing;
}

/**
 * Raises every standing racer's edge by one tick, and puts out anyone wholly
 * below theirs: out is gone off the bottom of the screen, so the body's top
 * must be under the edge, not just its centre.
 *
 * A ghost's edge rises too. Its body is frozen, so the edge catches it within
 * seconds: dropping the connection is no shelter from the rule (a drop that
 * outlived the grace would otherwise win on being the last one standing).
 * After the start wait, that is: a seat that drops before its first press
 * waits out the cap like any idle seat.
 */
export function advanceEdges(state: RaceState, events: RaceEvent[], tuning: ResolvedTuning): void {
  if (!isEndless(tuning)) return;
  const elapsed = state.tick - (state.raceStartedAtTick ?? 0);
  // The pack as it stood at the start of the tick, so who goes out this tick
  // cannot change another racer's band within it (lava band).
  const pack = bandRacers(Object.values(state.players));
  const push = tuning.SURVIVAL_PUSH_AT * tuning.SURVIVAL_VIEW_HEIGHT;
  const catchUp = tuning.SURVIVAL_PUSH_SPEED * TICK_SECONDS;
  for (const player of Object.values(state.players)) {
    if (player.status === "dns" || player.finishedAtTick !== undefined) continue;
    // A person's edge stands still until their first input or the cap
    // (first-race spec §2): no rise, no push, and they cannot go out, since
    // the edge has not moved from below the course. A computer racer acts only
    // after its reaction time, so it never waits.
    if (!player.cpu && player.awaitingInput && elapsed < startWaitTicks(tuning)) {
      player.edgeWaitTicks = elapsed + 1;
      continue;
    }
    // The push reads the best floor, not the bounce: measured from the apex,
    // every bounce ratcheted the edge to just over a floor below the landing,
    // and one missed floor was out. The reference bots all fell out at floor 50.
    // It closes on that target at a capped speed rather than jumping there
    // (lava spec §3): a jump was the camera lurching on every new floor.
    const target = (state.course.floors[player.bestFloor]?.y ?? player.y) - push;
    player.floorEdgeY += edgeRiseSpeed(elapsed, player, pack, tuning) * TICK_SECONDS;
    if (player.floorEdgeY < target) {
      player.floorEdgeY = Math.min(target, player.floorEdgeY + catchUp);
    }
    if (player.y + tuning.PLAYER_HEIGHT / 2 >= player.floorEdgeY) continue;
    player.outAtTick = elapsed;
    player.finishedAtTick = elapsed;
    player.vx = 0;
    player.vy = 0;
    events.push({ id: raceEventId(state.tick, "playerOut", player.id, "edge"), tick: state.tick, type: "playerOut", playerId: player.id });
  }
}
