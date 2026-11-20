import { describe, expect, it } from "vitest";
import { TICK_HZ, VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { floorX, spawnPosition } from "@floor-fifty/shared/common/state";
import { CONTACT_TOLERANCE_PIXELS } from "@floor-fifty/shared/simulation/planck/config";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { Floor } from "@floor-fifty/shared/level/course";
import {
  PLAYER_ID,
  advance,
  freshRaceState,
  inputFor,
  landOn,
  noInput,
  playerOf,
  stateWithPlayer,
  waitingRaceState,
} from "../support/race";

const tuning = resolveTuning();

describe("player movement", () => {
  it("wraps a player crossing the right boundary", () => {
    const result = advance(stateWithPlayer({ x: 481, vx: 100 }), noInput());
    expect(result.state.players[PLAYER_ID]!.x).toBeLessThan(-470);
  });

  it("wraps a player crossing the left boundary", () => {
    const result = advance(stateWithPlayer({ x: -481, vx: -100 }), noInput());
    expect(result.state.players[PLAYER_ID]!.x).toBeGreaterThan(470);
  });

  it("reaches the speed cap in a single tick", () => {
    const state = advance(freshRaceState(), inputFor({ right: true })).state;
    expect(playerOf(state).vx).toBeCloseTo(tuning.MAX_MOVE_SPEED, 5);
    expect(playerOf(state).facingRight).toBe(true);
  });

  it("stops dead when every direction is released", () => {
    const moving = advance(freshRaceState(), inputFor({ right: true })).state;
    expect(playerOf(moving).vx).toBeCloseTo(tuning.MAX_MOVE_SPEED, 5);

    // `inputFor({})` is every direction released, which is the whole point:
    // there is no ramp left to coast down.
    const released = advance(moving, inputFor({})).state;
    expect(playerOf(released).vx).toBe(0);
  });

  it("reads gravity from resolved tuning rather than a module literal", () => {
    const heavy = advance(freshRaceState(1, resolveTuning({ GRAVITY: -800 })), noInput());
    const light = advance(freshRaceState(1, resolveTuning({ GRAVITY: -200 })), noInput());
    expect(heavy.state.players[PLAYER_ID]!.vy).toBeLessThan(light.state.players[PLAYER_ID]!.vy);
  });

  it("forces the fast-fall velocity while the control is held", () => {
    // Held clear of every floor: the course bounds keep a floor centre within
    // +/-360, so nothing here is close enough to turn the fall into a landing.
    const airborne = stateWithPlayer({ x: 470, y: 300, vy: 100 });
    const result = advance(airborne, inputFor({ fastFall: true }));
    expect(result.state.players[PLAYER_ID]!.vy).toBeLessThan(tuning.FAST_FALL_VELOCITY + 1);
  });

  it("pins a player to a floor while fast fall is held", () => {
    // The reference reads the upforce first and the fast fall second with no
    // exception for a landing (`player.rs:128-137`), so holding the control is
    // how a player stops the automatic ascent.
    const result = landOn(0, freshRaceState());
    const held = advance(result.state, inputFor({ fastFall: true }));
    expect(playerOf(held.state).vy).toBeCloseTo(tuning.FAST_FALL_VELOCITY, 5);
  });

  it("ignores an input frame whose sequence moves backward", () => {
    const state = stateWithPlayer({ lastSequence: 10 });
    const stale = new Map([
      [PLAYER_ID, { sequence: 2, left: true, right: false, fastFall: false, reset: false }],
    ]);
    expect(advance(state, stale).state.players[PLAYER_ID]!.vx).toBe(0);
  });
});

describe("landings and bounce", () => {
  it("bounces upward after a valid top-side landing", () => {
    const result = landOn(1, freshRaceState());
    expect(result.state.players[PLAYER_ID]!.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 5);
    expect(result.state.players[PLAYER_ID]!.grounded).toBe(true);
  });

  it("records a floor only on the first landing in an ascent", () => {
    const first = landOn(1, freshRaceState());
    const second = landOn(1, first.state);
    const floorId = first.state.course.floors[1]!.id;
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "floorLanded", playerId: PLAYER_ID, floorId }),
    );
    expect(second.events).not.toContainEqual(expect.objectContaining({ type: "floorLanded" }));
  });

  it("counts the starting floor as landed at spawn", () => {
    const state = freshRaceState();
    expect(playerOf(state).visitedFloorIds).toEqual([state.course.floors[0]!.id]);
  });

  it("does not credit a floor to a player who hits it from below", () => {
    // Hitting a floor's underside is movement, never progress. The contact
    // still bounces the player -- that is what `contact upforce` covers -- but
    // only a downward crossing of the top face earns the floor.
    const state = freshRaceState();
    const floor = state.course.floors[1]!;
    const rising = stateWithPlayer({
      x: floor.x,
      y: floor.y - tuning.FLOOR_HEIGHT,
      vy: tuning.BOUNCE_VELOCITY,
    });
    const result = advance(rising, noInput());
    expect(result.events).toEqual([]);
    expect(playerOf(result.state).visitedFloorIds).not.toContain(floor.id);
    expect(playerOf(result.state).grounded).toBe(false);
  });

  it("credits a floor whose top band the player's feet overlap while rising", () => {
    // The reference scores from a foot sensor that fires on contact with any
    // face (`player.rs:207-219`), not from a descent, so a player who rides a
    // floor's side up past its top edge earns it on the way up. Riding is the
    // course's main way to climb, so refusing the credit here would make a
    // player come back down for a floor the reference already gave them.
    const state = freshRaceState();
    const floor = state.course.floors.find(
      (candidate) => candidate.index > 0 && candidate.kind === "stationary",
    )!;
    const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;

    const riding = stateWithPlayer({
      x: floor.x + reachX - 2,
      y: floor.y + 30,
      vy: tuning.BOUNCE_VELOCITY,
    });

    const result = advance(riding, noInput());

    expect(playerOf(result.state).visitedFloorIds).toContain(floor.id);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "floorLanded", playerId: PLAYER_ID, floorId: floor.id }),
    );
  });

  it("credits a floor the rider is flush against, not only one they still press into", () => {
    // A horizontal push-out leaves a rider at exactly the contact boundary, so
    // the tick after any push a player who has stopped steering sits flush
    // rather than overlapping. The upforce is rightly withheld there -- a ride
    // is held, never coasted -- but the foot sensor is not the solver, and the
    // reference's fires on touch. Reading it from the strict overlap dropped
    // the floor whenever a rider let go just as their feet cleared the edge.
    const state = freshRaceState();
    const floor = state.course.floors.find(
      (candidate) => candidate.index > 0 && candidate.kind === "stationary",
    )!;
    const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;

    const flush = stateWithPlayer({
      x: floor.x + reachX,
      y: floor.y + 30,
      vy: tuning.BOUNCE_VELOCITY,
    });

    const result = advance(flush, noInput());

    expect(playerOf(result.state).visitedFloorIds).toContain(floor.id);
  });

  it("emits a stable event id that survives a replayed step", () => {
    const a = landOn(1, freshRaceState());
    const b = landOn(1, freshRaceState());
    expect(a.events[0]!.id).toBe(b.events[0]!.id);
  });

  it("never grounds a player on a floor it has not credited them", () => {
    // `grounded` and `creditFloor` are written on the same three lines of
    // `resolvePlatformLandings`, and this is the invariant that pairing buys.
    // A grounded player with nothing to show for it is the bug that started
    // this; fuzzed play is what would find it coming back.
    let state = freshRaceState();
    let input = inputFor({ right: true });

    for (let tick = 1; tick <= TICK_HZ * 30; tick += 1) {
      if (state.phase !== "racing") break;
      if (tick % 17 === 0) {
        const goingRight = Math.floor(tick / 17) % 2 === 0;
        input = inputFor({ right: goingRight, left: !goingRight, fastFall: tick % 51 === 0 });
      }

      const result = advance(state, input);
      state = result.state;
      const player = playerOf(state);
      if (!player.grounded) continue;

      const standingOn = state.course.floors.filter((floor) => {
        const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
        const top = floor.y + tuning.FLOOR_HEIGHT / 2;
        const bottom = player.y - tuning.PLAYER_HEIGHT / 2;
        return Math.abs(player.x - floorX(state, floor)) <= reachX && Math.abs(bottom - top) < 0.001;
      });

      for (const floor of standingOn) {
        expect(
          player.visitedFloorIds,
          `grounded on floor ${floor.index} at tick ${tick} without credit`,
        ).toContain(floor.id);
      }
    }
  });
});

