import { describe, expect, it } from "vitest";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import {
  createPlanckWorld,
  destroyPlanckWorld,
  driveFloors,
  pullPlayers,
  pushPlayers,
  sortedPlayerIds,
  tagOf,
} from "@floor-fifty/shared/simulation/planck/world";
import { toMeters, toPixels } from "@floor-fifty/shared/simulation/planck/units";
import { PLAYER_ID, freshRaceState, playerOf } from "../../support/race";

const tuning = resolveTuning();

const fourPlayerState = () => {
  const base = createRaceState({
    seed: 4182,
    lapCount: 1,
    tuning,
    players: [
      { id: asPlayerId("p3"), name: asPlayerName("C") },
      { id: asPlayerId("p1"), name: asPlayerName("A") },
      { id: asPlayerId("p4"), name: asPlayerName("D") },
      { id: asPlayerId("p2"), name: asPlayerName("B") },
    ],
  });
  return { ...base, phase: "racing" as const, raceStartedAtTick: 0 };
};

describe("the planck world", () => {
  it("creates bodies in course order and then sorted player order", () => {
    const state = fourPlayerState();
    expect(sortedPlayerIds(state)).toEqual(["p1", "p2", "p3", "p4"]);

    const planck = createPlanckWorld(state);
    const tags: string[] = [];
    for (let body = planck.world.getBodyList(); body; body = body.getNext()) {
      const tag = tagOf(body);
      tags.push(tag === undefined ? "?" : tag.kind === "floor" ? tag.floorId : tag.playerId);
    }
    // Planck prepends, so walking the list yields creation order reversed.
    const created = tags.reverse();
    expect(created.slice(0, 3)).toEqual(["floor-0", "floor-1", "floor-2"]);
    expect(created.slice(-4)).toEqual(["p1", "p2", "p3", "p4"]);
    destroyPlanckWorld(planck);
  });

  it("gives a racer a fixed rotation, no sleep, and no racer-to-racer collision", () => {
    const state = fourPlayerState();
    const planck = createPlanckWorld(state);
    const racer = planck.racers.get(asPlayerId("p1"))!;

    expect(racer.body.isFixedRotation()).toBe(true);
    expect(racer.body.isSleepingAllowed()).toBe(false);
    expect(racer.body.isBullet()).toBe(true);
    expect(racer.main.getFilterMaskBits() & 0x0002).toBe(0);
    expect(racer.main.getRestitution()).toBe(0);
    expect(racer.footSensor.isSensor()).toBe(true);
    destroyPlanckWorld(planck);
  });

  it("gives a racer a box the size of the player", () => {
    const state = fourPlayerState();
    const planck = createPlanckWorld(state);
    const racer = planck.racers.get(asPlayerId("p1"))!;

    // The domain's own footprint. A ball slides under a floor's lower corner
    // instead of riding up its side; a box meets every face face-on.
    const shape = racer.main.getShape();
    expect(shape.getType()).toBe("polygon");
    const box = shape as unknown as { m_vertices: { x: number; y: number }[] };
    const xs = box.m_vertices.map((vertex) => Math.abs(vertex.x));
    const ys = box.m_vertices.map((vertex) => Math.abs(vertex.y));
    expect(Math.max(...xs)).toBeCloseTo(toMeters(state.tuning.PLAYER_WIDTH / 2), 9);
    expect(Math.max(...ys)).toBeCloseTo(toMeters(state.tuning.PLAYER_HEIGHT / 2), 9);
    destroyPlanckWorld(planck);
  });

  it("round-trips a transform through the bodies without drift", () => {
    const state = freshRaceState();
    const moved = {
      ...state,
      players: { [PLAYER_ID]: { ...playerOf(state), x: -123.5, y: 456.25, vx: -356, vy: 268.2 } },
    };
    const planck = createPlanckWorld(moved);

    pushPlayers(planck, moved);
    const back = { ...moved, players: { [PLAYER_ID]: { ...moved.players[PLAYER_ID]! } } };
    pullPlayers(planck, back);

    const player = back.players[PLAYER_ID]!;
    expect(player.x).toBeCloseTo(-123.5, 6);
    expect(player.y).toBeCloseTo(456.25, 6);
    expect(player.vx).toBeCloseTo(-356, 6);
    expect(player.vy).toBeCloseTo(268.2, 6);
    expect(player.grounded).toBe(false);
    destroyPlanckWorld(planck);
  });

  it("drives a moving floor to the domain position the step already decided", () => {
    const state = freshRaceState();
    const movingId = Object.keys(state.movingFloors)[0]!;
    const planck = createPlanckWorld(state);
    const target = state.movingFloors[movingId]!.x + 7;

    const advanced = {
      ...state,
      movingFloors: { ...state.movingFloors, [movingId]: { ...state.movingFloors[movingId]!, x: target } },
    };
    driveFloors(planck, advanced);
    planck.world.step(1 / 60, 8, 3);

    expect(toPixels(planck.floors.get(movingId)!.getPosition().x)).toBeCloseTo(target, 4);
    destroyPlanckWorld(planck);
  });
});
