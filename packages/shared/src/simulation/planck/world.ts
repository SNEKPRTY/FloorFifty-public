/**
 * The bodies a race is made of.
 *
 * Creation order is part of the determinism contract. Planck's broad phase and
 * contact list are ordered by body creation, and a solver that visits a pile in
 * a different order can resolve it differently, so floors are created in course
 * index order and racers in sorted player-id order -- never in `Object.values`
 * order, which is insertion order and therefore join order.
 *
 * An endless course creates floor bodies in index order as the window reaches
 * them (race-options spec §5.4), so a long-lived world's body list is not in
 * index order. Every world stepped from the same state, through the same
 * window changes, reaches the same list, which is what a replay depends on.
 *
 * Transfer between the domain and the bodies is explicit and one-directional
 * per call. `pushPlayers` writes the domain's truth into the world; the world
 * step moves it; `pullPlayers` reads it back. Nothing in this module decides
 * what a contact means.
 */

import { Box, Vec2, World, type Body, type Fixture } from "planck";
import type { PlayerId } from "../../common/ids";
import type { RaceState } from "../../common/state";
import { floorX } from "../../common/state";
import type { Floor } from "../../level/course";
import { isEndless, liveFloors } from "../endless";
import { isInMotion } from "../input";
import {
  FLOOR_CATEGORY,
  FLOOR_FRICTION,
  FLOOR_RESTITUTION,
  FOOT_SENSOR_CATEGORY,
  RACER_CATEGORY,
  RACER_DENSITY,
  RACER_FRICTION,
  RACER_RESTITUTION,
  STEP_SECONDS,
} from "./config";
import { toMeters, toPixels } from "./units";

export type BodyTag =
  | { kind: "floor"; floorId: string; floorIndex: number }
  | { kind: "racer"; playerId: PlayerId };

export type RacerBodies = { body: Body; main: Fixture; footSensor: Fixture };

export type PlanckWorld = {
  world: World;
  racers: Map<PlayerId, RacerBodies>;
  floors: Map<string, Body>;
};

export function tagOf(body: Body): BodyTag | undefined {
  const data = body.getUserData();
  return data === null || data === undefined ? undefined : (data as BodyTag);
}

