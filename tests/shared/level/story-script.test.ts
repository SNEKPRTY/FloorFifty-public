import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { createRaceState, floorX, type PlayerState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController, wrappedOffset } from "@floor-fifty/shared/level/steering";
import {
  CAUGHT_TICKS,
  CHIP_RETURN_TICKS,
  CHIP_SHOW_TICKS,
  SURVIVE_FLOORS,
  StoryScript,
  floorUnder,
  storyEdgeY,
  type StoryChapterPlan,
} from "@floor-fifty/shared/level/tutorial";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { PLAYER_ID, freshRaceState, stateWithPlayer } from "../support/race";

const artifact = JSON.parse(
  readFileSync(resolve(__dirname, "../../../content/generated/content.json"), "utf8"),
) as { content: { baseTuning: RaceState["tuning"] } };
/**
 * The first story's four chapters, kept as a fixture: the story that ships no
 * longer uses this script (story mode v2), but the script stays in the shared
 * level code, and these plans are what it was built and proved against.
 */
type OldChapter = StoryChapterPlan & { readonly id: string; readonly stageId: string; readonly songId: string; readonly seed: number };
const story = {
  chapters: JSON.parse(readFileSync(resolve(__dirname, "fixtures/old-story-chapters.json"), "utf8")) as OldChapter[],
};

const idle = { left: false, right: false, fastFall: false, reset: false };
const landed = (floorIndex: number, floorId = `f${floorIndex}`): RaceEvent =>
  ({ type: "floorLanded", playerId: PLAYER_ID, floorId, floorIndex, id: `e${floorIndex}`, tick: 1 }) as RaceEvent;

const course = freshRaceState().course;
const stillCourse = {
  floors: course.floors.map((floor) => ({ ...floor, kind: "stationary" as const })),
  floorCount: course.floorCount,
};
const floorY = (index: number) => course.floors[index]!.y;
const tickWith = (overrides: Partial<PlayerState> & { events?: RaceEvent[]; input?: Partial<typeof idle> } = {}) => {
  const { events, input, ...body } = overrides;
  return { playerId: PLAYER_ID, input: { ...idle, ...input }, after: stateWithPlayer(body), events: events ?? [] };
};

describe("the story script's beats", () => {
  const plan: StoryChapterPlan = {
    goalFloor: 4,
    beats: [
      { when: "start", teaches: "move" },
      { when: "floor", floor: 2 },
      { when: "done", of: "land", teaches: "land" },
      { when: "goal" },
    ],
  };

  it("fires the start beats at once, and each beat only once", () => {
    const script = new StoryScript(plan, stillCourse);
    expect(script.take()).toEqual([0]);
    expect(script.take()).toEqual([]);
    script.observe(tickWith({ events: [landed(1)] }));
    expect(script.take()).toEqual([2]);
    script.observe(tickWith({ events: [landed(1)] }));
    expect(script.take()).toEqual([]);
  });

  it("fires a floor beat when that floor is credited, not before", () => {
    const script = new StoryScript(plan, stillCourse);
    script.take();
    script.observe(tickWith({ events: [landed(1)] }));
    script.take();
    script.observe(tickWith({ events: [landed(2)] }));
    expect(script.take()).toEqual([1]);
  });

  it("ends the chapter on the goal floor once its moves are done, and fires the goal beat then", () => {
    const script = new StoryScript(plan, stillCourse);
    script.take();
    // `move` is read from the simulation: pressing is not enough, she has to be moving that way.
    expect(script.observe(tickWith({ input: { left: true }, vx: 0, events: [landed(4)] }))).toBe(false);
    expect(script.done).toBe(false);
    expect(script.observe(tickWith({ input: { left: true }, vx: -60, events: [landed(4)] }))).toBe(true);
    expect(script.done).toBe(true);
    expect(script.take()).toContain(3);
  });

  it("keeps the chapter open at the goal floor while a move is missing, and says its reason again", () => {
    const tuning = freshRaceState().tuning;
    const fast: StoryChapterPlan = {
      goalFloor: 3,
      beats: [{ when: "floor", floor: 1, teaches: "fastFall" }, { when: "goal" }],
    };
    const script = new StoryScript(fast, stillCourse);
    script.observe(tickWith({ events: [landed(1)] }));
    expect(script.take()).toEqual([0]);
    expect(script.observe(tickWith({ events: [landed(3)] }))).toBe(false);
    expect(script.take()).toEqual([0]);
    expect(script.done).toBe(false);
    expect(
      script.observe(tickWith({ input: { fastFall: true }, vy: tuning.FAST_FALL_VELOCITY, events: [landed(3)] })),
    ).toBe(true);
  });

  it("skips to done", () => {
    const script = new StoryScript(plan, stillCourse);
    script.skip();
    expect(script.done).toBe(true);
    expect(script.observe(tickWith({ vx: 60 }))).toBe(false);
  });
});

