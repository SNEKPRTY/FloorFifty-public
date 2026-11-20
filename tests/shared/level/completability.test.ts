import { describe, expect, it } from "vitest";
import { TICK_HZ, VIEWPORT } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { advance } from "../support/race";

const tuning = resolveTuning();
const BOT = asPlayerId("p1");

/** Climbs a seeded course with the reference controller. */
function climb(seed: number, maxSeconds = 300): { finished: boolean; seconds: number } {
  const base = createRaceState({
    seed,
    lapCount: 1,
    tuning,
    players: [{ id: BOT, name: asPlayerName("Bot") }],
  });
  let state: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };
  const controller = createClimbController(BOT);
  const simulation = createRaceSimulation(state);
  simulation.restore(state);

  for (let tick = 0; tick < TICK_HZ * maxSeconds; tick += 1) {
    if (state.phase === "finished") break;
    const input = controller.next(state, tick + 1);
    state = simulation.step(
      { ...state, tick: state.tick + 1 },
      input === undefined ? new Map() : new Map([[BOT, input]]),
    ).state;
  }
  simulation.dispose();

  return { finished: state.phase === "finished", seconds: state.tick / TICK_HZ };
}

describe("the bounds a climbable course rests on", () => {
  const apex = (tuning.BOUNCE_VELOCITY * tuning.BOUNCE_VELOCITY) / (2 * Math.abs(tuning.GRAVITY));

  it("clears the floor gap, but only just", () => {
    // 130.78 against 128.571: every bounce in the reference is a near-miss,
    // and that margin is the feel this port exists to reproduce.
    expect(apex).toBeGreaterThan(tuning.FLOOR_GAP_MAX);
    expect(apex - tuning.FLOOR_GAP_MAX).toBeLessThan(5);
  });

  it("cannot reach two floors up, which would strand the floor between them", () => {
    expect(apex).toBeLessThan(tuning.FLOOR_GAP_MIN * 2);
  });

  it("can cross half the course horizontally within one bounce", () => {
    const airtimeSeconds = (2 * tuning.BOUNCE_VELOCITY) / Math.abs(tuning.GRAVITY);
    expect(tuning.MAX_MOVE_SPEED * airtimeSeconds).toBeGreaterThan(VIEWPORT.width / 2);
  });

  it("leaves at most one floor overlapping a player", () => {
    // Contact resolution is a discrete overlap test and picks the shallower
    // axis; two simultaneous floors would make the order it visits them
    // matter.
    const band = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;
    expect(tuning.FLOOR_GAP_MIN).toBeGreaterThan(band * 2);
  });

  it("cannot be tunnelled through at the fastest fall the course allows", () => {
    const band = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;
    expect(Math.abs(tuning.FAST_FALL_VELOCITY) / TICK_HZ).toBeLessThan(band);
  });
});

