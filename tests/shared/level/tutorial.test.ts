import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { createRaceState, floorX, type PlayerState, type RaceState } from "@floor-fifty/shared/common/state";
import type { TutorialContent } from "@floor-fifty/shared/content/game-content";
import { createClimbController, wrappedOffset } from "@floor-fifty/shared/level/steering";
import {
  CAUGHT_TICKS,
  CLEARED_MAX_TICKS,
  CLEARED_TICKS,
  MIN_FREEZE_TICKS,
  SURVIVE_FLOORS,
  TutorialScript,
  floorUnder,
  tutorialEdgeY,
  unlocksStep,
  type TutorialStepKind,
} from "@floor-fifty/shared/level/tutorial";
import type { Course } from "@floor-fifty/shared/level/course";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { PLAYER_ID, freshRaceState, stateWithPlayer } from "../support/race";

const idle = { left: false, right: false, fastFall: false, reset: false };
const tick = (overrides: { input?: Partial<typeof idle>; vx?: number; vy?: number; events?: RaceEvent[] } = {}) => ({
  playerId: PLAYER_ID,
  input: { ...idle, ...overrides.input },
  after: stateWithPlayer({ vx: overrides.vx ?? 0, ...(overrides.vy === undefined ? {} : { vy: overrides.vy }) }),
  events: overrides.events ?? [],
});
const landed = (floorIndex: number, floorId = `f${floorIndex}`): RaceEvent =>
  ({ type: "floorLanded", playerId: PLAYER_ID, floorId, floorIndex, id: `e${floorIndex}`, tick: 1 }) as RaceEvent;

/** The tutorial script as the run builds it: the steps, and the course it reads floors from. */
function newScript(
  steps: readonly TutorialStepKind[],
  course: Pick<Course, "floors" | "floorCount"> = freshRaceState().course,
): TutorialScript {
  return new TutorialScript(steps, course);
}

/** Every step's unlock at once, for tests about what follows the freeze. */
const anyControl = { left: true, right: false, fastFall: true, reset: true };

/** Holds still through the least freeze, then presses the step's control. */
function unfreeze(script: TutorialScript, press: Partial<typeof idle> = anyControl): void {
  for (let t = 0; t < MIN_FREEZE_TICKS; t += 1) script.observeFrozen(idle);
  expect(script.observeFrozen({ ...idle, ...press })).toBe(true);
  expect(script.phase).toBe("active");
}

/** A fresh script whose first step is already let go. */
function playing(steps: TutorialStepKind[]): TutorialScript {
  const script = newScript(steps);
  unfreeze(script);
  return script;
}

/** Plays out a cleared step's pause, landing on the next step's freeze. */
function holdCleared(script: TutorialScript, input: Partial<typeof idle> = {}): void {
  for (let t = 0; t < CLEARED_TICKS; t += 1) script.observe(tick({ input }));
}

