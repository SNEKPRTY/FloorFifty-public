import { describe, expect, it } from "vitest";
import { TICK_HZ, TICK_SECONDS, VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { floorX } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { CONTACT_TOLERANCE_PIXELS } from "@floor-fifty/shared/simulation/planck/config";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { PLAYER_ID, freshRaceState, playerOf, stateWithPlayer } from "../../support/race";

const tuning = resolveTuning();

function stepOnce(state: RaceState, input?: Partial<HeldInput>) {
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const inputs = new Map<PlayerId, HeldInput>();
  if (input !== undefined) {
    inputs.set(PLAYER_ID, {
      sequence: 1,
      left: false,
      right: false,
      fastFall: false,
      reset: false,
      ...input,
    });
  }
  const result = simulation.step({ ...state, tick: state.tick + 1 }, inputs);
  simulation.dispose();
  return result;
}

/** A player one tick above a floor's top face, falling onto it. */
function approaching(floorIndex: number, speed: number, base = freshRaceState()): RaceState {
  const floor = base.course.floors[floorIndex]!;
  const top = floor.y + tuning.FLOOR_HEIGHT / 2;
  return {
    ...base,
    players: {
      [PLAYER_ID]: {
        ...playerOf(base),
        x: floorX(base, floor),
        y: top + tuning.PLAYER_HEIGHT / 2 + Math.abs(speed) * (1 / TICK_HZ),
        vx: 0,
        vy: speed,
      },
    },
  };
}

describe("spawn and the authored bounce", () => {
  it("leaves the spawn seat rising at the authored bounce velocity", () => {
    expect(playerOf(freshRaceState()).vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 6);
  });

  it("does not re-bounce off the floor it is seated on", () => {
    const { events } = stepOnce(freshRaceState());
    expect(events.filter((event) => event.type === "floorLanded")).toHaveLength(0);
  });
});

describe("top landings", () => {
  it("bounces, grounds and credits in one tick", () => {
    const { state, events } = stepOnce(approaching(1, -tuning.MAX_MOVE_SPEED));
    const player = state.players[PLAYER_ID]!;
    expect(player.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 3);
    expect(player.grounded).toBe(true);
    expect(events.map((event) => event.type)).toContain("floorLanded");
  });

  it("credits a floor once per ascent however many times it is touched", () => {
    let state = approaching(1, -tuning.MAX_MOVE_SPEED);
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    let credits = 0;
    for (let tick = 0; tick < TICK_HZ * 3; tick += 1) {
      const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map());
      state = result.state;
      credits += result.events.filter((event) => event.type === "floorLanded").length;
    }
    simulation.dispose();
    expect(credits).toBe(1);
  });

  // A top contact that begins while the player is still rising -- the apex of
  // a bounce grazing a floor that slides under it -- used to be dropped, after
  // which the solver zeroed `vy` and every later tick read a zero approach: the
  // player rested on the floor until a fast fall freed them.
  it.each([
    ["resting on it", 0, 0],
    ["grazing it at the apex of a bounce", 0.3, 11.5],
  ])("bounces a player %s instead of letting them rest", (_, drop, vy) => {
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    let state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: {
          ...playerOf(base),
          x: floorX(base, floor),
          y: floor.y + tuning.FLOOR_HEIGHT / 2 + tuning.PLAYER_HEIGHT / 2 + drop,
          vx: 0,
          vy,
        },
      },
    };
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    let bounced = false;
    for (let tick = 0; tick < 3 && !bounced; tick += 1) {
      state = simulation.step({ ...state, tick: state.tick + 1 }, new Map()).state;
      bounced = state.players[PLAYER_ID]!.vy === tuning.BOUNCE_VELOCITY;
    }
    simulation.dispose();
    expect(bounced).toBe(true);
  });
});

