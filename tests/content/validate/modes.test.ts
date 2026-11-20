/**
 * A mode's course against its clock, and its schema (race-options spec §3.1).
 */
import { describe, expect, it } from "vitest";
import type { ModeContent } from "@floor-fifty/shared/content/game-content";
import { modeSchema } from "../../../packages/content/src/schema/mode";
import { validateModes } from "../../../packages/content/src/validate/modes";
import type { ParsedContent } from "../../../packages/content/src/types";
import { parsedWithMode } from "../support";

function withMode(value: Partial<ModeContent>): ParsedContent {
  const parsed = parsedWithMode({});
  const [mode] = parsed.modes;
  return { ...parsed, modes: [{ ...mode!, value: { ...mode!.value, ...value } }] };
}

describe("a mode's course and clock (race-options spec §3.1)", () => {
  it("accepts a finite mode with no limit", () => {
    expect(validateModes(withMode({ course: "finite", tuning: {} }))).toEqual([]);
  });

  it("accepts an endless mode with a positive limit", () => {
    expect(validateModes(withMode({ course: "endless", clocks: [60, 180, 300], tuning: { RACE_TIME_LIMIT_TICKS: 10_800 } }))).toEqual([]);
  });

  it("needs clocks on an endless mode (survival spec §5)", () => {
    const diagnostics = validateModes(withMode({ course: "endless", tuning: { RACE_TIME_LIMIT_TICKS: 10_800 } }));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ keyPath: "clocks", message: "an endless mode offers clock lengths, so it needs clocks" }),
    );
  });

  it("refuses clocks on a finite mode (survival spec §5)", () => {
    const diagnostics = validateModes(withMode({ course: "finite", clocks: [60], tuning: {} }));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ keyPath: "clocks", message: "only an endless mode has a clock to choose" }),
    );
  });

  it("refuses an endless mode without a limit", () => {
    const [diagnostic] = validateModes(withMode({ course: "endless", clocks: [180], tuning: {} }));
    expect(diagnostic).toMatchObject({ code: "invalidMode", keyPath: "tuning.RACE_TIME_LIMIT_TICKS" });
  });

  it("refuses a finite mode with a limit", () => {
    const [diagnostic] = validateModes(withMode({ course: "finite", tuning: { RACE_TIME_LIMIT_TICKS: 600 } }));
    expect(diagnostic).toMatchObject({ code: "invalidMode", keyPath: "tuning.RACE_TIME_LIMIT_TICKS" });
  });
});

describe("a mode file's schema", () => {
  const valid = { id: "floors-20", displayName: "20 floors", course: "finite", laps: [1, 3], tuning: {} };

  it("accepts a well-formed mode", () => {
    expect(modeSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a mode's clocks", () => {
    expect(modeSchema.safeParse({ ...valid, clocks: [60, 180, 300] }).success).toBe(true);
  });

  it.each([
    ["an unknown course", { course: "sprint" }],
    ["an empty laps list", { laps: [] }],
    ["a lap count of 2", { laps: [1, 2] }],
    ["a repeated lap count", { laps: [1, 1] }],
    ["a missing course", { course: undefined }],
    ["a clock longer than 600 s", { clocks: [60, 601] }],
    ["a repeated clock", { clocks: [60, 60] }],
    ["an empty clocks list", { clocks: [] }],
  ])("refuses %s", (_case, change) => {
    expect(modeSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("the clock belongs to the mode (audit remediation B6)", () => {
  it("refuses a stage whose courseTuning sets RACE_TIME_LIMIT_TICKS", () => {
    const parsed = withMode({ course: "finite", tuning: {} });
    const [stage] = parsed.stages;
    const changed: ParsedContent = {
      ...parsed,
      stages: [{ ...stage!, value: { ...stage!.value, courseTuning: { RACE_TIME_LIMIT_TICKS: 600 } } }, ...parsed.stages.slice(1)],
    };
    expect(validateModes(changed)).toContainEqual(
      expect.objectContaining({ code: "invalidMode", file: stage!.file, keyPath: "courseTuning.RACE_TIME_LIMIT_TICKS" }),
    );
  });
});