describe("contact upforce", () => {
  // The reference applies its jump force on any platform contact, not only on
  // a landing (`References/FloorFiftyVerticalSlice/src/player.rs:128`). Contact
  // with a side or an underside is what turns a floor overhead from a ceiling
  // into a wall you can ride, so these tests pin the lift and the push-out
  // without letting either become a way to earn a floor.
  const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
  const reachY = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;

  /**
   * A floor that holds still.
   *
   * A moving floor advances before contact resolves, so a test that placed a
   * player against one would be asserting against a face that has since slid
   * out from under it.
   */
  function stationaryFloor(state: RaceState): Floor {
    return state.course.floors.find((floor) => floor.index > 0 && floor.kind === "stationary")!;
  }

  it("bounces a player who rises into a floor's underside", () => {
    const floor = stationaryFloor(freshRaceState());
    const under = stateWithPlayer({
      x: floor.x,
      y: floor.y - reachY,
      vy: tuning.BOUNCE_VELOCITY,
    });

    const result = advance(under, noInput());
    const player = playerOf(result.state);

    expect(player.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 5);
    // Held at the underside, inside the solver's contact skin and never in it.
    expect(floor.y - reachY - player.y).toBeGreaterThanOrEqual(0);
    expect(floor.y - reachY - player.y).toBeLessThanOrEqual(CONTACT_TOLERANCE_PIXELS);
    expect(result.events).toEqual([]);
  });

  it("bounces a player who runs into a floor's side", () => {
    const floor = stationaryFloor(freshRaceState());
    const beside = stateWithPlayer({ x: floor.x + reachX - 2, y: floor.y, vy: 0 });

    const result = advance(beside, inputFor({ left: true }));
    const player = playerOf(result.state);

    expect(player.vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 5);
    // Pushed back to the face, inside the solver's contact skin.
    expect(player.x - (floor.x + reachX)).toBeGreaterThanOrEqual(0);
    expect(player.x - (floor.x + reachX)).toBeLessThanOrEqual(CONTACT_TOLERANCE_PIXELS);
    expect(result.events).toEqual([]);
  });

  it("carries a player pinned under a floor up around its edge", () => {
    // The wall jump. Held against an underside the player cannot rise, but the
    // upforce never stops, so steering sideways walks them to the edge and
    // releases them past it still travelling at full bounce speed.
    const floor = stationaryFloor(freshRaceState());
    let current = stateWithPlayer({
      x: floor.x,
      y: floor.y - reachY,
      vy: tuning.BOUNCE_VELOCITY,
    });

    const floorTop = floor.y + tuning.FLOOR_HEIGHT / 2;
    let cleared = false;
    for (let tick = 0; tick < 4 * TICK_HZ; tick += 1) {
      current = advance(current, inputFor({ right: true })).state;
      if (playerOf(current).y - tuning.PLAYER_HEIGHT / 2 > floorTop) {
        cleared = true;
        break;
      }
      // Never through it. The player is pinned under the floor, then rides up
      // its side once past the edge, but is never inside its body.
      const inside =
        Math.abs(playerOf(current).x - floor.x) < reachX - 1e-6 &&
        Math.abs(playerOf(current).y - floor.y) < reachY - 1e-6;
      expect(inside).toBe(false);
    }

    expect(cleared).toBe(true);
    // Clear of the floor horizontally, which is the only way past it: the
    // player walked out from under the edge, they did not rise through it.
    expect(Math.abs(playerOf(current).x - floor.x)).toBeGreaterThanOrEqual(reachX);
    expect(playerOf(current).visitedFloorIds).not.toContain(floor.id);
  });

  it("lets a held fast fall beat the upforce from a side", () => {
    const floor = stationaryFloor(freshRaceState());
    const beside = stateWithPlayer({ x: floor.x + reachX - 2, y: floor.y, vy: 0 });

    const result = advance(beside, inputFor({ fastFall: true }));

    expect(playerOf(result.state).vy).toBeCloseTo(tuning.FAST_FALL_VELOCITY, 5);
  });

  it("does not read the spawn seat as a contact", () => {
    // `spawnPosition` rests the player's bottom exactly on the starting floor's
    // top face. Treating that as an overlap would re-bounce every player on the
    // first tick of every race, hiding one tick of gravity.
    const result = advance(freshRaceState(), noInput());

    expect(playerOf(result.state).vy).toBeCloseTo(
      tuning.BOUNCE_VELOCITY + tuning.GRAVITY / TICK_HZ,
      5,
    );
  });

  it("cannot be tunnelled through at any speed the race can reach", () => {
    // Contact is a discrete overlap test rather than a sweep, so it sees a
    // floor only if the player still overlaps it once the tick's movement is
    // done. That holds while one tick of falling is shorter than the overlap
    // band. The swept top-side test covers the one case where a miss would
    // cost a player progress; a missed side brush only means falling past.
    const courseFall =
      (tuning.COURSE_FLOOR_COUNT - 1) * tuning.FLOOR_GAP_MAX + tuning.DEATH_LINE_MARGIN;
    const plunge = Math.sqrt(2 * Math.abs(tuning.GRAVITY) * courseFall);
    const fastest = Math.max(Math.abs(tuning.FAST_FALL_VELOCITY), plunge);

    expect(fastest / TICK_HZ).toBeLessThan(reachY);
  });
});

