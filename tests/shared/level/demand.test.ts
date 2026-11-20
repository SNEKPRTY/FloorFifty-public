import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { bounceBudget, stepDemands } from "@floor-fifty/shared/level/demand";

const tuning = resolveTuning();

describe("step demand", () => {
  it("is one bounce's reach at the default tuning", () => {
    expect(bounceBudget(tuning)).toBeCloseTo(356 * (268.2 / 275) + 89.5, 1);
  });

  it("matches the slice review's measured Rooftops steps", () => {
    const demands = stepDemands(createCourse(35229, tuning), tuning);
    expect(demands).toHaveLength(19);
    expect(demands[0]).toBeCloseTo(0.11, 2); // floor 1
    expect(demands[6]).toBeCloseTo(0.94, 2); // floor 7
    expect(demands[18]).toBeCloseTo(0.84, 2); // floor 19
  });

  it("reads fifty floors when the course has them", () => {
    const fifty = { ...tuning, COURSE_FLOOR_COUNT: 50 };
    expect(stepDemands(createCourse(35229, fifty), fifty)).toHaveLength(49);
  });
});