describe("the control chip", () => {
  const plan: StoryChapterPlan = {
    goalFloor: 9,
    beats: [
      { when: "start", teaches: "move" },
      { when: "floor", floor: 2, teaches: "fastFall" },
      { when: "floor", floor: 3, teaches: "landMoving" },
    ],
  };
  const idleTicks = (script: StoryScript, count: number) => {
    for (let t = 0; t < count; t += 1) script.observe(tickWith());
  };

  it("is up at its beat, and down the tick the simulation sees the move", () => {
    const script = new StoryScript(plan, stillCourse);
    expect(script.chip).toBe("move");
    script.observe(tickWith({ input: { right: true }, vx: 60 }));
    expect(script.chip).toBeUndefined();
  });

  it("goes after a while, and returns only after 6 s at that beat without the move", () => {
    const script = new StoryScript(plan, stillCourse);
    idleTicks(script, CHIP_SHOW_TICKS - 1);
    expect(script.chip).toBe("move");
    idleTicks(script, 1);
    expect(script.chip).toBeUndefined();
    idleTicks(script, CHIP_RETURN_TICKS - CHIP_SHOW_TICKS - 1);
    expect(script.chip).toBeUndefined();
    idleTicks(script, 1);
    expect(script.chip).toBe("move");
    script.observe(tickWith({ input: { left: true }, vx: -60 }));
    expect(script.chip).toBeUndefined();
  });

  it("names the move of the latest beat, and never shows for landing, moving floors or the lava", () => {
    const script = new StoryScript(plan, stillCourse);
    script.observe(tickWith({ input: { left: true }, vx: -60, events: [landed(2)] }));
    expect(script.chip).toBe("fastFall");
    script.observe(tickWith({ input: { left: true }, vx: -60, events: [landed(3)] }));
    expect(script.chip).toBeUndefined();
  });
});

describe("the lava beat", () => {
  const tuning = resolveTuning();
  const plan: StoryChapterPlan = {
    goalFloor: 3 + SURVIVE_FLOORS,
    beats: [
      { when: "floor", floor: 3, teaches: "survive" },
      { when: "caught" },
    ],
  };
  const standing = (index: number) =>
    tickWith({ grounded: true, y: floorY(index) + 30, events: [landed(index, course.floors[index]!.id)] });

  it("declares a slow edge", () => {
    expect(tuning).toMatchObject({ TUTORIAL_EDGE_RISE: 30, TUTORIAL_EDGE_START_BELOW: 240 });
  });

  it("puts the edge a fixed way under the start floor and raises it at the declared speed", () => {
    expect(storyEdgeY(500, 0, tuning)).toBe(260);
    expect(storyEdgeY(500, TICK_HZ * 2, tuning)).toBeCloseTo(320, 6);
  });

  it("finds the floor under a body: the one she stands on, and the one below her in the air", () => {
    expect(floorUnder(stateWithPlayer({ y: floorY(4) + 30 }), PLAYER_ID)).toBe(4);
    expect(floorUnder(stateWithPlayer({ y: floorY(5) - 1 }), PLAYER_ID)).toBe(4);
    expect(floorUnder(stateWithPlayer({ y: -50 }), PLAYER_ID)).toBe(0);
  });

  it("begins on the first landing on a floor that holds still, from the beat's floor on", () => {
    const moving = {
      ...stillCourse,
      floors: stillCourse.floors.map((floor) => (floor.index === 3 ? { ...floor, kind: "moving" as const } : floor)),
    };
    const script = new StoryScript(plan, moving);
    script.observe(standing(3));
    expect(script.edgeY).toBeUndefined();
    script.observe(standing(4));
    expect(script.edgeY).toBeDefined();
    expect(script.surviveGoalFloor).toBe(4 + SURVIVE_FLOORS);
  });

  it("is done, and the chapter with it, on reaching its goal floor", () => {
    const script = new StoryScript(plan, stillCourse);
    script.observe(standing(3));
    expect(script.done).toBe(false);
    expect(script.observe(standing(3 + SURVIVE_FLOORS))).toBe(true);
    expect(script.hasDone("survive")).toBe(true);
  });

  it("catches a player below the edge, stands for 'OUT!', then starts the beat again", () => {
    const script = new StoryScript(plan, stillCourse);
    script.observe(standing(3));
    script.take();
    const edge = script.edgeY!;
    script.observe(tickWith({ grounded: false, y: edge - 200 }));
    expect(script.caught).toBe(true);
    expect(script.standing).toBe(true);
    expect(script.take()).toEqual([1]);
    for (let t = 1; t < CAUGHT_TICKS; t += 1) expect(script.observeCaught()).toBe(false);
    expect(script.observeCaught()).toBe(true);
    expect(script.caught).toBe(false);
    expect(script.edgeY).toBe(storyEdgeY(floorY(3), 0, tuning));
    expect(script.done).toBe(false);
  });
});

