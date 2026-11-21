/**
 * The story's rules, played by a bot in Node on the authored seeds (story mode
 * v2, criteria 4 to 9). No picture: the run, its director and the race.
 */

import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { STORY_RULES } from "../../../../apps/client/src/features/story/rules";
import { Lava, Wind } from "../../../../apps/client/src/features/story/hazards";
import { STORY, chapterNamed, playChapter, type BotRun } from "./support/story-bot";

const runs = new Map<string, BotRun>();
const fastRun = (id: string): BotRun => {
  if (!runs.has(id)) runs.set(id, playChapter(chapterNamed(id)));
  return runs.get(id)!;
};

/** Ticks between new best floors in a phase: how long the bot took a floor. */
function ticksPerFloor(run: BotRun, phase: string): number[] {
  const rows = run.trace.filter((row) => row.phase === phase && !row.out);
  const gaps: number[] = [];
  let best = rows[0]?.playerFloor ?? 0;
  let since = rows[0]?.tick ?? 0;
  for (const row of rows) {
    if (row.playerFloor > best) {
      gaps.push(row.tick - since);
      best = row.playerFloor;
      since = row.tick;
    }
  }
  return gaps;
}

describe("every chapter, played well (criterion 4)", () => {
  for (const chapter of STORY.chapters) {
    it(`finishes ${chapter.id} with every phase done, every glim carried and no catch`, () => {
      const run = fastRun(chapter.id);
      expect(run.run.director.done).toBe(true);
      expect(run.events.filter((event) => event.kind === "phase").map((event) => (event as { id: string }).id)).toEqual(chapter.phases.map((phase) => phase.id));
      expect(run.run.director.glims.carried).toBe(run.run.director.glims.total);
      expect(run.run.director.catches).toBe(0);
    });
  }

  it("holds 30 glims across the story", () => {
    expect(STORY.chapters.map((chapter) => fastRun(chapter.id).run.director.glims.total).reduce((a, b) => a + b, 0)).toBe(30);
  });
});

describe("a slow, steady player gets through the lava (criterion 4)", () => {
  it.each([
    ["snow", "chase", 240],
    ["fifty", "last", 192],
    ["deep", "back", 294],
  ] as const)("in %s's %s phase, at %d ticks a floor, is never caught", (id, phase, ticks) => {
    // It climbs and only climbs: no turning back down for a glim it walked past.
    const run = playChapter(chapterNamed(id), { dawdleTicks: ticks, dawdlePhases: [phase], skipGlims: true });
    const gaps = ticksPerFloor(run, phase);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThanOrEqual(ticks * 0.95);
    expect(run.run.director.catches).toBe(0);
    expect(run.run.director.done).toBe(true);
  });
});