describe("moving floors", () => {
  it("reverses a moving floor at the horizontal bounds", () => {
    const state = freshRaceState(1, resolveTuning({ COURSE_FLOOR_COUNT: 100 }));
    const moving = state.course.floors.find((floor) => floor.kind === "moving")!;
    const pinned = {
      ...state,
      movingFloors: {
        ...state.movingFloors,
        [moving.id]: {
          id: moving.id,
          x: state.course.bounds.right,
          direction: 1 as const,
          speed: moving.speed,
        },
      },
    };
    const result = advance(pinned, noInput());
    expect(result.state.movingFloors[moving.id]!.direction).toBe(-1);
    expect(result.state.movingFloors[moving.id]!.x).toBeLessThanOrEqual(state.course.bounds.right);
  });

  it("leaves a stationary floor where the generator put it", () => {
    const state = freshRaceState();
    const stationary = state.course.floors.find(
      (floor) => floor.kind === "stationary" && floor.index > 0,
    )!;
    const result = advance(state, noInput());
    expect(floorX(result.state, stationary)).toBe(stationary.x);
  });
});

describe("resets", () => {
  it("respawns a player who falls below the death line", () => {
    const state = stateWithPlayer({ y: freshRaceState().course.deathLineY - 1, vy: -100 });
    const result = advance(state, noInput());
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "playerReset", reason: "fall" }),
    );
    expect(result.state.players[PLAYER_ID]!.y).toBeGreaterThan(state.course.floors[0]!.y);
  });

  it("respawns only the requesting player on a manual reset", () => {
    const climbed = landOn(1, freshRaceState()).state;
    const result = advance(climbed, inputFor({ reset: true, sequence: 2 }));
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "playerReset", reason: "manual" }),
    );
    expect(result.state.players[PLAYER_ID]!.visitedFloorIds).toEqual([
      climbed.course.floors[0]!.id,
    ]);
  });

  it("keeps a reset player on their current lap", () => {
    const state = stateWithPlayer({ lap: 2, y: freshRaceState().course.deathLineY - 1 }, 3);
    expect(advance(state, noInput()).state.players[PLAYER_ID]!.lap).toBe(2);
  });

  it("respawns once per press, however long the room holds the frame", () => {
    // `reset` is an edge: one press is one respawn. But a room keeps a frame in
    // force on every tick until a newer one takes over (`InputQueue.take`), so
    // a frame carrying a reset is seen again on every tick until the next one
    // arrives -- late, dropped, or never sent. A held edge would be a respawn
    // on each of those ticks.
    const held = inputFor({ reset: true, right: true, sequence: 2 });

    let state = landOn(1, freshRaceState()).state;
    let respawns = 0;
    for (let tick = 0; tick < TICK_HZ; tick += 1) {
      const result = advance(state, held);
      state = result.state;
      respawns += result.events.filter((event) => event.type === "playerReset").length;
    }

    expect(respawns, "one press, one respawn").toBe(1);
  });

  it("respawns again when the player presses it a second time", () => {
    // The edge is per frame, not once per race: a newer sequence is a new press.
    let state = landOn(1, freshRaceState()).state;

    const first = advance(state, inputFor({ reset: true, sequence: 2 }));
    state = first.state;
    const second = advance(state, inputFor({ reset: true, sequence: 3 }));

    expect(first.events.filter((event) => event.type === "playerReset")).toHaveLength(1);
    expect(second.events.filter((event) => event.type === "playerReset")).toHaveLength(1);
  });

  it("still holds a direction across ticks, which is not an edge", () => {
    // The guard is for `reset` alone. Movement is a held state and a room that
    // re-applies the same frame must keep moving the player.
    const held = inputFor({ right: true, sequence: 2 });

    let state = freshRaceState();
    state = advance(state, held).state;
    const afterOne = playerOf(state).x;
    state = advance(state, held).state;

    expect(playerOf(state).x).not.toBeCloseTo(afterOne, 5);
    expect(playerOf(state).vx).toBeCloseTo(tuning.MAX_MOVE_SPEED, 5);
  });
});

