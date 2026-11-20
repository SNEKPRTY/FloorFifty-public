import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { Floor } from "@floor-fifty/shared/level/course";
import {
  POSITION_ITERATIONS,
  STEP_SECONDS,
  TOP_NORMAL_MIN_Y,
  VELOCITY_ITERATIONS,
} from "@floor-fifty/shared/simulation/planck/config";
import {
  classifyNormal,
  createContactCollector,
  normalizeFacts,
  type ContactFact,
} from "@floor-fifty/shared/simulation/planck/facts";
import {
  createPlanckWorld,
  destroyPlanckWorld,
  pushPlayers,
} from "@floor-fifty/shared/simulation/planck/world";
import { PLAYER_ID, freshRaceState, stateWithPlayer } from "../../support/race";

const tuning = resolveTuning();
const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
const reachY = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;

/** A floor that holds still, so a placement against it is still true after the step. */
const stationaryFloor = (state: RaceState): Floor =>
  state.course.floors.find((floor) => floor.index > 0 && floor.kind === "stationary")!;

/** One solver step over a fresh world, and the facts it produced. */
function factsAfterOneStep(state: RaceState): ContactFact[] {
  const planck = createPlanckWorld(state);
  const collector = createContactCollector(planck, tuning.BOUNCE_VELOCITY);
  pushPlayers(planck, state);
  collector.begin();
  planck.world.step(STEP_SECONDS, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
  const facts = normalizeFacts(collector.take());
  collector.dispose();
  destroyPlanckWorld(planck);
  return facts;
}

const solidOn = (facts: readonly ContactFact[], floor: Floor) =>
  facts.filter((fact) => fact.source === "solid" && fact.floorId === floor.id);

describe("classifying a contact normal", () => {
  it("names the face from a normal pointing from floor to racer", () => {
    expect(classifyNormal(1)).toBe("top");
    expect(classifyNormal(TOP_NORMAL_MIN_Y)).toBe("top");
    expect(classifyNormal(0.5)).toBe("side");
    expect(classifyNormal(0)).toBe("side");
    expect(classifyNormal(-TOP_NORMAL_MIN_Y)).toBe("underside");
    expect(classifyNormal(-1)).toBe("underside");
  });
});

describe("solid facts", () => {
  it("reports an underside the racer rises into", () => {
    const floor = stationaryFloor(freshRaceState());
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x, y: floor.y - reachY + 2, vx: 0, vy: 100 }),
    );
    expect(solidOn(facts, floor)).toEqual([
      expect.objectContaining({ kind: "underside", playerId: PLAYER_ID }),
    ]);
  });

  it("reports a top the racer falls onto within the tick", () => {
    const floor = stationaryFloor(freshRaceState());
    const speed = tuning.MAX_MOVE_SPEED;
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x, y: floor.y + reachY + speed / TICK_HZ, vx: 0, vy: -speed }),
    );
    expect(solidOn(facts, floor).map((fact) => fact.source === "solid" && fact.kind)).toEqual([
      "top",
    ]);
  });

  it("reports a top a held fast fall would otherwise tunnel through", () => {
    // The swept test is what catches this: the racer starts a tick above the
    // floor and would be past it by the end of one.
    const floor = stationaryFloor(freshRaceState());
    const speed = Math.abs(tuning.FAST_FALL_VELOCITY);
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x, y: floor.y + reachY + speed / TICK_HZ, vx: 0, vy: -speed }),
    );
    expect(solidOn(facts, floor).map((fact) => fact.source === "solid" && fact.kind)).toEqual([
      "top",
    ]);
  });

  it("reports a side the racer presses into", () => {
    const floor = stationaryFloor(freshRaceState());
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x + reachX - 1, y: floor.y, vx: -tuning.MAX_MOVE_SPEED, vy: 0 }),
    );
    expect(solidOn(facts, floor).map((fact) => fact.source === "solid" && fact.kind)).toEqual([
      "side",
    ]);
  });

  it("owes nothing to the spawn seat the racer is leaving", () => {
    const state = freshRaceState();
    const facts = factsAfterOneStep(state);
    expect(facts.filter((fact) => fact.source === "solid")).toEqual([]);
  });

  it("owes nothing to a side the racer rests beside without pressing", () => {
    const floor = stationaryFloor(freshRaceState());
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x + reachX, y: floor.y, vx: 0, vy: 0 }),
    );
    expect(solidOn(facts, floor)).toEqual([]);
  });
});

