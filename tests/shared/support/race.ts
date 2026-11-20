/**
 * Shared fixtures for simulation tests.
 *
 * Helpers here only ever position a player and step the simulation; none of
 * them reach into the result to assert an outcome, so a test that passes is a
 * test about the simulation rather than about the fixture.
 */

import type { LapCount, PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import type { PlayerState, RaceState } from "@floor-fifty/shared/common/state";
import { createRaceState, floorX } from "@floor-fifty/shared/common/state";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { StepResult } from "@floor-fifty/shared/simulation/step";

export const SEED = 4182;
export const PLAYER_ID: PlayerId = asPlayerId("p1");

export const noInput = (): ReadonlyMap<PlayerId, HeldInput> => new Map();

export const inputFor = (overrides: Partial<HeldInput>): ReadonlyMap<PlayerId, HeldInput> =>
  new Map([
    [
      PLAYER_ID,
      { sequence: 1, left: false, right: false, fastFall: false, reset: false, ...overrides },
    ],
  ]);

/**
 * A single-player race already in `racing`, which is the only phase that
 * steps, with the player already playing: bouncing off the starting floor, as
 * after their first input. The mechanics tests are about a race in motion; the
 * wait for that first input has tests of its own.
 */
export function freshRaceState(lapCount: LapCount = 1, tuning = resolveTuning()): RaceState {
  const state = createRaceState({
    seed: SEED,
    lapCount,
    tuning,
    players: [{ id: PLAYER_ID, name: asPlayerName("Kite") }],
  });
  const player = { ...state.players[PLAYER_ID]!, awaitingInput: false, vy: tuning.BOUNCE_VELOCITY };
  return { ...state, phase: "racing", raceStartedAtTick: 0, players: { [PLAYER_ID]: player } };
}

/** A single-player race on its first racing tick, the player not yet having touched a control. */
export function waitingRaceState(): RaceState {
  const state = createRaceState({
    seed: SEED,
    lapCount: 1,
    tuning: resolveTuning(),
    players: [{ id: PLAYER_ID, name: asPlayerName("Kite") }],
  });
  return { ...state, phase: "racing", raceStartedAtTick: 0 };
}

export const playerOf = (state: RaceState): PlayerState => state.players[PLAYER_ID]!;

/**
 * Advances the room clock and then steps, which is the contract a room honours:
 * the simulation reads `tick` for event identity but never writes it.
 *
 * The tuning parameter is gone because a simulation carries its own: a test
 * that wants different numbers builds a different state.
 */
export function advance(
  state: RaceState,
  inputs: ReadonlyMap<PlayerId, HeldInput>,
): StepResult {
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const result = simulation.step({ ...state, tick: state.tick + 1 }, inputs);
  simulation.dispose();
  return result;
}

/** A racing state whose single player carries the supplied overrides. */
export function stateWithPlayer(overrides: Partial<PlayerState>, lapCount: LapCount = 1): RaceState {
  const state = freshRaceState(lapCount);
  return { ...state, players: { [PLAYER_ID]: { ...playerOf(state), ...overrides } } };
}

/**
 * Places the player one tick above a floor's top surface and steps once, so the
 * step resolves a genuine downward crossing rather than a teleport onto it.
 */
export function landOn(floorIndex: number, state: RaceState): StepResult {
  const resolved = state.tuning;
  const floor = state.course.floors[floorIndex]!;
  const floorTop = floor.y + resolved.FLOOR_HEIGHT / 2;
  const approachSpeed = -resolved.MAX_MOVE_SPEED;

  const positioned: RaceState = {
    ...state,
    players: {
      ...state.players,
      [PLAYER_ID]: {
        ...playerOf(state),
        x: floorX(state, floor),
        y: floorTop + resolved.PLAYER_HEIGHT / 2 + 1,
        vx: 0,
        vy: approachSpeed,
      },
    },
  };
  return advance(positioned, noInput());
}

/** Lands on every floor above the start, completing exactly one ascent. */
export function completeAscent(state: RaceState): StepResult {
  let current = state;
  const events = [];
  const sideContacts = [];
  for (let index = 1; index < current.course.floors.length; index += 1) {
    const result = landOn(index, current);
    current = result.state;
    events.push(...result.events);
    sideContacts.push(...result.sideContacts);
  }
  return { state: current, events, sideContacts };
}

/** Completes `count` consecutive ascents. */
export function completeLaps(count: number, state: RaceState): StepResult {
  let current = state;
  const events = [];
  const sideContacts = [];
  for (let lap = 0; lap < count; lap += 1) {
    current = waitOutHold(current);
    const result = completeAscent(current);
    current = result.state;
    events.push(...result.events);
    sideContacts.push(...result.sideContacts);
  }
  return { state: current, events, sideContacts };
}

/**
 * Steps with no input until a lapping racer is released (race-flow spec §4.1),
 * so the next ascent's landings are real contacts rather than teleports onto a
 * floor the held body cannot touch.
 */
export function waitOutHold(state: RaceState): RaceState {
  let current = state;
  while (playerOf(current).holdUntilTick !== undefined) current = advance(current, noInput()).state;
  return current;
}

/** Infinite's tuning: the 50-floor start and a clock (race-options spec §3.1). */
export const ENDLESS_TUNING = (overrides: Partial<ResolvedTuning> = {}): ResolvedTuning =>
  resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800, ...overrides });

/** An endless race in `racing`, its players `p1`… already bouncing off the start. */
export function endlessRaceState(playerCount = 1, seed = 35229, tuning = ENDLESS_TUNING()): RaceState {
  const ids = Array.from({ length: playerCount }, (_, i) => asPlayerId(`p${i + 1}`));
  const state = createRaceState({
    seed,
    lapCount: 1,
    tuning,
    players: ids.map((id, i) => ({ id, name: asPlayerName(`Racer ${i + 1}`) })),
  });
  const players = Object.fromEntries(
    ids.map((id) => [id, { ...state.players[id]!, awaitingInput: false, vy: tuning.BOUNCE_VELOCITY }]),
  ) as RaceState["players"];
  return { ...state, phase: "racing", raceStartedAtTick: 0, players };
}

/** The racer set just above floor `index`, rising: where a climber is a moment after landing it. */
export function placeAtFloor(state: RaceState, playerId: PlayerId, index: number): RaceState {
  const floor = state.course.floors[index]!;
  const player = state.players[playerId]!;
  const y = floor.y + state.tuning.FLOOR_HEIGHT / 2 + state.tuning.PLAYER_HEIGHT / 2 + 1;
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, x: floorX(state, floor), y, vy: state.tuning.BOUNCE_VELOCITY } },
  };
}