describe("tuned reachability", () => {
  // These are the properties the movement defaults were tuned to satisfy. They
  // are what make an ascent playable, so they are asserted rather than trusted.
  const apex = (tuning.BOUNCE_VELOCITY * tuning.BOUNCE_VELOCITY) / (2 * Math.abs(tuning.GRAVITY));

  it("clears the largest floor gap on one bounce", () => {
    expect(apex).toBeGreaterThan(tuning.FLOOR_GAP_MAX);
  });

  it("cannot reach two floors up, which would strand the floor between them", () => {
    // A landing always bounces a player upward, so a skipped floor can only be
    // revisited by falling the whole course and losing the ascent.
    expect(apex).toBeLessThan(tuning.FLOOR_GAP_MIN * 2);
  });

  it("can cross the course horizontally within one bounce", () => {
    // Horizontal wrap makes half the viewport the furthest a player ever has to
    // travel to line up with the next floor, and one bounce is rise plus fall.
    const airtimeSeconds = (2 * tuning.BOUNCE_VELOCITY) / Math.abs(tuning.GRAVITY);
    expect(tuning.MAX_MOVE_SPEED * airtimeSeconds).toBeGreaterThan(VIEWPORT.width / 2);
  });

  it("completes an ascent under a bot that only steers toward the next floor", () => {
    // Drives the real simulation rather than the arithmetic above, and stays a
    // separate bot from `steering.ts` so the two cannot drift into agreeing
    // with each other. It reads snapshot-visible floor positions and holds
    // left or right, and it knows only what the rules make unavoidable:
    // contact lifts a player whichever face they touch, so a climb presses
    // into a floor and rides it rather than going around it.
    let state = freshRaceState();
    const deadline = TICK_HZ * 240;
    const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
    const reachY = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;

    for (let tick = 0; tick < deadline && state.phase === "racing"; tick += 1) {
      const player = playerOf(state);
      // The floor the ascent still needs; when it is above the player, climb via
      // the next floor up, and when the player has risen past it, drop onto it.
      const required = state.course.floors.find(
        (floor) => !player.visitedFloorIds.includes(floor.id),
      );
      const nextUp = state.course.floors.find((floor) => floor.y > player.y);
      const target = required !== undefined && required.y <= player.y ? required : nextUp;

      const centre = target === undefined ? player.x : floorX(state, target);
      const above =
        target !== undefined &&
        player.y - tuning.PLAYER_HEIGHT / 2 > target.y + tuning.FLOOR_HEIGHT / 2;

      // The bot chases the centre, because pressing into a floor is what
      // generates lift. The one arrangement that deadlocks is being held
      // against an underside, where the contact re-applies the bounce and the
      // solver returns the player to the same spot; that is the case whose
      // shallower penetration is vertical and downward, and the only one that
      // steers for an edge instead. The solver rests a held player inside its
      // contact skin, so "held" allows that much gap.
      const dy = target === undefined ? 0 : player.y - target.y;
      const penetrationX = reachX - Math.abs(centre - player.x);
      const penetrationY = reachY - Math.abs(dy);
      const roofed =
        penetrationX >= -CONTACT_TOLERANCE_PIXELS &&
        penetrationY >= -CONTACT_TOLERANCE_PIXELS &&
        dy < 0 &&
        penetrationY <= penetrationX;
      const aim = roofed
        ? centre - Math.sign(centre - player.x || 1) * (reachX + 8)
        : centre;
      const offset = aim - player.x;

      state = advance(
        { ...state, tick: state.tick + 1 },
        inputFor({
          right: offset > 1,
          left: offset < -1,
          fastFall: above && Math.abs(centre - player.x) < reachX * 0.8,
          sequence: tick,
        }),
      ).state;
    }

    expect(state.phase).toBe("finished");
  });
});