describe("the tutorial's pacing", () => {
  it("opens each step frozen, and simulated ticks credit nothing while it is", () => {
    const script = newScript(["land"]);
    expect(script.phase).toBe("frozen");
    expect(script.observe(tick({ events: [landed(1)] }))).toBe(false);
    expect(script.index).toBe(0);
  });

  it("stays frozen for the least freeze, even under the right press", () => {
    const script = newScript(["fastFall"]);
    expect(script.observeFrozen({ ...idle, fastFall: true })).toBe(false);
    for (let t = 1; t < MIN_FREEZE_TICKS + 5; t += 1) script.observeFrozen({ ...idle, fastFall: true });
    // Held through the freeze, it never went down while frozen: still frozen.
    expect(script.phase).toBe("frozen");
    script.observeFrozen(idle);
    expect(script.observeFrozen({ ...idle, fastFall: true })).toBe(true);
  });

  it("is let go only by the step's own control", () => {
    const script = newScript(["fastFall"]);
    for (let t = 0; t < MIN_FREEZE_TICKS; t += 1) script.observeFrozen(idle);
    expect(script.observeFrozen({ ...idle, left: true, reset: true })).toBe(false);
    expect(script.observeFrozen({ ...idle, fastFall: true })).toBe(true);
  });

  it("stands cleared for a pause that credits nothing, then freezes the next step", () => {
    const script = playing(["land", "landMoving"]);
    const moving = freshRaceState().course.floors.findIndex((floor) => floor.kind === "moving");
    expect(script.observe(tick({ events: [landed(1)] }))).toBe(true);
    expect(script.phase).toBe("cleared");
    expect(script.current).toBe("land");
    // A landing in the pause would have cleared `landMoving`; it is not counted.
    expect(script.observe(tick({ events: [landed(moving, freshRaceState().course.floors[moving]!.id)] }))).toBe(false);
    holdCleared(script);
    expect(script.current).toBe("landMoving");
    expect(script.phase).toBe("frozen");
    expect(script.done).toBe(false);
  });

  it("does not let a control held over from the last step unfreeze the next", () => {
    const script = playing(["land", "landMoving"]);
    script.observe(tick({ events: [landed(1)] }));
    holdCleared(script, { right: true });
    for (let t = 0; t < MIN_FREEZE_TICKS + 30; t += 1) script.observeFrozen({ ...idle, right: true });
    expect(script.phase).toBe("frozen");
    script.observeFrozen(idle);
    expect(script.observeFrozen({ ...idle, right: true })).toBe(true);
  });

  it("is done once the last step's pause has played", () => {
    const script = playing(["land"]);
    script.observe(tick({ events: [landed(1)] }));
    expect(script.done).toBe(false);
    holdCleared(script);
    expect(script.done).toBe(true);
  });
});

describe("the tutorial script", () => {
  it("needs both directions before 'move' is done", () => {
    const script = playing(["move", "land"]);
    expect(script.observe(tick({ vx: -60 }))).toBe(false);
    expect(script.observe(tick({ vx: 60 }))).toBe(true);
    holdCleared(script);
    expect(script.current).toBe("land");
  });

  it("completes a landing only on a real floorLanded event above the start", () => {
    const script = playing(["land"]);
    expect(script.observe(tick({ input: { right: true } }))).toBe(false);
    expect(script.observe(tick({ events: [landed(0)] }))).toBe(false);
    expect(script.observe(tick({ events: [landed(1)] }))).toBe(true);
    expect(script.phase).toBe("cleared");
  });

  it("completes fast-fall only when the simulation applied it", () => {
    const tuning = freshRaceState().tuning;
    const script = playing(["fastFall"]);
    expect(script.observe(tick({ input: { fastFall: true }, vy: 0 }))).toBe(false);
    expect(script.observe(tick({ input: { fastFall: true }, vy: tuning.FAST_FALL_VELOCITY }))).toBe(true);
  });

  it("completes 'landMoving' only on a landing on a moving floor", () => {
    const course = freshRaceState().course;
    const moving = course.floors.findIndex((floor) => floor.kind === "moving");
    const still = course.floors.findIndex((floor, index) => index > 0 && floor.kind !== "moving");
    expect(moving).toBeGreaterThan(0);
    const script = playing(["landMoving"]);
    expect(script.observe(tick({ events: [landed(still, course.floors[still]!.id)] }))).toBe(false);
    expect(script.observe(tick({ events: [landed(moving, course.floors[moving]!.id)] }))).toBe(true);
  });

  it("checks only the current step, in order", () => {
    const script = playing(["move", "land"]);
    expect(script.observe(tick({ events: [landed(1)] }))).toBe(false);
    expect(script.index).toBe(0);
  });

  it("skips to done", () => {
    const script = newScript(["move", "land"]);
    script.skip();
    expect(script.done).toBe(true);
    expect(script.current).toBeUndefined();
    expect(script.observe(tick({ vx: 60 }))).toBe(false);
  });
});

