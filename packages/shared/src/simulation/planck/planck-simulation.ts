/**
 * The race, stepped through a rigid-body world.
 *
 * One room owns one of these for the life of a race. The `World` inside it is
 * never serialized, never leaves this module, and is rebuilt only by
 * `restore` -- race start, race again, client reconciliation, and test setup.
 * An ordinary tick reuses it, warm-start caches and all.
 *
 * The split of responsibility: Planck owns the *contacts* -- integration,
 * detection, penetration resolution and the swept test that stops a fast fall
 * tunnelling -- and Floor Fifty owns their *meaning*: which contacts bounce,
 * which ground and which credit a floor.
 *
 * The numbered steps below are the design's fixed tick order. The order is not
 * an implementation detail: inputs before the step so a frame acts on the tick
 * it arrived; an endless course grown and its body window synced right after,
 * from the positions the tick began at; floors advanced before the step so a landing uses this tick's
 * position; facts sorted before consequences so no outcome depends on
 * iteration order; a moving floor's carry with the consequences, from the same
 * facts and before wrap, so a carried racer wraps like a steered one; fast
 * fall after the contact upforce so a held control wins on the same tick;
 * wrap and resets after both, because a push-out is a position like any other.
 */

import type { PlayerId } from "../../common/ids";
import type { HeldInput, RaceEvent } from "../../common/protocol";
import type { RaceState } from "../../common/state";
import { cloneRaceState } from "../../common/state";
import { resolveWrapAndDeaths } from "../collision";
import { applyFastFallOverride, applyInputs } from "../input";
import { advancePlatforms } from "../platforms";
import type { RaceSimulation, StepStats } from "../simulation";
import { resolveLapAndWinner, type StepResult, type SideContactObservation } from "../step";
import { POSITION_ITERATIONS, STEP_SECONDS, VELOCITY_ITERATIONS } from "./config";
import {
  createContactCollector,
  normalizeFacts,
  type ContactCollector,
  type ContactFact,
} from "./facts";
import {
  SimulationInvariantError,
  applyContactConsequences,
  applyFloorCarry,
  assertSimulationInvariants,
  floorShifts,
} from "./consequences";
import {
  createPlanckWorld,
  destroyPlanckWorld,
  driveFloors,
  pullPlayers,
  pushPlayers,
  sortedPlayerIds,
  syncFloorWindow,
  tagOf,
  type PlanckWorld,
} from "./world";
import type { Floor } from "../../level/course";
import { freeFloorsBelow, growCourse, liveFloors } from "../endless";

/**
 * Checks the world still holds what the domain says it does.
 *
 * `assertSimulationInvariants` is handed serializable state and cannot see a
 * body that outlived its player or a fixture that ended up on the wrong one.
 * Both are how a `restore` bug presents: the race reads correctly and the
 * solver is resolving contacts for somebody who left.
 */
export function assertWorldInvariants(
  planck: PlanckWorld,
  state: RaceState,
  floors: readonly Floor[] = liveFloors(state),
): void {
  const fail = (invariant: string): never => {
    throw new SimulationInvariantError(invariant, state.seed, state.tick);
  };

  if (planck.racers.size !== Object.keys(state.players).length) fail("racer-body-count");
  // Every floor of a finite course; the window the step synced for an endless
  // one, not one recomputed after the step moved the racers across a floor.
  if (planck.floors.size !== floors.length) fail("floor-body-count");
  for (const floor of floors) if (!planck.floors.has(floor.id)) fail("floor-body-window");

  for (const [playerId, racer] of planck.racers) {
    if (state.players[playerId] === undefined) fail("racer-body-orphaned");
    const tag = tagOf(racer.body);
    if (tag === undefined || tag.kind !== "racer" || tag.playerId !== playerId) {
      fail("racer-body-identity");
    }
    if (racer.main.getBody() !== racer.body || racer.footSensor.getBody() !== racer.body) {
      fail("fixture-ownership");
    }
    if (racer.footSensor.isSensor() !== true || racer.main.isSensor() !== false) {
      fail("fixture-role");
    }
  }
}

/** The counts a profile reads beside a step's duration. */
function countStep(steps: number, facts: readonly ContactFact[], planck: PlanckWorld): StepStats {
  const counted = { top: 0, side: 0, underside: 0, foot: 0 };
  for (const fact of facts) {
    if (fact.source === "foot") counted.foot += 1;
    else counted[fact.kind] += 1;
  }
  return {
    steps,
    facts: counted,
    contacts: planck.world.getContactCount(),
    bodies: planck.world.getBodyCount(),
  };
}