describe("side and underside contact", () => {
  it("lifts a player pressing into a floor's side without crediting it", () => {
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    const state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: {
          ...playerOf(base),
          x: floorX(base, floor) + (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 - 1,
          y: floor.y,
          vx: 0,
          vy: -100,
        },
      },
    };
    const { state: next, events } = stepOnce(state, { left: true });
    expect(next.players[PLAYER_ID]!.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 3);
    expect(events.filter((event) => event.type === "floorLanded")).toHaveLength(0);
  });

  it("holds a player against an underside rather than stopping them", () => {
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    const state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: {
          ...playerOf(base),
          x: floorX(base, floor),
          y: floor.y - tuning.FLOOR_HEIGHT / 2 - tuning.PLAYER_HEIGHT / 2 + 2,
          vx: 0,
          vy: 100,
        },
      },
    };
    expect(stepOnce(state).state.players[PLAYER_ID]!.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 3);
  });

  it("hangs from an underside for as long as the player keeps rising into it", () => {
    // The ceiling ride. The contact re-applies the bounce every tick, so the
    // player holds against the underside instead of falling away from it --
    // and rests inside the solver's contact skin, never inside the floor.
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    const underside = floor.y - (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;
    let state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: { ...playerOf(base), x: floorX(base, floor), y: underside - 1, vx: 0, vy: 100 },
      },
    };
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    for (let tick = 0; tick < TICK_HZ; tick += 1) {
      state = simulation.step({ ...state, tick: state.tick + 1 }, new Map()).state;
      const gap = underside - state.players[PLAYER_ID]!.y;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(CONTACT_TOLERANCE_PIXELS);
    }
    simulation.dispose();
    expect(state.players[PLAYER_ID]!.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 3);
  });

  it("rests a player pressed into a side within the contact skin, never inside it", () => {
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    const reach = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
    const state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: { ...playerOf(base), x: floorX(base, floor) + reach - 1, y: floor.y, vx: 0, vy: -100 },
      },
    };
    const { state: next } = stepOnce(state, { left: true });
    const gap = next.players[PLAYER_ID]!.x - (floorX(next, floor) + reach);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(CONTACT_TOLERANCE_PIXELS);
  });

  it("does not drag a player diagonally at a floor's lower corner", () => {
    const base = freshRaceState();
    const floor = base.course.floors[1]!;
    const player = playerOf(base);
    // Beside the floor and below its bottom edge, pressing up past its corner.
    const state: RaceState = {
      ...base,
      players: {
        [PLAYER_ID]: {
          ...player,
          x: floorX(base, floor) - ((tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 - 6.5),
          y: floor.y - 30,
          vx: 0,
          vy: tuning.BOUNCE_VELOCITY,
        },
      },
    };
    const { state: next } = stepOnce(state);

    // A box meets the corner face-on, so the solver corrects one axis and
    // leaves the vertical one where integration put it -- no diagonal drag.
    const integratedY = state.players[PLAYER_ID]!.y +
      (state.players[PLAYER_ID]!.vy + tuning.GRAVITY * TICK_SECONDS) * TICK_SECONDS;
    expect(next.players[PLAYER_ID]!.y).toBeCloseTo(integratedY, 6);
  });
});

describe("fast fall precedence", () => {
  it("wins over a contact upforce on the same tick, landing included", () => {
    const { state } = stepOnce(approaching(1, -tuning.MAX_MOVE_SPEED), { fastFall: true });
    expect(state.players[PLAYER_ID]!.vy).toBeCloseTo(tuning.FAST_FALL_VELOCITY, 6);
  });

  it("still credits the floor it was cancelled on", () => {
    const { events } = stepOnce(approaching(1, -tuning.MAX_MOVE_SPEED), { fastFall: true });
    expect(events.map((event) => event.type)).toContain("floorLanded");
  });
});

describe("high-speed landings", () => {
  it("does not tunnel through a floor at the fastest fall the game allows", () => {
    const { state, events } = stepOnce(approaching(1, tuning.FAST_FALL_VELOCITY));
    expect(events.map((event) => event.type)).toContain("floorLanded");
    const floor = state.course.floors[1]!;
    expect(state.players[PLAYER_ID]!.y).toBeGreaterThan(floor.y);
  });
});

describe("moving floors", () => {
  it("reverses at the course bounds and never leaves them", () => {
    let state = freshRaceState();
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    for (let tick = 0; tick < TICK_HZ * 30; tick += 1) {
      state = simulation.step({ ...state, tick: state.tick + 1 }, new Map()).state;
      for (const floor of Object.values(state.movingFloors)) {
        expect(floor.x).toBeGreaterThanOrEqual(state.course.bounds.left);
        expect(floor.x).toBeLessThanOrEqual(state.course.bounds.right);
      }
    }
    simulation.dispose();
  });
});

describe("wrapping", () => {
  it("wraps rightward and leftward alike", () => {
    // A frame per direction: `applyInputs` assigns `vx` outright from input, so
    // a fixture that only sets `vx` is zeroed before the step and never crosses.
    const right = stepOnce(stateWithPlayer({ x: VIEWPORT.width / 2 - 1 }), { right: true }).state;
    expect(right.players[PLAYER_ID]!.x).toBeLessThan(0);
    const left = stepOnce(stateWithPlayer({ x: -VIEWPORT.width / 2 + 1 }), { left: true }).state;
    expect(left.players[PLAYER_ID]!.x).toBeGreaterThan(0);
  });

  it("does not carry a contact across the seam", () => {
    const { events } = stepOnce(stateWithPlayer({ x: VIEWPORT.width / 2 - 1, y: 0 }), {
      right: true,
    });
    expect(events.filter((event) => event.type === "floorLanded")).toHaveLength(0);
  });
});

describe("resets", () => {
  it("returns a manual reset to the spawn seat with one event", () => {
    const { state, events } = stepOnce(stateWithPlayer({ y: 600, vx: 300 }), { reset: true });
    const player = state.players[PLAYER_ID]!;
    expect(player.vx).toBe(0);
    expect(player.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 6);
    expect(player.visitedFloorIds).toEqual(["floor-0"]);
    expect(events.filter((event) => event.type === "playerReset")).toHaveLength(1);
  });
});

describe("ghosts and DNS", () => {
  it("freezes a ghost exactly where they disconnected", () => {
    const frozen = stateWithPlayer({ status: "ghost", x: 100, y: 300, vy: -200 });
    const { state } = stepOnce(frozen);
    const player = state.players[PLAYER_ID]!;
    expect(player.x).toBe(100);
    expect(player.y).toBe(300);
    expect(player.vy).toBe(-200);
  });
});