describe("the survive step", () => {
  const course = freshRaceState().course;
  const floorY = (index: number) => course.floors[index]!.y;
  const tuning = resolveTuning();
  /** A body at the given overrides, with the events of its tick. */
  const tickWith = (overrides: Partial<PlayerState> & { events?: RaceEvent[] } = {}) => {
    const { events, ...body } = overrides;
    return { playerId: PLAYER_ID, input: idle, after: stateWithPlayer(body), events: events ?? [] };
  };
  const observeTicks = (script: TutorialScript, count: number, body: Partial<PlayerState>) => {
    for (let t = 0; t < count; t += 1) script.observe(tickWith(body));
  };
  const landing = (index: number) =>
    tickWith({ grounded: true, y: floorY(index) + 30, events: [landed(index, course.floors[index]!.id)] });

  /**
   * A script whose step before `survive` has just been cleared, with `creditedUpTo`
   * floors credited on the way (the moving floor, 5, is what clears it).
   */
  function clearedBeforeSurvive(
    options: { creditedUpTo?: number; floorCount?: number; moving?: readonly number[] } = {},
  ): TutorialScript {
    // The last step begins only on a floor that holds still, so the script's course holds every floor still but
    // the ones a test names (the course's own kinds are the authored probe's business).
    const floors = course.floors.map((floor) => ({
      ...floor,
      kind: options.moving?.includes(floor.index) === true ? ("moving" as const) : ("stationary" as const),
    }));
    const script = newScript(["landMoving", "survive"], { floors, floorCount: options.floorCount ?? course.floorCount });
    unfreeze(script);
    const credited = Math.max(options.creditedUpTo ?? 5, 5);
    const events = Array.from({ length: credited }, (_, at) => landed(at + 1, course.floors[at + 1]!.id));
    expect(script.observe(tickWith({ events, y: floorY(credited) + 30 }))).toBe(true);
    return script;
  }

  /** The step begun the way a run begins it: she lands on `landsOn` after the pause. */
  function atSurvive(options: { creditedUpTo?: number; landsOn: number; floorCount?: number; moving?: readonly number[] }): TutorialScript {
    const script = clearedBeforeSurvive(options);
    observeTicks(script, CLEARED_TICKS, { grounded: false, y: floorY(options.landsOn) + 60 });
    script.observe(tickWith({ grounded: true, y: floorY(options.landsOn) + 30 }));
    expect(script.current).toBe("survive");
    return script;
  }

  const active = (script: TutorialScript): TutorialScript => {
    unfreeze(script);
    return script;
  };

  it("declares a slow tutorial edge", () => {
    expect(tuning).toMatchObject({ TUTORIAL_EDGE_RISE: 30, TUTORIAL_EDGE_START_BELOW: 240 });
  });

  it("puts the edge a fixed way under the start floor and raises it at the declared speed", () => {
    expect(tutorialEdgeY(500, 0, tuning)).toBe(260);
    expect(tutorialEdgeY(500, TICK_HZ * 2, tuning)).toBeCloseTo(320, 6);
  });

  it("finds the floor under a body: the one she stands on, and the one below her in the air", () => {
    expect(floorUnder(stateWithPlayer({ y: floorY(4) + 30 }), PLAYER_ID)).toBe(4);
    expect(floorUnder(stateWithPlayer({ y: floorY(5) - 1 }), PLAYER_ID)).toBe(4);
    expect(floorUnder(stateWithPlayer({ y: -50 }), PLAYER_ID)).toBe(0);
  });

  it("waits for a landing before the step starts: in the air, the step before it stays cleared", () => {
    const script = clearedBeforeSurvive();
    observeTicks(script, CLEARED_TICKS + 20, { grounded: false, y: floorY(5) + 60 });
    expect(script.current).toBe("landMoving");
    expect(script.phase).toBe("cleared");
    script.observe(tickWith({ grounded: true, y: floorY(4) + 30 }));
    expect(script.current).toBe("survive");
    expect(script.phase).toBe("frozen");
  });

  it("waits for a floor that holds still: a landing on a moving one leaves the step before it cleared", () => {
    const script = clearedBeforeSurvive({ moving: [3, 4] });
    observeTicks(script, CLEARED_TICKS, { grounded: false, y: floorY(5) + 60 });
    script.observe(tickWith({ grounded: true, y: floorY(4) + 30 }));
    expect(script.current).toBe("landMoving");
    expect(script.phase).toBe("cleared");
    // The step begins on the first landing after that on a floor that holds still.
    script.observe(tickWith({ grounded: true, y: floorY(2) + 30 }));
    expect(script.current).toBe("survive");
    expect(script.phase).toBe("frozen");
    expect(script.surviveGoalFloor).toBe(2 + SURVIVE_FLOORS);
  });

  it("does not hold her on \"Nice.\" for ever: past the bound, the next landing begins the step, moving floor or not", () => {
    const script = clearedBeforeSurvive({ moving: [4] });
    // The step cleared on tick 0 of the pause: the bound is reached on its CLEARED_MAX_TICKS-th tick.
    observeTicks(script, CLEARED_MAX_TICKS - 1, { grounded: true, y: floorY(4) + 30 });
    expect(script.current).toBe("landMoving");
    script.observe(tickWith({ grounded: true, y: floorY(4) + 30 }));
    expect(script.current).toBe("survive");
    expect(script.surviveGoalFloor).toBe(4 + SURVIVE_FLOORS);
  });

  it("anchors the edge to the floor she landed on, not the highest one she was credited", () => {
    // Credited up to floor 6 on the way, then dropped two floors: the step starts as she lands on 4.
    const script = atSurvive({ creditedUpTo: 6, landsOn: 4 });
    expect(script.edgeY).toBeCloseTo(floorY(4) - 240, 6);
    expect(script.edgeY!).toBeLessThan(floorY(4));
    expect(script.surviveGoalFloor).toBe(4 + SURVIVE_FLOORS);
  });

  it("has no edge before the survive step, and none once it is skipped", () => {
    const script = newScript(["landMoving", "survive"]);
    expect(script.edgeY).toBeUndefined();
    const started = atSurvive({ landsOn: 4 });
    started.skip();
    expect(started.edgeY).toBeUndefined();
  });

  it("raises the edge 30 a second once she moves", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    observeTicks(script, TICK_HZ, { grounded: true, y: floorY(4) + 30 });
    expect(script.edgeY).toBeCloseTo(floorY(4) - 240 + 30, 6);
  });

  it("stands the edge still while the step is frozen", () => {
    const script = atSurvive({ landsOn: 4 });
    const before = script.edgeY;
    for (let t = 0; t < 30; t += 1) script.observeFrozen(idle);
    expect(script.edgeY).toBe(before);
  });

  it("is done on a landing three floors above where the step began, and not before", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    expect(script.observe(landing(6))).toBe(false);
    expect(script.observe(landing(7))).toBe(true);
    expect(script.phase).toBe("cleared");
  });

  it("is done on a floor she had already visited, which raises no landing event", () => {
    const script = active(atSurvive({ creditedUpTo: 8, landsOn: 4 }));
    expect(script.observe(tickWith({ grounded: true, y: floorY(7) + 30 }))).toBe(true);
  });

  it("is caught when she is wholly below the edge, shows OUT! for 1.5 s, then starts the step again frozen", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    script.observe(tickWith({ y: script.edgeY! - 30 })); // her top is at y + 29.5: under the edge
    expect(script.phase).toBe("caught");
    expect(script.caught).toBe(true);
    for (let i = 0; i < CAUGHT_TICKS - 1; i += 1) expect(script.observeCaught()).toBe(false);
    expect(script.observeCaught()).toBe(true);
    expect(script.phase).toBe("frozen");
    expect(script.caught).toBe(true);
    expect(script.edgeY).toBeCloseTo(floorY(4) - 240, 6);
    unfreeze(script);
    expect(script.caught).toBe(false);
    expect(script.done).toBe(false);
  });

  it("does not catch her while her top is still above the edge", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    script.observe(tickWith({ y: script.edgeY! - 29 }));
    expect(script.phase).toBe("active");
  });

  it("does not let a key held through the catch start the step again", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    script.observe(tickWith({ y: script.edgeY! - 30 }));
    for (let i = 0; i < CAUGHT_TICKS; i += 1) script.observeCaught();
    for (let t = 0; t < MIN_FREEZE_TICKS + 30; t += 1) script.observeFrozen({ ...idle, left: true });
    expect(script.phase).toBe("frozen");
  });

  it("treats a restart press or a fall past the bottom as a catch", () => {
    const script = active(atSurvive({ landsOn: 4 }));
    const manual = { type: "playerReset", playerId: PLAYER_ID, reason: "manual", id: "r", tick: 1 } as RaceEvent;
    script.observe(tickWith({ y: floorY(4) + 30, events: [manual] }));
    expect(script.phase).toBe("caught");
  });

  it("starts the step from the bottom when she is too high to go three more", () => {
    const script = atSurvive({ landsOn: 17, floorCount: 20 });
    expect(script.needsStart).toBe(true);
    expect(script.surviveGoalFloor).toBe(SURVIVE_FLOORS);
    expect(script.edgeY).toBeCloseTo(floorY(0) - 240, 6);
    script.startHandled();
    expect(script.needsStart).toBe(false);
  });

  it("only steering or a fast fall lets the step go", () => {
    expect(unlocksStep("survive", { left: false, right: false, fastFall: false, reset: true })).toBe(false);
    expect(unlocksStep("survive", { left: true, right: false, fastFall: false, reset: false })).toBe(true);
    expect(unlocksStep("survive", { left: false, right: false, fastFall: true, reset: false })).toBe(true);
  });
});