describe("the chase (review R7)", () => {
  it("in snow, the rising lava is never far under the floor the player is on, so it stays on screen", () => {
    const run = fastRun("snow");
    const state = run.run.state;
    const top = (floor: number) => state.course.floors[floor]!.y + state.tuning.FLOOR_HEIGHT / 2;
    // The chase's phases: the lava under the player (the slip's is under Frog, and slow).
    const chasing = new Set(chapterNamed("snow").phases.filter((phase) => phase.lava?.under === "player").map((phase) => phase.id));
    const phaseStart = new Map<string, number>();
    for (const row of run.trace) if (!phaseStart.has(row.phase)) phaseStart.set(row.phase, row.tick);
    const rows = run.trace.filter((row) => !row.out && row.lavaY !== undefined && chasing.has(row.phase) && row.tick > phaseStart.get(row.phase)! + 240);
    expect(rows.length).toBeGreaterThan(0);
    const gaps = rows.map((row) => top(row.playerFloor) - row.lavaY!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(STORY_RULES.lavaLeash + 1);
  });
});

describe("a player who never presses", () => {
  it("is not waited for: the lava's grace runs from the phase's first tick, then it rises", () => {
    const authored = chapterNamed("snow").phases[0]!.lava!;
    const lava = new Lava(authored, -1000);
    for (let tick = 0; tick < authored.grace; tick += 1) lava.tick();
    expect(lava.y).toBe(-1000);
    for (let tick = 0; tick < TICK_HZ; tick += 1) lava.tick();
    expect(lava.y).toBeCloseTo(-1000 + authored.rise, 5);
  });
});

describe("a close lava is a fair one (re-check 3, R1)", () => {
  const authored = chapterNamed("snow").phases[0]!.lava!;

  it("rises at half its speed near the player, follows in its grace, and backs off a fall", () => {
    const lava = new Lava(authored, 0);
    for (let tick = 0; tick < authored.grace; tick += 1) lava.tick();
    lava.follow(100);
    expect(lava.y).toBe(100);
    for (let tick = 0; tick < TICK_HZ; tick += 1) lava.tick(true);
    expect(lava.y).toBeCloseTo(100 + authored.rise * STORY_RULES.lavaNearPace, 5);
    expect(lava.rising).toBeCloseTo(authored.rise * STORY_RULES.lavaNearPace, 5);
    lava.sinkTo(50);
    expect(lava.y).toBeCloseTo(50, 5);
    lava.sinkTo(500);
    expect(lava.y).toBeCloseTo(50, 5);
  });

  it.each(["lowtown", "deep", "snow", "fifty"])("in %s, a fall never lands in the chasing lava: the bot that finishes is never caught", (id) => {
    expect(fastRun(id).run.director.catches).toBe(0);
  });
});

describe("a player who stops in the lava (criterion 4)", () => {
  const run = playChapter(chapterNamed("snow"), { stopsInLava: true, maxTicks: TICK_HZ * 60 });
  const caught = run.events.filter((event) => event.kind === "caught");

  it("is caught, again and again, and the chapter never ends", () => {
    expect(caught.length).toBeGreaterThanOrEqual(3);
    expect(run.run.director.done).toBe(false);
  });

  it("goes back to the last safe spot with every glim kept", () => {
    const restored = run.events.filter((event) => event.kind === "restored");
    expect(restored.length).toBeGreaterThanOrEqual(2);
    const glimsAt = (tick: number) => run.events.filter((event) => event.kind === "glim" && event.tick <= tick).length;
    expect(glimsAt(restored[1]!.tick)).toBeGreaterThanOrEqual(glimsAt(caught[0]!.tick));
    expect(run.run.director.pickups.taken.size).toBe(glimsAt(run.ticks));
  });

  it("stands still for 'OUT!' and then steps on", () => {
    const outRows = run.trace.filter((row) => row.out);
    expect(outRows.length).toBeGreaterThan(0);
    const first = caught[0]!.tick;
    const restoredAt = run.events.find((event) => event.kind === "restored")!.tick;
    expect(restoredAt - first).toBe(STORY_RULES.caughtTicks);
  });

  it("meets the lava at 80% of its speed from the third catch at one safe spot", () => {
    const third = run.events.filter((event) => event.kind === "restored")[2]!;
    const authored = chapterNamed("snow").phases[0]!.lava!.rise;
    // Rising after its grace: the mercy share, or that at `lavaNearPace` near the player's floor (re-check 3).
    const rising = run.trace.filter((each) => each.tick > third.tick && !each.out && (each.lavaRise ?? 0) > 0);
    expect(rising.length).toBeGreaterThan(0);
    const mercy = authored * STORY_RULES.mercyShare;
    for (const each of rising) expect([mercy, mercy * STORY_RULES.lavaNearPace].some((pace) => Math.abs(pace - each.lavaRise!) < 1e-6), `tick ${each.tick}`).toBe(true);
    expect(rising.some((each) => Math.abs(each.lavaRise! - mercy) < 1e-6)).toBe(true);
  });
});

describe("Frog and Oni (criterion 5)", () => {
  for (const chapter of STORY.chapters) {
    it(`in ${chapter.id}: never finish, never run away from a leashed player, never stay lost`, () => {
      const run = fastRun(chapter.id);
      expect(run.trace.every((row) => row.racePhase === "racing")).toBe(true);
      const above = new Map<string, number>();
      const lost = new Map<string, number>();
      // In a rescue the player dives to the actor, so the actor is above by design.
      const diving = new Set(chapter.phases.filter((phase) => phase.goal.kind === "rescue").map((phase) => phase.id));
      for (const row of run.trace) {
        for (const actor of row.actors) {
          expect(actor.floor, actor.id).toBeLessThan(19);
          const ahead = actor.leash && !diving.has(row.phase) && actor.floor > row.playerFloor + 2;
          above.set(actor.id, ahead ? (above.get(actor.id) ?? 0) + 1 : 0);
          expect(above.get(actor.id)!, `${actor.id} above at ${row.tick}`).toBeLessThanOrEqual(60);
          const under = row.lavaY !== undefined && actor.y - 29.5 < row.lavaY && row.phase !== "dive";
          // In a dive the actor waits far below by design: the player is coming down to it.
          const far = actor.leash && !diving.has(row.phase) && actor.floor < row.playerFloor - 3;
          lost.set(actor.id, under || far ? (lost.get(actor.id) ?? 0) + 1 : 0);
          expect(lost.get(actor.id)!, `${actor.id} lost at ${row.tick}`).toBeLessThanOrEqual(240);
        }
      }
    });
  }
});

describe("the lamps (criterion 6)", () => {
  it("open under a hard landing, two glims each", () => {
    const run = fastRun("city");
    const opens = run.events.filter((event) => event.kind === "lampOpen");
    expect(opens.length).toBe(3);
    expect(run.run.director.glims.carried).toBe(6);
  });

  it("never open under a soft landing; two rattles bring 'Harder!'; floor 10 does not end the chapter", () => {
    const run = playChapter(chapterNamed("city"), { soft: true, maxTicks: TICK_HZ * 60 });
    expect(run.events.some((event) => event.kind === "lampOpen")).toBe(false);
    const harder = chapterNamed("city").moments.findIndex((moment) => moment.when.kind === "lampSoft");
    expect(run.events.filter((event) => event.kind === "lampRattle").length).toBeGreaterThanOrEqual(2);
    expect(run.events.some((event) => event.kind === "say" && event.moment === harder)).toBe(true);
    expect(run.trace.some((row) => row.playerFloor >= 10)).toBe(true);
    expect(run.run.director.done).toBe(false);
    const needLamp = chapterNamed("city").moments.findIndex((moment) => moment.when.kind === "needLamp");
    expect(run.events.some((event) => event.kind === "say" && event.moment === needLamp)).toBe(true);
  });
});

describe("the dive (criterion 7)", () => {
  it.each([
    ["deep", "frog"],
    ["fifty", "oni"],
  ] as const)("in %s, the rescue comes on the first landing on %s's floor", (id, actor) => {
    const run = fastRun(id);
    const rescue = run.events.find((event) => event.kind === "rescue")!;
    expect(rescue).toMatchObject({ actor });
    const row = run.trace.find((each) => each.tick === rescue.tick)!;
    const actorFloor = row.actors.find((each) => each.id === actor)!.floor;
    const diveStart = run.events.find((event) => event.kind === "phase" && event.id === "dive")!.tick;
    const earlier = run.trace.filter((each) => each.tick > diveStart && each.tick < rescue.tick);
    expect(earlier.every((each) => each.playerFloor !== actorFloor || !each.player.grounded)).toBe(true);
  });

  // 170 units at 8 and 10 units a second.
  it.each([
    ["deep", 1275],
    ["fifty", 1020],
  ] as const)("in %s, the lava reaches the actor %d ticks into a dive the player never makes, and the dive starts again", (id, ticks) => {
    const chapter = chapterNamed(id);
    // Deep's dive comes after a climb: start the bot there by giving it only the dive and what follows.
    const diveFirst = id === "deep" ? { ...chapter, startFloor: 9, phases: chapter.phases.slice(1) } : chapter;
    const run = playChapter(diveFirst, { stays: true, maxTicks: ticks + 400 });
    const start = run.events.find((event) => event.kind === "phase" && event.id === "dive")!.tick;
    const caught = run.events.find((event) => event.kind === "caught")!;
    expect(Math.abs(caught.tick - start - ticks)).toBeLessThanOrEqual(1);
    const restored = run.events.find((event) => event.kind === "restored")!;
    const after = run.trace.find((row) => row.tick === restored.tick)!;
    expect(after.phase).toBe("dive");
  });
});

describe("the turn (review R5)", () => {
  it.each([
    ["deep", "frog"],
    ["fifty", "oni"],
  ] as const)("in %s, the camera looks at %s and the player stands still while it does, then dives", (id, actor) => {
    const run = fastRun(id);
    const look = run.events.find((event) => event.kind === "lookAt")!;
    expect(look).toMatchObject({ actor, ticks: 150 });
    const held = run.trace.filter((row) => row.tick > look.tick && row.tick <= look.tick + 150);
    expect(held.length).toBe(150);
    // Wanted or not, the player's input does nothing while held: no steering, no fast fall.
    expect(held.every((row) => row.player.grounded ? row.player.vx === 0 : true)).toBe(true);
    const rescue = run.events.find((event) => event.kind === "rescue")!;
    expect(rescue.tick).toBeGreaterThan(look.tick + 150);
  });

  it("in deep, the quake's lines are Frog's then Oni's, and nothing from before waits ahead of them", () => {
    const chapter = chapterNamed("deep");
    const dive = chapter.moments.findIndex((moment) => moment.when.kind === "phase" && "phase" in moment.when && moment.when.phase === "dive");
    expect(chapter.moments[dive]!.lines!.map((line) => line.speaker)).toEqual(["frog", "oni"]);
    const nearly = chapter.moments.findIndex((moment) => moment.when.kind === "floor" && "floor" in moment.when && moment.when.floor === 8);
    expect(chapter.moments[nearly]!.lines![0]!.text).toContain("nearly first");
  });
});

describe("the wind (criterion 8)", () => {
  it("pushes at its speed for 150 ticks, every 480, right then left, warned 60 ticks ahead", () => {
    const wind = new Wind(70);
    const ticks = Array.from({ length: 2000 }, () => wind.tick(true));
    const pushing = ticks.flatMap((tick, index) => (tick.push === 0 ? [] : [{ index, push: tick.push }]));
    expect(pushing[0]!.index).toBe(STORY_RULES.gustFirst);
    expect(pushing.filter((each) => each.index < STORY_RULES.gustFirst + 480)).toHaveLength(150);
    expect(pushing[0]!.push).toBeCloseTo(70 / TICK_HZ, 9);
    expect(ticks[STORY_RULES.gustFirst + 480]!.push).toBeCloseTo(-70 / TICK_HZ, 9);
    expect(ticks.findIndex((tick) => tick.warning !== undefined)).toBe(STORY_RULES.gustFirst - 60);
    expect(ticks[STORY_RULES.gustFirst + 420]!.warning).toBe(-1);
  });

  it("waits for the first input, and with no wind pushes nothing", () => {
    const wind = new Wind(70);
    expect(Array.from({ length: 1000 }, () => wind.tick(false)).every((tick) => tick.push === 0)).toBe(true);
    const still = new Wind(0);
    expect(Array.from({ length: 2000 }, () => still.tick(true)).every((tick) => tick.push === 0 && tick.warning === undefined)).toBe(true);
  });
});

describe("the run never stands still for words (criterion 9)", () => {
  for (const chapter of STORY.chapters) {
    it(`steps ${chapter.id} one race tick a tick, except while "OUT!" stands`, () => {
      const run = fastRun(chapter.id);
      for (let index = 1; index < run.trace.length; index += 1) {
        const step = run.trace[index]!.raceTick - run.trace[index - 1]!.raceTick;
        expect(step, `tick ${run.trace[index]!.tick}`).toBe(run.trace[index]!.out ? 0 : 1);
      }
    });
  }
});