/** Stable racer order: player ids sorted as strings, never insertion order. */
export function sortedPlayerIds(state: RaceState): PlayerId[] {
  return (Object.keys(state.players) as PlayerId[]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function createFloorBody(world: World, state: RaceState, floor: Floor): Body {
  const tuning = state.tuning;
  const body = world.createBody({
    type: floor.kind === "moving" ? "kinematic" : "static",
    position: new Vec2(toMeters(floorX(state, floor)), toMeters(floor.y)),
    userData: { kind: "floor", floorId: floor.id, floorIndex: floor.index } satisfies BodyTag,
  });
  body.createFixture({
    shape: new Box(toMeters(tuning.FLOOR_WIDTH / 2), toMeters(tuning.FLOOR_HEIGHT / 2)),
    density: 0,
    friction: FLOOR_FRICTION,
    restitution: FLOOR_RESTITUTION,
    filterCategoryBits: FLOOR_CATEGORY,
    filterMaskBits: RACER_CATEGORY | FOOT_SENSOR_CATEGORY,
  });
  return body;
}

function createRacerBodies(world: World, state: RaceState, playerId: PlayerId): RacerBodies {
  const player = state.players[playerId]!;
  const tuning = state.tuning;

  const body = world.createBody({
    type: "dynamic",
    position: new Vec2(toMeters(player.x), toMeters(player.y)),
    linearVelocity: new Vec2(toMeters(player.vx), toMeters(player.vy)),
    // A racer is a box that never tips: the art has an up, and a solver that
    // spun it would put the collision box at an angle nothing else models.
    fixedRotation: true,
    // Sleep would stop a player who rests on a floor, and the game's whole
    // premise is that nobody ever rests.
    allowSleep: false,
    // A held fast fall covers 0.45 m in a tick against a 0.4 m floor, so the
    // swept test is the only thing standing between it and a tunnel.
    bullet: true,
    linearDamping: 0,
    angularDamping: 0,
    userData: { kind: "racer", playerId } satisfies BodyTag,
  });

  const main = body.createFixture({
    // A box, the domain's own footprint. A ball was tried: pressed into a
    // floor's lower corner it meets a diagonal normal that slides it under the
    // floor instead of up its side, and a landing swept at speed was missed
    // outright. A box meets every face face-on, so a side is a wall to ride.
    shape: new Box(toMeters(tuning.PLAYER_WIDTH / 2), toMeters(tuning.PLAYER_HEIGHT / 2)),
    density: RACER_DENSITY,
    friction: RACER_FRICTION,
    restitution: RACER_RESTITUTION,
    filterCategoryBits: RACER_CATEGORY,
    // Floors only. Players never collide with each other, and the mask rather
    // than a callback is what makes that a fact about the world.
    filterMaskBits: FLOOR_CATEGORY,
  });

  // The reference's foot sensor: a band the height of a floor, hung at the
  // player's bottom edge. It resolves nothing. A floor it touches is a floor
  // the player's feet have reached, which is what credits it (`facts.ts`).
  const footSensor = body.createFixture({
    shape: new Box(
      toMeters(tuning.PLAYER_WIDTH / 2),
      toMeters(tuning.FLOOR_HEIGHT / 2),
      new Vec2(0, toMeters(-tuning.PLAYER_HEIGHT / 2)),
    ),
    isSensor: true,
    density: 0,
    filterCategoryBits: FOOT_SENSOR_CATEGORY,
    filterMaskBits: FLOOR_CATEGORY,
  });

  return { body, main, footSensor };
}

export function createPlanckWorld(state: RaceState): PlanckWorld {
  const world = new World({ gravity: new Vec2(0, toMeters(state.tuning.GRAVITY)) });
  world.setAllowSleeping(false);

  const floors = new Map<string, Body>();
  for (const floor of liveFloors(state)) {
    floors.set(floor.id, createFloorBody(world, state, floor));
  }

  const racers = new Map<PlayerId, RacerBodies>();
  for (const playerId of sortedPlayerIds(state)) {
    racers.set(playerId, createRacerBodies(world, state, playerId));
  }

  return { world, racers, floors };
}

/**
 * Brings an endless course's floor bodies to the window (race-options spec
 * §5.4): those that left it destroyed, then those that entered created, each
 * in index order. A finite course has every floor and is left alone. Returns
 * the floors that now have a body, which is what the step's invariant checks.
 */
export function syncFloorWindow(planck: PlanckWorld, state: RaceState): readonly Floor[] {
  const floors = liveFloors(state);
  if (!isEndless(state.tuning)) return floors;
  const wanted = new Set(floors.map((floor) => floor.id));
  const indexOf = (body: Body): number => {
    const tag = tagOf(body);
    return tag?.kind === "floor" ? tag.floorIndex : 0;
  };
  const leaving = [...planck.floors].filter(([id]) => !wanted.has(id));
  leaving.sort(([, a], [, b]) => indexOf(a) - indexOf(b));
  for (const [id, body] of leaving) {
    planck.world.destroyBody(body);
    planck.floors.delete(id);
  }
  for (const floor of floors) {
    if (!planck.floors.has(floor.id)) planck.floors.set(floor.id, createFloorBody(planck.world, state, floor));
  }
  return floors;
}

export function destroyPlanckWorld(planck: PlanckWorld): void {
  for (let body = planck.world.getBodyList(); body; ) {
    const next = body.getNext();
    planck.world.destroyBody(body);
    body = next;
  }
  planck.racers.clear();
  planck.floors.clear();
}

/**
 * A scratch vector for the setters below. Planck copies a vector it is handed
 * (`setTransform`, `setLinearVelocity`) and keeps none, so one serves every
 * call, and a tick allocates none for them.
 */
const scratch = new Vec2(0, 0);

/**
 * Writes the domain's transforms and velocities into the bodies.
 *
 * `ids` is `sortedPlayerIds(state)`, which a step computes once for all its calls.
 */
export function pushPlayers(planck: PlanckWorld, state: RaceState, ids: readonly PlayerId[] = sortedPlayerIds(state)): void {
  for (const playerId of ids) {
    const racer = planck.racers.get(playerId);
    const player = state.players[playerId];
    if (racer === undefined || player === undefined) continue;

    racer.body.setTransform(scratch.setNum(toMeters(player.x), toMeters(player.y)), 0);
    racer.body.setLinearVelocity(scratch.setNum(toMeters(player.vx), toMeters(player.vy)));
    // A player who is not simulated -- a ghost, a finisher -- freezes exactly
    // where they were rather than falling out of the course while nobody is
    // driving them. So does one who has not played yet, standing on the
    // starting floor until their first input.
    racer.body.setActive(isInMotion(player, state.tick));
    racer.body.setAwake(true);
  }
}

/**
 * Reads the bodies back into the domain.
 *
 * `grounded` is cleared here, in the same place the hand-written integrator
 * cleared it (`players.ts:42`), so the contact pass that follows is the only
 * thing that can set it.
 */
export function pullPlayers(planck: PlanckWorld, state: RaceState, ids: readonly PlayerId[] = sortedPlayerIds(state)): void {
  for (const playerId of ids) {
    const racer = planck.racers.get(playerId);
    const player = state.players[playerId];
    if (racer === undefined || player === undefined) continue;
    if (!isInMotion(player, state.tick)) continue;

    const position = racer.body.getPosition();
    const velocity = racer.body.getLinearVelocity();
    player.x = toPixels(position.x);
    player.y = toPixels(position.y);
    player.vx = toPixels(velocity.x);
    player.vy = toPixels(velocity.y);
    player.grounded = false;
  }
}

/**
 * Steers every moving floor onto the position the domain already decided.
 *
 * A kinematic body moves by velocity, so the velocity is solved backwards from
 * the target `advancePlatforms` computed. That keeps one answer to where a
 * floor is -- the domain's -- and still lets the solver see the floor arrive
 * with a real velocity, which is what carries a rider along with it.
 */
export function driveFloors(planck: PlanckWorld, state: RaceState): void {
  for (const floor of state.course.floors) {
    const moving = state.movingFloors[floor.id];
    const body = planck.floors.get(floor.id);
    if (moving === undefined || body === undefined) continue;

    const current = toPixels(body.getPosition().x);
    body.setLinearVelocity(scratch.setNum(toMeters((moving.x - current) / STEP_SECONDS), 0));
  }
}