describe("foot facts", () => {
  it("reports a floor whose top the racer's feet are level with", () => {
    const floor = stationaryFloor(freshRaceState());
    const facts = factsAfterOneStep(
      stateWithPlayer({
        x: floor.x + reachX - 1,
        y: floor.y + tuning.FLOOR_HEIGHT / 2 + tuning.PLAYER_HEIGHT / 2 - 2,
        vx: 0,
        vy: 0,
      }),
    );
    expect(
      facts.filter((fact) => fact.source === "foot" && fact.floorId === floor.id),
    ).toHaveLength(1);
  });

  it("reports nothing for a racer pressed against a side at mid height", () => {
    const floor = stationaryFloor(freshRaceState());
    const facts = factsAfterOneStep(
      stateWithPlayer({ x: floor.x + reachX - 1, y: floor.y, vx: -tuning.MAX_MOVE_SPEED, vy: 0 }),
    );
    expect(facts.filter((fact) => fact.source === "foot" && fact.floorId === floor.id)).toEqual(
      [],
    );
  });
});

describe("normalization", () => {
  const fact = (over: Partial<ContactFact>): ContactFact =>
    ({
      source: "solid",
      normalX: "kind" in over && over.kind === "side" ? 1 : 0,
      normalY: "kind" in over && over.kind === "underside" ? -1 : "kind" in over && over.kind === "side" ? 0 : 1,
      playerId: PLAYER_ID,
      floorId: "floor-1",
      floorIndex: 1,
      kind: "top",
      ...over,
    }) as ContactFact;

  it("merges duplicates and sorts by player, floor, then kind", () => {
    const merged = normalizeFacts([
      fact({ playerId: asPlayerId("p2"), floorIndex: 3, kind: "side" }),
      fact({ source: "foot", floorIndex: 2 }),
      fact({ floorIndex: 2, kind: "underside" }),
      fact({ floorIndex: 2, kind: "underside" }),
      fact({ floorIndex: 1, kind: "top" }),
    ]);
    expect(merged.map((entry) => [entry.playerId, entry.floorIndex, entry.source])).toEqual([
      ["p1", 1, "solid"],
      ["p1", 2, "solid"],
      ["p1", 2, "foot"],
      ["p2", 3, "solid"],
    ]);
  });

  it("does not depend on arrival order", () => {
    const rows = [
      fact({ floorIndex: 5, kind: "side" }),
      fact({ floorIndex: 2, kind: "top" }),
      fact({ playerId: asPlayerId("p0"), floorIndex: 9, kind: "underside" }),
    ];
    expect(normalizeFacts(rows)).toEqual(normalizeFacts([...rows].reverse()));
  });
});

describe("the collector's lifetime", () => {
  it("stops collecting once disposed", () => {
    const floor = stationaryFloor(freshRaceState());
    const state = stateWithPlayer({ x: floor.x, y: floor.y - reachY + 2, vx: 0, vy: 100 });
    const planck = createPlanckWorld(state);
    const stale = createContactCollector(planck, tuning.BOUNCE_VELOCITY);
    stale.dispose();
    stale.dispose();
    const live = createContactCollector(planck, tuning.BOUNCE_VELOCITY);

    pushPlayers(planck, state);
    stale.begin();
    live.begin();
    planck.world.step(STEP_SECONDS, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

    expect(stale.take().filter((entry) => entry.source === "solid")).toEqual([]);
    expect(solidOn(live.take(), floor)).toHaveLength(1);
    live.dispose();
    destroyPlanckWorld(planck);
  });
});

it.each([-1, 1])("retains the floor-to-racer normal on side %s", (side) => {
  const floor = stationaryFloor(freshRaceState());
  const facts = factsAfterOneStep(stateWithPlayer({ x: floor.x + side * (reachX - 1), y: floor.y, vx: -side * tuning.MAX_MOVE_SPEED, vy: 0 }));
  const contact = solidOn(facts, floor).find((fact) => fact.source === "solid" && fact.kind === "side");
  expect(contact).toMatchObject({ normalX: side });
  expect(contact?.source === "solid" ? contact.normalY : undefined).toBeCloseTo(0);
});