/**
 * The most ticks the plan bot may take to finish the five steps. The six-step tutorial took 723 and the five-step one
 * 590, but the last step now waits for a floor that holds still, and the bot (hands off while "Nice." stands) is
 * measured at 847 on the authored course. The Owner ruled the longer tutorial acceptable (2026-11-15): "tutorial can be
 * as long as it needs to be for the player to understand it". 900 is that measurement with a little headroom: a bound
 * on a runaway wait, not a target.
 */
const TUTORIAL_BOT_TICKS_LIMIT = 900;

const artifact = JSON.parse(
  readFileSync(resolve(__dirname, "../../../content/generated/content.json"), "utf8"),
) as { content: { baseTuning: RaceState["tuning"]; tutorial: TutorialContent } };

/** How the bot plays the authored tutorial. */
type Bot = {
  /** On the last step, wait this many ticks after each landing before climbing on: a slow player. */
  surviveFloorEveryTicks?: number;
  /** On the last step, press once (the press that lets it go) and then keep hands off: an idle player. */
  idleOnSurvive?: boolean;
};

/**
 * Plays the authored tutorial with a bot, through the real simulation and
 * script: scripted where a step asks for a specific control, the reference
 * climber otherwise. It stops at the first catch, because restoring the step
 * after a catch is the run's work (`TutorialRun`, tested there), not the
 * script's.
 *
 * The race starts as a room's does, with the player waiting on the floor for
 * a first input; the `move` step's first press is what starts the bounce.
 * Between the step before the last and the last, the bot keeps its hands off,
 * as a player reading "Nice." does: the last step starts on a landing, and a
 * racer left alone bounces on the floor under her.
 */
