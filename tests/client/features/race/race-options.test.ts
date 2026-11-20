import { describe, expect, it } from "vitest";
import type { ModeContent } from "@floor-fifty/shared/content/game-content";
import { clockChoicesFor, floorsChoices, formatClockChoice, lapChoicesFor } from "../../../../apps/client/src/features/race/race-options";

const mode = (id: string, course: "finite" | "endless", floors: number, laps: (1 | 3)[], displayName: string) =>
  ({ id, displayName, course, laps, tuning: { COURSE_FLOOR_COUNT: floors } }) as unknown as ModeContent;
const MODES = [
  mode("floors-20", "finite", 20, [1, 3], "20 floors"),
  mode("floors-50", "finite", 50, [1], "50 floors"),
  { ...mode("infinite", "endless", 50, [1], "Survival"), clocks: [60, 180, 300] } as ModeContent,
];

describe("the Floors row's model (race-options spec §3.4)", () => {
  it("labels each mode by its height, and Survival by its name with a stopwatch and a Featured badge, in catalog order (audit S19)", () => {
    // Owner's string D, 2026-11-14: "Survival" by the default mode, with a "Featured" badge. The badge was
    // English capitals typed into the code; it is now a message, and CSS sets the capitals.
    expect(floorsChoices(MODES)).toEqual([
      { id: "floors-20", label: "20", name: "20 floors" },
      { id: "floors-50", label: "50", name: "50 floors" },
      { id: "infinite", label: "Survival", icon: "stopwatch", badge: "Featured", name: "Survival" },
    ]);
  });

  it("offers Survival's clocks, and none on a finite mode (survival spec §5)", () => {
    expect(clockChoicesFor(MODES, "infinite")).toEqual([60, 180, 300]);
    expect(clockChoicesFor(MODES, "floors-20")).toEqual([]);
    expect(clockChoicesFor([], undefined)).toEqual([]);
  });

  it("writes a clock as whole minutes, and a part minute as m:ss", () => {
    expect([60, 180, 300, 90].map(formatClockChoice)).toEqual(["1", "3", "5", "1:30"]);
  });

  it("offers the selected mode's lap counts", () => {
    expect(lapChoicesFor(MODES, "floors-20")).toEqual([1, 3]);
    expect(lapChoicesFor(MODES, "infinite")).toEqual([1]);
  });

  it("offers one lap for a mode the catalog does not know", () => {
    expect(lapChoicesFor(MODES, "sprint")).toEqual([1]);
  });

  it("offers the default mode's laps before any catalog has loaded", () => {
    expect(lapChoicesFor([], undefined)).toEqual([1, 3]);
  });
});