describe("course completability", () => {
  // Measured over two hundred seeds at these defaults: two hundred finished,
  // with a median of 15.9 seconds, a ninetieth percentile of 20.6, and a
  // slowest seed at 52.0. The tail is long because a climb that loses a floor
  // recovers it by descending a column beside it, which costs a whole ascent's
  // worth of time. The thresholds below sit well clear of that, so an ordinary
  // change does not trip them and a real regression does.
  const seeds = Array.from({ length: 40 }, (_unused, index) => index * 7919 + 13);

  // Forty seeds climbed in full: about 1 s alone, and slower beside the rest
  // of the suite, so it carries a generous budget rather than the 5 s default.
  it("is climbable from the great majority of seeds", { timeout: 10_000 }, () => {
    const results = seeds.map((seed) => ({ seed, ...climb(seed) }));
    const failed = results.filter((result) => !result.finished);

    expect(
      failed.length / seeds.length,
      `unclimbable seeds: ${failed.map((result) => result.seed).join(", ")}`,
    ).toBeLessThanOrEqual(0.05);
  });

  it("climbs at a pace a race can be built around", { timeout: 10_000 }, () => {
    const times = seeds
      .map((seed) => climb(seed))
      .filter((result) => result.finished)
      .map((result) => result.seconds)
      .sort((a, b) => a - b);

    const median = times[Math.floor(times.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(5);
    expect(median).toBeLessThan(45);
  });
});

describe("the reference controller", () => {
  it("restarts an ascent it can no longer complete", () => {
    // A floor left behind is all but unreachable: returning to it means
    // descending a column the floors above it roof. A controller with no
    // memory repeats that mistake
    // forever in a deterministic simulation; this one takes the reset.
    const base = createRaceState({
      seed: 4182,
      lapCount: 1,
      tuning,
      players: [{ id: BOT, name: asPlayerName("Bot") }],
    });
    const course = base.course;
    const stuck: RaceState = {
      ...base,
      phase: "racing",
      players: {
        [BOT]: {
          ...base.players[BOT]!,
          // High up the course with an early floor never collected.
          y: course.floors[10]!.y,
          visitedFloorIds: [course.floors[0]!.id, course.floors[2]!.id],
        },
      },
    };

    const controller = createClimbController(BOT);
    let sawReset = false;
    for (let tick = 0; tick < TICK_HZ * 30; tick += 1) {
      const input = controller.next(stuck, tick + 1);
      if (input?.reset === true) {
        sawReset = true;
        break;
      }
    }
    expect(sawReset).toBe(true);
  });

  it("escapes a floor it is pinned beneath", () => {
    // A player held against a floor's underside at its centre is the one
    // configuration chasing the centre cannot resolve: the contact re-applies
    // the bounce every tick and the push-out returns them to the same spot.
    const base = createRaceState({
      seed: 13,
      lapCount: 1,
      tuning,
      players: [{ id: BOT, name: asPlayerName("Bot") }],
    });
    const floor = base.course.floors[1]!;
    const reachY = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;

    let state: RaceState = {
      ...base,
      phase: "racing",
      raceStartedAtTick: 0,
      players: {
        [BOT]: {
          ...base.players[BOT]!,
          x: floor.x,
          y: floor.y - reachY,
          vx: 0,
          vy: tuning.BOUNCE_VELOCITY,
        },
      },
    };

    const controller = createClimbController(BOT);
    for (let tick = 0; tick < 60 * 5; tick += 1) {
      const input = controller.next(state, tick + 1);
      state = advance(
        { ...state, tick: state.tick + 1 },
        input === undefined ? new Map() : new Map([[BOT, input]]),
      ).state;
    }

    expect(state.players[BOT]!.visitedFloorIds).toContain(floor.id);
  });
});

describe("course generation", () => {
  it("places each floor independently of the one below it", () => {
    // The reference draws every platform's x across the full bounds with no
    // reference to its neighbour (`platforms.rs:108`), so consecutive floors
    // stack, and a stacked pair is what a wall ride is for.
    const tall = resolveTuning({ COURSE_FLOOR_COUNT: 100 });
    const steps: number[] = [];
    for (let seed = 0; seed < 20; seed += 1) {
      const course = createCourse(seed * 1319 + 7, tall);
      for (let index = 1; index < course.floors.length; index += 1) {
        steps.push(Math.abs(course.floors[index]!.x - course.floors[index - 1]!.x));
      }
    }
    const overlap = (tall.FLOOR_WIDTH + tall.PLAYER_WIDTH) / 2;
    expect(steps.some((step) => step < overlap)).toBe(true);
    expect(steps.some((step) => step > 400)).toBe(true);
  });

  it("keeps every floor inside the course bounds", () => {
    const course = createCourse(4242, tuning);
    for (const floor of course.floors) {
      expect(Math.abs(floor.x)).toBeLessThanOrEqual(VIEWPORT.width / 2 - tuning.FLOOR_WIDTH);
    }
  });

  it("gives each moving floor its own speed, all starting rightward", () => {
    const tall = resolveTuning({ COURSE_FLOOR_COUNT: 100 });
    const moving = createCourse(99, tall).floors.filter((floor) => floor.kind === "moving");
    expect(moving.length).toBeGreaterThan(10);
    expect(new Set(moving.map((floor) => floor.speed)).size).toBeGreaterThan(1);
    for (const floor of moving) {
      expect(floor.direction).toBe(1);
      // Above the ramp's first floor the range rises; `ramp.test.ts` covers those.
      if (floor.index >= tall.DEMAND_RAMP_FROM_FLOOR) continue;
      expect(floor.speed).toBeGreaterThanOrEqual(tall.MOVING_FLOOR_SPEED_MIN);
      expect(floor.speed).toBeLessThan(tall.MOVING_FLOOR_SPEED_MAX);
    }
  });
});