function playTutorial(bot: Bot = {}): {
  done: boolean;
  stuckAt?: TutorialStepKind;
  ticks: number;
  catches: number;
  /** Ticks the last step had run when she was first caught (0 when she never was). */
  activeTicksAtCatch: number;
  script: TutorialScript;
} {
  const { seed, steps } = artifact.content.tutorial;
  const kinds = steps.map((step) => step.kind);
  const tuning = artifact.content.baseTuning;
  let state: RaceState = {
    ...createRaceState({ seed, lapCount: 1, tuning, players: [{ id: PLAYER_ID, name: asPlayerName("You") }] }),
    phase: "racing",
    raceStartedAtTick: 0,
  };
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const climber = createClimbController(PLAYER_ID);
  const script = newScript(kinds, state.course);
  let sequence = 0;
  let stepTicks = 0;
  let frozenTicks = 0;
  let creditedFloors = 1;
  let lastCreditTick = 0;
  let catches = 0;
  let activeTicksAtCatch = 0;

  for (let t = 0; t < TICK_HZ * 240 && !script.done; t += 1) {
    const step = script.current!;
    let intent = { left: false, right: false, fastFall: false, reset: false };
    if (script.phase === "frozen") {
      // Hands off until the prompt has had its time, then the step's control.
      frozenTicks += 1;
      if (frozenTicks > MIN_FREEZE_TICKS) intent = { ...intent, left: step !== "fastFall", fastFall: step === "fastFall" };
      if (!script.observeFrozen(intent)) continue;
      frozenTicks = 0;
      stepTicks = 0;
    } else {
      stepTicks += 1;
      const player = state.players[PLAYER_ID]!;
      if (player.visitedFloorIds.length !== creditedFloors) {
        creditedFloors = player.visitedFloorIds.length;
        lastCreditTick = t;
      }
      const readingNice = script.phase === "cleared" && script.index === kinds.length - 2;
      const dawdling =
        step === "survive" &&
        script.phase === "active" &&
        bot.surviveFloorEveryTicks !== undefined &&
        t - lastCreditTick < bot.surviveFloorEveryTicks;
      if (readingNice || (bot.idleOnSurvive === true && step === "survive")) {
        // Hands off.
      } else if (dawdling) {
        // Slow, not idle: stays under the floor she is on, following it if it moves.
        const floor = state.course.floors[floorUnder(state, PLAYER_ID)]!;
        const offset = wrappedOffset(player.x, floorX(state, floor));
        intent = { ...intent, left: offset < -6, right: offset > 6 };
      } else if (script.phase === "active" && step === "move") intent = { ...intent, left: stepTicks < 20, right: stepTicks >= 20 };
      else if (script.phase === "active" && step === "fastFall") intent = { ...intent, fastFall: stepTicks === 10 };
      else {
        const next = climber.next(state, state.tick + 1);
        if (next !== undefined) intent = { left: next.left, right: next.right, fastFall: next.fastFall, reset: next.reset };
      }
    }
    const frame: HeldInput = { sequence: (sequence += 1), ...intent };
    const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map([[PLAYER_ID, frame]]));
    state = result.state;
    if (script.observe({ playerId: PLAYER_ID, input: intent, after: state, events: result.events })) stepTicks = 0;
    if (script.phase === "caught") {
      catches += 1;
      activeTicksAtCatch = stepTicks;
      break;
    }
  }
  simulation.dispose();
  return {
    done: script.done,
    ...(script.done ? {} : { stuckAt: script.current! }),
    ticks: state.tick,
    catches,
    activeTicksAtCatch,
    script,
  };
}

