import { describe, expect, it } from "vitest";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { cpuSeed } from "@floor-fifty/shared/cpu/controller";
import { PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { count, idle, median, race, SURVEY } from "./support";

describe("a CPU's frames", () => {
  it("are the same for the same seed, frame for frame", () => {
    const first = race(13, [PERSONALITIES.scarlet])[0]!;
    const second = race(13, [PERSONALITIES.scarlet])[0]!;
    expect(second.frames).toEqual(first.frames);
  });

  it("start hands-off for its reaction time, so the racer stands until then", () => {
    const [run] = race(13, [PERSONALITIES.cyan], 1);
    const before = run!.frames.slice(0, PERSONALITIES.cyan.reactionTicks);
    expect(before.every((frame) => !frame.left && !frame.right && !frame.fastFall && !frame.reset)).toBe(true);
  });

  it("carry the sequence they are given", () => {
    const [run] = race(13, [PERSONALITIES.gold], 1);
    expect(run!.frames.map((frame) => frame.sequence)).toEqual(run!.frames.map((_frame, index) => index + 1));
  });
});

describe("an eager drop", () => {
  it("fast-falls before lining up, so a CPU with one fast-falls more than without", () => {
    const calm = { ...PERSONALITIES.gold, eagerDrop: 0, slipChance: 0, leadEase: 0 };
    const eager = { ...calm, eagerDrop: 0.5 };
    // Frames, not a share: a miss lengthens the race and dilutes any share.
    const fastFalls = (personality: typeof calm) =>
      SURVEY.slice(0, 5).reduce((sum, seed) => sum + count(race(seed, [personality])[0]!.frames, "fastFall"), 0);
    expect(fastFalls(eager)).toBeGreaterThan(fastFalls(calm));
  });
});

describe("the seed a CPU drives on", () => {
  it("differs by colour and by round, and is stable", () => {
    const seeds = SEAT_COLOURS.map((colour) => cpuSeed(99, 1, colour));
    expect(new Set(seeds).size).toBe(4);
    expect(cpuSeed(99, 2, "scarlet")).not.toBe(cpuSeed(99, 1, "scarlet"));
    expect(cpuSeed(99, 1, "scarlet")).toBe(seeds[0]);
  });
});

// Over the whole survey: ten seeds left a reset or two deciding a style.
describe("each style shows in what it does", { timeout: 60_000 }, () => {
  const runs = Object.fromEntries(
    SEAT_COLOURS.map((colour) => [colour, SURVEY.map((seed) => race(seed, [PERSONALITIES[colour]])[0]!)]),
  ) as Record<(typeof SEAT_COLOURS)[number], ReturnType<typeof race>>;
  const mean = (colour: (typeof SEAT_COLOURS)[number], measure: (run: (typeof runs)["scarlet"][number]) => number) =>
    runs[colour].reduce((sum, run) => sum + measure(run), 0) / runs[colour].length;

  // Spec §4: "overshoots and resets more than the others". Fast-fall frames do
  // not tell the styles apart under this physics (a miss lengthens the race),
  // so the rusher shows in its resets.
  it("Blaze resets the most", () => {
    for (const other of ["cyan", "gold", "violet"] as const) {
      expect(mean("scarlet", (run) => count(run.frames, "reset"))).toBeGreaterThan(mean(other, (run) => count(run.frames, "reset")));
    }
  });

  it("Koi resets the least", () => {
    for (const other of ["scarlet", "gold", "violet"] as const) {
      expect(mean("cyan", (run) => count(run.frames, "reset"))).toBeLessThanOrEqual(mean(other, (run) => count(run.frames, "reset")));
    }
  });

  it("Moth hangs back the most", () => {
    const hands = (colour: (typeof SEAT_COLOURS)[number]) => mean(colour, (run) => idle(run.frames) / Math.max(1, run.frames.length));
    for (const other of ["scarlet", "cyan", "gold"] as const) expect(hands("violet")).toBeGreaterThan(hands(other));
  });

  it("Sunny is slower with a racer to lead than alone", () => {
    const alone = median(SURVEY.slice(0, 10).map((seed) => race(seed, [PERSONALITIES.gold])[0]!.seconds));
    // A racer who never touches a control stands on the start floor, so Sunny leads all the way.
    const leading = median(SURVEY.slice(0, 10).map((seed) => race(seed, [PERSONALITIES.gold, undefined])[0]!.seconds));
    expect(leading).toBeGreaterThan(alone);
  });
});
