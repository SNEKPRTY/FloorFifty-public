/**
 * The simulation a room owns.
 *
 * `step` is pure and cloning, which is exactly wrong for a rigid-body engine:
 * a `World` carries a contact cache, fixtures, bodies and a broad phase that
 * must outlive a tick. This is the stateful façade that lets a room own one
 * long-lived simulation while still handing plain serializable `RaceState` in
 * and out.
 *
 * `restore` is the exceptional path -- race start, race again, client
 * reconciliation, and test setup. An ordinary server tick never rebuilds the
 * world, because rebuilding it throws away the warm-start caches that make the
 * solver stable.
 */

import type { PlayerId } from "../common/ids";
import type { HeldInput } from "../common/protocol";
import type { RaceState } from "../common/state";
import { createPlanckRaceSimulation } from "./planck/planck-simulation";
import type { StepResult } from "./step";

/**
 * What the most recent racing step asked of the solver.
 *
 * Counts, never durations: this package imports no clock, so whoever wants to
 * know how long a step took times the call. What only the simulation can say is
 * how much work the step was -- how many contacts the solver resolved and what
 * they meant -- and that is what a profile needs beside the time to explain it.
 */
export type StepStats = {
  /** Racing steps taken since the simulation was created. A lobby step is not one. */
  steps: number;
  /** The last step's normalized contact facts, by what they meant. */
  facts: { top: number; side: number; underside: number; foot: number };
  /** Contacts in the world's contact list after the step, touching or not. */
  contacts: number;
  /** Bodies in the world: every floor plus every racer. */
  bodies: number;
};

export type RaceSimulation = {
  /** Advances one tick. Never mutates `current`. */
  step(current: RaceState, inputs: ReadonlyMap<PlayerId, HeldInput>): StepResult;
  /** Statistics about the most recent racing step. Reads only. */
  stats(): StepStats;
  /** Rebuilds the simulation's private machinery around `state`. */
  restore(state: RaceState): void;
  /** Releases everything the simulation holds. Idempotent. */
  dispose(): void;
};

/**
 * The only simulation there is.
 *
 * There was a hand-written penetration solver beside it, selectable by an
 * environment variable while the migration was in flight. It was deleted once
 * the physics and multiplayer gates passed: two solvers is two games, and a
 * rollback that nobody needs is just a second thing to keep correct.
 */
export function createRaceSimulation(initial: RaceState): RaceSimulation {
  return createPlanckRaceSimulation(initial);
}
