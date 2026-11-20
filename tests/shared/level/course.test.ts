import { describe, expect, it } from "vitest";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";

const tuning = resolveTuning();

describe("course generation", () => {
  it("creates identical courses from an identical seed and floor count", () => {
    expect(createCourse(4182, tuning)).toEqual(createCourse(4182, tuning));
    expect(createCourse(4182, tuning).floors).toHaveLength(20);
  });

  it("creates different courses from different seeds", () => {
    expect(createCourse(4182, tuning)).not.toEqual(createCourse(4183, tuning));
  });

  it("honours an off-default floor count so later modes can reach Floor 100", () => {
    const tall = resolveTuning({ COURSE_FLOOR_COUNT: 100 });
    expect(createCourse(4182, tall).floors).toHaveLength(100);
  });

  it("keeps the first n floors of a tall course identical to an n-floor course", () => {
    const tall = createCourse(4182, resolveTuning({ COURSE_FLOOR_COUNT: 100 }));
    const short = createCourse(4182, tuning);
    expect(tall.floors.slice(0, short.floors.length)).toEqual(short.floors);
  });

  it("anchors a fixed starting floor that later floors build upward from", () => {
    const course = createCourse(4182, tuning);
    const [start, second] = course.floors;
    expect(start?.index).toBe(0);
    expect(start?.x).toBe(0);
    expect(start?.kind).toBe("stationary");
    expect(second?.y).toBeGreaterThan(start!.y);
  });

  it("keeps every generated floor inside the horizontal bounds", () => {
    const course = createCourse(4182, resolveTuning({ COURSE_FLOOR_COUNT: 100 }));
    for (const floor of course.floors) {
      expect(floor.x).toBeGreaterThanOrEqual(course.bounds.left);
      expect(floor.x).toBeLessThanOrEqual(course.bounds.right);
      expect(Math.abs(floor.x) + tuning.FLOOR_WIDTH / 2).toBeLessThanOrEqual(VIEWPORT.width / 2);
    }
  });

  it("separates consecutive floors by a gap inside the declared range", () => {
    // A floor's y is an accumulated sum, so differencing two of them near the
    // top of a hundred-floor course loses the last bits of the gap. The
    // tolerance is that rounding and nothing more: under parity the bounds are
    // equal, so an exact comparison would fail on arithmetic rather than on a
    // generator that placed a floor wrongly.
    const epsilon = 1e-9;
    const course = createCourse(99, resolveTuning({ COURSE_FLOOR_COUNT: 100 }));
    for (let index = 1; index < course.floors.length; index += 1) {
      const gap = course.floors[index]!.y - course.floors[index - 1]!.y;
      expect(gap).toBeGreaterThanOrEqual(tuning.FLOOR_GAP_MIN - epsilon);
      expect(gap).toBeLessThanOrEqual(tuning.FLOOR_GAP_MAX + epsilon);
    }
  });

  it("places the death line below the starting floor", () => {
    const course = createCourse(4182, tuning);
    expect(course.deathLineY).toBe(course.floors[0]!.y - tuning.DEATH_LINE_MARGIN);
  });

  it("gives moving floors a speed and stationary floors none", () => {
    const course = createCourse(4182, resolveTuning({ COURSE_FLOOR_COUNT: 100 }));
    const moving = course.floors.filter((floor) => floor.kind === "moving");
    expect(moving.length).toBeGreaterThan(0);
    for (const floor of course.floors) {
      expect(floor.speed === 0).toBe(floor.kind === "stationary");
    }
  });
});