export function createPlanckRaceSimulation(initial: RaceState): RaceSimulation {
  let planck: PlanckWorld | undefined;
  let collector: ContactCollector | undefined;
  let stats: StepStats = {
    steps: 0,
    facts: { top: 0, side: 0, underside: 0, foot: 0 },
    contacts: 0,
    bodies: 0,
  };

  const release = (): void => {
    collector?.dispose();
    collector = undefined;
    if (planck !== undefined) destroyPlanckWorld(planck);
    planck = undefined;
  };

  const build = (state: RaceState): void => {
    release();
    planck = createPlanckWorld(state);
    collector = createContactCollector(planck, state.tuning.BOUNCE_VELOCITY);
  };

  build(initial);

  return {
    step(current: RaceState, inputs: ReadonlyMap<PlayerId, HeldInput>): StepResult {
      // Movement, landings and resets belong to a running race alone: a
      // finished race ignores input rather than letting a late frame move a
      // player behind a published result.
      if (current.phase !== "racing") return { state: current, events: [], sideContacts: [] };
      if (planck === undefined) build(current);

      const world = planck!;
      const state = cloneRaceState(current);
      const events: RaceEvent[] = [];

      // 1. The room owns the clock; `state.tick` arrives already advanced.
      // 2-3. Validate and apply input; record deferred reset and fast-fall intent.
      const { resetRequests, fastFallRequests } = applyInputs(state, inputs, state.tuning);

      // 3b. An endless course grows ahead of its leader, and its floor bodies
      //     follow the racers (race-options spec §5.3–5.4), before any floor moves.
      growCourse(state);
      const bodied = syncFloorWindow(world, state);

      // Input assigns horizontal velocity outright (`player.rs:125`) and a
      // contact never takes it away. Box2D's solver zeroes the velocity
      // component normal to a contact, so a rider pressing into a floor's side
      // would lose the speed the input gave them and stall against it. The
      // input-driven value is snapshotted here and restored after the pull.
      const horizontal = new Map<PlayerId, number>();
      for (const player of Object.values(state.players)) horizontal.set(player.id, player.vx);

      // 4. Advance moving-floor targets, then steer the kinematic bodies onto them.
      // The racers in body order, once: a step neither seats nor frees anyone.
      const ids = sortedPlayerIds(state);
      advancePlatforms(state);
      driveFloors(world, state);
      pushPlayers(world, state, ids);

      // 5-6. One step, at exactly one sixtieth of a second, with pinned
      //      iterations. The collector hears every contact the solver resolves.
      collector!.begin();
      world.world.step(STEP_SECONDS, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

      // 7. Take the solver's positions, keeping the input-owned horizontal
      //    velocity and clearing `grounded` so the pass below owns it.
      pullPlayers(world, state, ids);
      for (const player of Object.values(state.players)) {
        const vx = horizontal.get(player.id);
        if (vx !== undefined) player.vx = vx;
      }

      // 8. Bounce, grounding and floor credit, from the solver's own contacts,
      //    then a moving floor's carry (race-flow spec §4.2).
      const facts = normalizeFacts(collector!.take());
      const sideContacts: SideContactObservation[] = facts.flatMap((fact) => {
        if (fact.source !== "solid" || fact.kind !== "side") return [];
        const player = state.players[fact.playerId]!;
        return [{ tick: state.tick, playerId: fact.playerId, floorId: fact.floorId, x: player.x, y: player.y, facingLeft: fact.normalX > 0 }];
      });
      applyContactConsequences(state, facts, events);
      applyFloorCarry(state, facts, floorShifts(current, state));
      stats = countStep(stats.steps + 1, facts, world);

      // 9. A held fast fall wins on the tick it is held, landing included.
      applyFastFallOverride(state, fastFallRequests, state.tuning);

      // 10. Wrap, death line, manual reset. A teleport reaches the body in the
      //     same tick, so no contact from the old transform survives it.
      resolveWrapAndDeaths(state, resetRequests, events, state.tuning);
      pushPlayers(world, state, ids);
      // Survival's floors below every edge are freed; their bodies follow on
      // the next tick's window sync (survival spec §6).
      freeFloorsBelow(state);

      // 11. Laps, standings, winner, and the events that announce them.
      resolveLapAndWinner(state, events, state.tuning);

      // 12. Project, having checked that what is being projected is possible.
      assertSimulationInvariants(state);
      assertWorldInvariants(world, state, bodied);
      const reset = new Set(events.filter((event) => event.type === "playerReset" || event.type === "lapCompleted").map((event) => "playerId" in event ? event.playerId : undefined));
      return { state, events, sideContacts: sideContacts.filter((contact) => !reset.has(contact.playerId)) };
    },

    restore(state: RaceState): void {
      build(state);
    },

    stats(): StepStats {
      return stats;
    },

    dispose(): void {
      release();
    },
  };
}