describe("determinism", () => {
  it("produces byte-equal results for two runs of identical inputs", () => {
    const run = (): string => {
      let state = freshRaceState();
      const events = [];
      for (let tick = 0; tick < 1_000; tick += 1) {
        const input = inputFor({ right: tick % 2 === 0, left: tick % 3 === 0, sequence: tick });
        const result = advance(state, input);
        state = result.state;
        events.push(...result.events);
      }
      return JSON.stringify({ state, events });
    };
    expect(run()).toBe(run());
  });

  it("never lets a player leave the logical horizontal viewport", () => {
    let state = freshRaceState();
    for (let tick = 0; tick < 1_000; tick += 1) {
      state = advance(state, inputFor({ right: true, sequence: tick })).state;
      expect(Math.abs(playerOf(state).x)).toBeLessThanOrEqual(VIEWPORT.width / 2);
    }
  });
});

describe("the race start", () => {
  /** Steps `ticks` times with the same inputs, carrying the state through. */
  function run(state: RaceState, ticks: number, inputs = noInput()): RaceState {
    let current = state;
    for (let i = 0; i < ticks; i += 1) current = { ...advance(current, inputs).state, tick: current.tick + 1 };
    return current;
  }

  it("stands a player on the starting floor until they touch a control", () => {
    const start = waitingRaceState();
    const spawn = spawnPosition(start.course, tuning);

    const later = run(start, 2 * TICK_HZ);

    expect(playerOf(later)).toMatchObject({ x: spawn.x, y: spawn.y, vx: 0, vy: 0, awaitingInput: true });
  });

  it("does not count a neutral frame as touching a control", () => {
    const later = run(waitingRaceState(), 10, inputFor({}));
    expect(playerOf(later).awaitingInput).toBe(true);
    expect(playerOf(later).vy).toBe(0);
  });

  it.each([["left"], ["right"], ["fastFall"]] as const)("starts the bounce on a first %s", (control) => {
    const first = advance(waitingRaceState(), inputFor({ [control]: true })).state;
    expect(playerOf(first).awaitingInput).toBe(false);
    if (control !== "fastFall") expect(playerOf(first).vy).toBeGreaterThan(0);
  });

  it("goes up the course once started, as the bounce always has", () => {
    const start = waitingRaceState();
    const spawn = spawnPosition(start.course, tuning);
    const started = advance(start, inputFor({ right: true })).state;

    const later = run(started, 10);

    expect(playerOf(later).y).toBeGreaterThan(spawn.y);
  });

  it("bounces straight away after a respawn rather than waiting again", () => {
    const reset = advance(waitingRaceState(), inputFor({ reset: true })).state;
    expect(playerOf(reset).awaitingInput).toBe(false);
    expect(playerOf(reset).vy).toBe(tuning.BOUNCE_VELOCITY);
  });
});
