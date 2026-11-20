import { describe, expect, it } from "vitest";
import { gapToBestPerson, moodScore, nextMood, type MoodRacer } from "@floor-fifty/shared/cpu/mood";

const racer = (id: string, score: number, over: Partial<MoodRacer> = {}): MoodRacer => ({ id, score, cpu: false, status: "connected", ...over });

describe("a racer's score (CPU banding spec §2)", () => {
  it("counts laps and this ascent's floors on a finite course", () => {
    expect(moodScore({ lap: 1, progress: 0.5, bestFloor: 9 }, 20, false)).toBe(10);
    expect(moodScore({ lap: 2, progress: 0.25, bestFloor: 3 }, 20, false)).toBe(25);
  });

  it("is the best floor on an endless course", () => {
    expect(moodScore({ lap: 1, progress: 1, bestFloor: 73 }, 50, true)).toBe(73);
  });
});

describe("the gap a CPU bands against", () => {
  it("is to the best-placed person", () => {
    const racers = [racer("cpu", 10, { cpu: true }), racer("a", 6), racer("b", 14)];
    expect(gapToBestPerson(racers, "cpu")).toBe(-4);
  });

  it("ignores other CPUs and anyone who did not finish the race", () => {
    const racers = [racer("cpu", 10, { cpu: true }), racer("rival", 30, { cpu: true }), racer("gone", 40, { status: "dns" }), racer("a", 5)];
    expect(gapToBestPerson(racers, "cpu")).toBe(5);
  });

  it("is undefined with nobody to band toward", () => {
    expect(gapToBestPerson([racer("cpu", 10, { cpu: true }), racer("rival", 3, { cpu: true })], "cpu")).toBeUndefined();
  });
});

describe("a mood", () => {
  it("is level with nobody to band toward", () => {
    expect(nextMood("cruising", undefined)).toBe("level");
  });

  it("enters cruising at four ahead and pushing at four behind", () => {
    expect(nextMood("level", 3)).toBe("level");
    expect(nextMood("level", 4)).toBe("cruising");
    expect(nextMood("level", -3)).toBe("level");
    expect(nextMood("level", -4)).toBe("pushing");
  });

  it("holds a mood until the gap falls back past two, so it never flickers at the edge", () => {
    expect(nextMood("cruising", 3)).toBe("cruising");
    expect(nextMood("cruising", 2)).toBe("cruising");
    expect(nextMood("cruising", 1)).toBe("level");
    expect(nextMood("pushing", -2)).toBe("pushing");
    expect(nextMood("pushing", -1)).toBe("level");
  });

  it("goes straight across when the gap swings from one side to the other", () => {
    expect(nextMood("cruising", -5)).toBe("pushing");
    expect(nextMood("pushing", 6)).toBe("cruising");
  });
});