/** The course the tutorial's seed builds, in base tuning. */
const tutorialCourse = (seed: number) =>
  createRaceState({
    seed,
    lapCount: 1,
    tuning: artifact.content.baseTuning,
    players: [{ id: PLAYER_ID, name: asPlayerName("You") }],
  }).course;

/**
 * The lessons come one at a time: the first landing is on a still floor, and a
 * moving one follows soon after, low enough to reach before the survive step.
 */
const teachesInOrder = (seed: number): boolean => {
  const floors = tutorialCourse(seed).floors;
  const firstMoving = floors.findIndex((floor) => floor.kind === "moving");
  return floors[1]?.kind !== "moving" && firstMoving >= 2 && firstMoving <= 5;
};

describe("the authored tutorial course", () => {
  it("lands the player on a still floor first, and a moving one soon after", () => {
    expect(teachesInOrder(artifact.content.tutorial.seed)).toBe(true);
  });

  it("lets a bot finish all five steps", () => {
    const run = playTutorial();
    expect(run.stuckAt).toBeUndefined();
    expect(run.script.done).toBe(true);
    expect(run.catches).toBe(0);
  });

  it("gives a slow player room: one who waits 3.5 s after each landing on the last step is never caught", () => {
    const run = playTutorial({ surviveFloorEveryTicks: 210 });
    expect(run.script.done).toBe(true);
    expect(run.catches).toBe(0);
  });

  // The authored course's floors 3 to 6 and 8 to 10 move, so a racer who stops on one slides off it and falls: that
  // is the floor's doing, and no tuning of the edge changes it (the lava reaches her as she falls past the moving
  // floors, whatever TUTORIAL_EDGE_START_BELOW is). The last step therefore begins only on a floor that holds still.
  it("gives a player who presses once and then stops at least 6 s on the real course before the lava has her", () => {
    const run = playTutorial({ idleOnSurvive: true });
    expect(run.catches).toBe(1);
    expect(run.activeTicksAtCatch).toBeGreaterThanOrEqual(TICK_HZ * 6);
    expect(run.script.phase).toBe("caught");
    expect(run.script.done).toBe(false);
  });

  // The same claim, built by hand: where it is the edge alone that can catch her.
  it("catches a player who stops on a floor that holds still, no sooner than 6 s into the step", () => {
    const { seed } = artifact.content.tutorial;
    const tuning = artifact.content.baseTuning;
    const start = createRaceState({ seed, lapCount: 1, tuning, players: [{ id: PLAYER_ID, name: asPlayerName("You") }] });
    const still = start.course.floors.findIndex((floor, index) => index >= 4 && floor.kind === "stationary");
    expect(still).toBeGreaterThan(0);
    const floor = start.course.floors[still]!;
    // She is standing on that floor and bouncing, as after a landing.
    let state: RaceState = {
      ...start,
      phase: "racing",
      raceStartedAtTick: 0,
      players: {
        [PLAYER_ID]: {
          ...start.players[PLAYER_ID]!,
          awaitingInput: false,
          x: floorX(start, floor),
          y: floor.y + tuning.FLOOR_HEIGHT / 2 + tuning.PLAYER_HEIGHT / 2 + 1,
          vy: tuning.BOUNCE_VELOCITY,
        },
      },
    };
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    const script = newScript(["landMoving", "survive"], state.course);
    unfreeze(script);
    script.observe({ playerId: PLAYER_ID, input: idle, after: state, events: [landed(5, state.course.floors[5]!.id)] });
    let sequence = 0;
    const tickWith = (intent: typeof idle): void => {
      const frame: HeldInput = { sequence: (sequence += 1), ...intent };
      const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map([[PLAYER_ID, frame]]));
      state = result.state;
      script.observe({ playerId: PLAYER_ID, input: intent, after: state, events: result.events });
    };
    // Hands off through the pause: the last step begins on the landing that follows it.
    for (let t = 0; t < TICK_HZ * 10 && script.current !== "survive"; t += 1) tickWith(idle);
    expect(script.current).toBe("survive");
    expect(floorUnder(state, PLAYER_ID)).toBe(still);
    // Frozen: nothing moves until the one press that lets it go.
    for (let t = 0; t < MIN_FREEZE_TICKS; t += 1) script.observeFrozen(idle);
    expect(script.observeFrozen({ ...idle, fastFall: true })).toBe(true);
    tickWith({ ...idle, fastFall: true });
    // Then nothing: how long she lasts is the edge's doing alone.
    let activeTicks = 1;
    for (; activeTicks < TICK_HZ * 60 && script.phase === "active"; activeTicks += 1) tickWith(idle);
    simulation.dispose();
    expect(script.phase).toBe("caught");
    expect(floorUnder(state, PLAYER_ID)).toBe(still);
    expect(activeTicks).toBeGreaterThanOrEqual(TICK_HZ * 6);
  });

  it("keeps the tutorial's length bounded: the plan bot finishes all five steps within the Owner's allowance", () => {
    // Not "no longer than today's" (the spec's old anti-goal, 723): see TUTORIAL_BOT_TICKS_LIMIT.
    expect(playTutorial().ticks).toBeLessThanOrEqual(TUTORIAL_BOT_TICKS_LIMIT);
  });
});
