/**
 * Authored course validation.
 *
 * The stage schema can see whether a `[course]` table is shaped correctly on
 * its own. Only this pass can see whether the phrases account for the climb the
 * resolved tuning actually produces, because the floor count lives a layer
 * above the stage.
 */

import { describe, expect, it } from "vitest";
import { validateCourses } from "@floor-fifty/content/validate/course";
import type { CoursePhrase } from "@floor-fifty/shared/content/game-content";
import { located, validParsed } from "../support";
import type { ParsedContent } from "@floor-fifty/content/types";

/** The fixture stage climbs to floor 23: `COURSE_FLOOR_COUNT` is 24 there. */
const TOP_FLOOR = 23;

const phrase = (
  name: CoursePhrase["name"],
  fromFloor: number,
  toFloor: number,
): CoursePhrase => ({ name, fromFloor, toFloor, purpose: "Fixture phrase." });

/** The valid tree with its stage's phrase list replaced wholesale. */
const withPhrases = (phrases: readonly CoursePhrase[]): ParsedContent => {
  const parsed = validParsed();
  const stage = parsed.stages[0];
  if (stage === undefined || stage.value.course === undefined)
    throw new Error("the valid fixture stage authors no course");

  return {
    ...parsed,
    stages: [located(stage.file, { ...stage.value, course: { ...stage.value.course, phrases } })],
  };
};

describe("validateCourses", () => {
  it("accepts the shipped fixture, whose phrases tile its climb", () => {
    expect(validateCourses(validParsed())).toEqual([]);
  });

  it("accepts a stage that authors no course at all", () => {
    const parsed = validParsed();
    const stage = parsed.stages[0]!;
    const { course: _dropped, ...rest } = stage.value;

    expect(validateCourses({ ...parsed, stages: [located(stage.file, rest)] })).toEqual([]);
  });

  it("reports a floor no phrase accounts for", () => {
    // Floor 7 belongs to nobody: `teach` stops at 6 and `combine` starts at 8.
    const diagnostics = validateCourses(
      withPhrases([
        phrase("teach", 1, 6),
        phrase("combine", 8, 12),
        phrase("recover", 13, 18),
        phrase("finish", 19, TOP_FLOOR),
      ]),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalidCourse");
    expect(diagnostics[0]?.message).toContain("floor 7");
  });

  it("names every floor left unaccounted for, not just the first", () => {
    const diagnostics = validateCourses(
      withPhrases([
        phrase("teach", 1, 6),
        phrase("combine", 7, 12),
        phrase("recover", 13, 18),
        phrase("finish", 19, 20),
      ]),
    );

    expect(diagnostics[0]?.message).toContain("21, 22, 23");
  });

  it("reports two phrases claiming one floor", () => {
    const diagnostics = validateCourses(
      withPhrases([
        phrase("teach", 1, 6),
        phrase("combine", 6, 12),
        phrase("recover", 13, 18),
        phrase("finish", 19, TOP_FLOOR),
      ]),
    );

    expect(diagnostics.map((d) => d.code)).toContain("invalidCourse");
    expect(diagnostics.some((d) => d.message.includes("already claimed by the teach"))).toBe(true);
  });

  it("reports a phrase that runs off the top of the course", () => {
    const diagnostics = validateCourses(
      withPhrases([
        phrase("teach", 1, 6),
        phrase("combine", 7, 12),
        phrase("recover", 13, 18),
        phrase("finish", 19, TOP_FLOOR + 1),
      ]),
    );

    expect(diagnostics.some((d) => d.message.includes("past the top of the course"))).toBe(true);
  });

  it("stays silent when the tuning it would measure against is itself invalid", () => {
    // `validateBounds` owns an out-of-range override and reports it against the
    // line the author wrote. Resolving tuning here would throw instead, turning
    // one bad number into a crash from a pass that knows nothing about it.
    const parsed = validParsed();

    expect(() =>
      validateCourses({
        ...parsed,
        tuning: located(parsed.tuning.file, { ...parsed.tuning.value, GRAVITY: -5000 }),
      }),
    ).not.toThrow();
  });
});

const extension = (fromFloor: number, toFloor: number) => ({ fromFloor, toFloor, purpose: "Fixture extension." });

/** The valid tree with its stage's extension replaced, or removed for `undefined`. */
const withExtension = (list: readonly ReturnType<typeof extension>[] | undefined): ParsedContent => {
  const parsed = validParsed();
  const stage = parsed.stages[0]!;
  const { extension: _old, ...course } = stage.value.course!;
  return {
    ...parsed,
    stages: [located(stage.file, { ...stage.value, course: list === undefined ? course : { ...course, extension: list } })],
  };
};

const withMode = (
  parsed: ParsedContent,
  id: string,
  course: "finite" | "endless",
  tuning: Record<string, number>,
): ParsedContent => ({
  ...parsed,
  modes: [...parsed.modes, located(`content/modes/${id}.toml`, { id, displayName: id, course, laps: [1], tuning } as never)],
});
const withFiftyMode = (parsed: ParsedContent) => withMode(parsed, "floors-50", "finite", { COURSE_FLOOR_COUNT: 50 });
const withEndlessMode = (parsed: ParsedContent) =>
  withMode(parsed, "infinite", "endless", { COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 600 });

describe("the course extension (race-options spec §4)", () => {
  // The fixture stage climbs to floor 23, so a 50-floor mode leaves 24–49 to describe.
  it("accepts extensions that tile the floors above the stage's top when a 50-floor mode exists", () => {
    expect(validateCourses(withFiftyMode(withExtension([extension(24, 29), extension(30, 39), extension(40, 49)])))).toEqual([]);
  });

  it("refuses a gap", () => {
    const [d] = validateCourses(withFiftyMode(withExtension([extension(24, 29), extension(31, 49)])));
    expect(d).toMatchObject({ code: "invalidCourse", keyPath: "course.extension" });
    expect(d!.message).toContain("30");
  });

  it("refuses an overlap", () => {
    const [d] = validateCourses(withFiftyMode(withExtension([extension(24, 30), extension(30, 49)])));
    expect(d).toMatchObject({ code: "invalidCourse", keyPath: "course.extension.1" });
  });

  it("refuses a floor the four phrases already account for", () => {
    const [d] = validateCourses(withFiftyMode(withExtension([extension(23, 49)])));
    expect(d).toMatchObject({ code: "invalidCourse", keyPath: "course.extension.0" });
  });

  it("refuses a stage with no extension when a 50-floor mode exists", () => {
    const [d] = validateCourses(withFiftyMode(withExtension(undefined)));
    expect(d).toMatchObject({ code: "invalidCourse", keyPath: "course.extension" });
    expect(d!.message).toContain("24–49");
  });

  it("refuses an extension when no mode climbs past the stage's top", () => {
    const [d] = validateCourses(withExtension([extension(24, 29)]));
    expect(d).toMatchObject({ code: "invalidCourse", keyPath: "course.extension.0" });
  });

  it("does not count an endless mode as a finite top", () => {
    expect(validateCourses(withEndlessMode(withExtension(undefined)))).toEqual([]);
  });
});
