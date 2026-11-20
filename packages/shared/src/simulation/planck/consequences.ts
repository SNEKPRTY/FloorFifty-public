/**
 * What a resolved contact means.
 *
 * Planck says a racer touched a floor, on which face, and whether their feet
 * reached it (`facts.ts`). Everything after that is Floor Fifty's:
 *
 * - a solid contact with any face sets `vy` to `BOUNCE_VELOCITY` -- which is
 *   what turns a side into a wall to ride and an underside into a ceiling to
 *   hang from;
 * - a top contact grounds the player and credits the floor, so a landing
 *   swept at fast-fall speed is credited even when the feet never overlapped;
 * - a foot contact credits the floor, once per ascent;
 * - a side or underside contact lifts but never credits;
 * - a top contact with a moving floor carries the racer by that floor's travel
 *   this tick (`applyFloorCarry`), the one position this file moves.
 *
 * Every other position is the solver's and is not touched here.
 */

import type { RaceEvent } from "../../common/protocol";
import type { RaceState } from "../../common/state";
import { creditFloor } from "../collision";
import { isHeld, isSimulated } from "../input";
import { maxSafeAbsYPixels, maxSafeSpeedPixels } from "./config";
import type { ContactFact } from "./facts";

/**
 * How far each moving floor travelled this tick: the new position less the
 * old, which is the clamped distance at a reversal rather than speed × time.
 */
export function floorShifts(before: RaceState, after: RaceState): ReadonlyMap<string, number> {
  const shifts = new Map<string, number>();
  for (const [id, floor] of Object.entries(after.movingFloors)) {
    const previous = before.movingFloors[id];
    if (previous !== undefined) shifts.set(id, floor.x - previous.x);
  }
  return shifts;
}

/**
 * Carries a racer standing on a moving floor by that floor's travel this tick
 * (race-flow spec §4.2). Read from the solver's top contacts, never from an
 * overlap. Once per racer per tick, by the first fact (they are sorted by
 * floor). Position only: nothing is added to `vx`, so leaving a floor keeps
 * no speed from it (D7). It runs before wrap and deaths, so a carried racer
 * wraps like a steered one.
 */
export function applyFloorCarry(
  state: RaceState,
  facts: readonly ContactFact[],
  shifts: ReadonlyMap<string, number>,
): void {
  const carry = state.tuning.MOVING_FLOOR_CARRY;
  if (carry === 0) return;
  const carried = new Set<string>();
  for (const fact of facts) {
    if (fact.source !== "solid" || fact.kind !== "top") continue;
    if (carried.has(fact.playerId)) continue;
    const shift = shifts.get(fact.floorId);
    if (shift === undefined) continue;
    const player = state.players[fact.playerId];
    if (player === undefined || !isSimulated(player) || isHeld(player, state.tick)) continue;
    player.x += shift * carry;
    carried.add(fact.playerId);
  }
}

export function applyContactConsequences(
  state: RaceState,
  facts: readonly ContactFact[],
  events: RaceEvent[],
): void {
  for (const fact of facts) {
    const player = state.players[fact.playerId];
    if (player === undefined || !isSimulated(player)) continue;

    const floor = state.course.floors[fact.floorIndex];
    if (floor === undefined || floor.id !== fact.floorId) continue;

    if (fact.source === "foot") {
      creditFloor(state, player, floor, events);
      continue;
    }

    player.vy = state.tuning.BOUNCE_VELOCITY;
    if (fact.kind === "top") {
      player.grounded = true;
      creditFloor(state, player, floor, events);
    }
  }
}

/**
 * A violated invariant.
 *
 * It carries the seed, the tick and the invariant's name and nothing else: a
 * room turns this into a diagnostic, and a diagnostic that carried a player
 * name or a room code would put both into whatever log receives it.
 */
export class SimulationInvariantError extends Error {
  constructor(
    readonly invariant: string,
    readonly seed: number,
    readonly tick: number,
  ) {
    super(`simulation invariant ${invariant} failed at tick ${tick} on seed ${seed}`);
    this.name = "SimulationInvariantError";
  }
}

/**
 * Checks what a legal race can never violate.
 *
 * A violation is not clamped into a plausible result. A clamped race keeps
 * playing and produces a standing nobody can explain; a stopped race produces
 * a bug report.
 */
export function assertSimulationInvariants(state: RaceState): void {
  const fail = (invariant: string): never => {
    throw new SimulationInvariantError(invariant, state.seed, state.tick);
  };

  const maxSpeed = maxSafeSpeedPixels(state.tuning);
  const maxY = maxSafeAbsYPixels(state.tuning, state.course.floorCount);

  for (const [key, player] of Object.entries(state.players)) {
    // Identity: the map key and the player's own id are the same seat.
    if (key !== player.id) fail("player-identity");

    if (
      !Number.isFinite(player.x) ||
      !Number.isFinite(player.y) ||
      !Number.isFinite(player.vx) ||
      !Number.isFinite(player.vy)
    ) {
      fail("transform-finite");
    }
    if (Math.abs(player.vx) > maxSpeed || Math.abs(player.vy) > maxSpeed) fail("speed-bound");
    if (Math.abs(player.y) > maxY) fail("position-bound");
    if (player.visitedFloorIds.length > state.course.floorCount) fail("credit-count");
  }

  for (const floor of Object.values(state.movingFloors)) {
    if (!Number.isFinite(floor.x)) fail("floor-finite");
    if (floor.x < state.course.bounds.left - 1 || floor.x > state.course.bounds.right + 1) {
      fail("floor-bound");
    }
  }

  if (state.standings.length > Object.keys(state.players).length) fail("standings-count");
}