// ----- The authored chapters, played by a bot ------------------------------------------------------------------

type Bot = {
  /** On the lava beat, wait this many ticks after each landing before climbing on: a slow player. */
  surviveFloorEveryTicks?: number;
  /** On the lava beat, stop climbing and stay under the floor she is on: a player who has stopped. */
  stopsOnSurvive?: boolean;
};

/** Plays chapter `index` on its authored seed with the shared climb bot, which fast falls when the chapter asks. */
function playChapter(index: number, bot: Bot = {}) {
  const chapter = story.chapters[index]!;
  const tuning = artifact.content.baseTuning;
  let state: RaceState = {
    ...createRaceState({ seed: chapter.seed, lapCount: 1, tuning, players: [{ id: PLAYER_ID, name: asPlayerName("You") }] }),
    phase: "racing",
    raceStartedAtTick: 0,
  };
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const climber = createClimbController(PLAYER_ID);
  const script = new StoryScript(chapter, state.course);
  let sequence = 0;
  let creditedFloors = 1;
  let lastCreditTick = 0;
  let catches = 0;
  let lavaTicks = 0;
  let activeTicksAtCatch = 0;
  let fastFallHeld = 0;

  for (let t = 0; t < TICK_HZ * 240 && !script.done; t += 1) {
    const player = state.players[PLAYER_ID]!;
    if (player.visitedFloorIds.length !== creditedFloors) {
      creditedFloors = player.visitedFloorIds.length;
      lastCreditTick = t;
    }
    let intent = { ...idle };
    const lava = script.edgeY !== undefined;
    const dawdles =
      lava && (bot.stopsOnSurvive === true || (bot.surviveFloorEveryTicks !== undefined && t - lastCreditTick < bot.surviveFloorEveryTicks));
    if (dawdles) {
      // Slow, not idle: stays under the floor she is on, following it if it moves.
      const floor = state.course.floors[floorUnder(state, PLAYER_ID)]!;
      const offset = wrappedOffset(player.x, floorX(state, floor));
      intent = { ...intent, left: offset < -6, right: offset > 6 };
    } else {
      const next = climber.next(state, state.tick + 1);
      if (next !== undefined) intent = { left: next.left, right: next.right, fastFall: next.fastFall, reset: next.reset };
      // The one move a course cannot force: dropped fast, in the air, when the chapter asks for it and it has not been done.
      const wantsFastFall = script.teaches.includes("fastFall") && !script.hasDone("fastFall") && script.floor >= 3;
      if (wantsFastFall && !player.grounded && fastFallHeld < 4 && player.vy < 0) {
        intent = { ...intent, fastFall: true };
        fastFallHeld += 1;
      }
    }
    if (lava) lavaTicks += 1;
    const frame: HeldInput = { sequence: (sequence += 1), ...intent };
    const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map([[PLAYER_ID, frame]]));
    state = result.state;
    script.observe({ playerId: PLAYER_ID, input: intent, after: state, events: result.events });
    if (script.caught) {
      catches += 1;
      activeTicksAtCatch = lavaTicks;
      break;
    }
  }
  simulation.dispose();
  return { script, catches, activeTicksAtCatch, ticks: state.tick };
}

describe("the authored chapters", () => {
  it("has the four chapters on the four stages", () => {
    expect(story.chapters.map((chapter) => chapter.stageId)).toEqual(["dawn", "rooftops", "sunken-dome", "snow-shrine"]);
    expect(story.chapters.map((chapter) => chapter.songId)).toEqual(["dawn-tutorial", "moving-on", "farther-from-home", "whats-next"]);
  });

  for (const [index, chapter] of story.chapters.entries()) {
    it(`lets a bot finish chapter ${index + 1} (${chapter.id}) with every move done and no catch`, () => {
      const run = playChapter(index);
      expect(run.script.done).toBe(true);
      for (const kind of run.script.teaches) expect(run.script.hasDone(kind)).toBe(true);
      expect(run.catches).toBe(0);
    });
  }

  it("gives a slow player room: one who waits 3.5 s on each floor of the lava beat is never caught", () => {
    const run = playChapter(story.chapters.length - 1, { surviveFloorEveryTicks: 210 });
    expect(run.script.done).toBe(true);
    expect(run.catches).toBe(0);
  });

  it("catches a player who stops, no sooner than 6 s into the lava beat, and starts the beat again", () => {
    const run = playChapter(story.chapters.length - 1, { stopsOnSurvive: true });
    expect(run.catches).toBe(1);
    expect(run.activeTicksAtCatch).toBeGreaterThanOrEqual(TICK_HZ * 6);
    expect(run.script.done).toBe(false);
    expect(run.script.caught).toBe(true);
  });

  it("keeps the whole story short: the bot climbs every chapter within the allowance", () => {
    const ticks = story.chapters.map((_, index) => playChapter(index).ticks);
    expect(ticks.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TICK_HZ * 240);
  });
});
