/**
 * A race's tuning is base, then the stage's courseTuning, then the mode's
 * (race-options spec §3.2): the mode wins where both set a key, and the stage
 * stands where the mode is silent (audit remediation T5).
 */
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { raceTuning } from "../../../apps/server/src/rooms/race-tuning";

const shipped = GENERATED_CONTENT.content;
const rooftops = shipped.stages.find((stage) => stage.id === "rooftops")!;

/** The shipped catalog with Rooftops' courseTuning set, and one mode's tuning replaced. */
function withLayers(stage: Record<string, number>, modeId: string, mode: Record<string, number>) {
  return {
    ...shipped,
    stages: shipped.stages.map((entry) => (entry.id === "rooftops" ? { ...entry, courseTuning: stage } : entry)),
    modes: shipped.modes.map((entry) => (entry.id === modeId ? { ...entry, tuning: mode } : entry)),
  };
}

describe("raceTuning", () => {
  it("lets the mode win over the stage", () => {
    const content = withLayers({ COURSE_FLOOR_COUNT: 30 }, "floors-50", { COURSE_FLOOR_COUNT: 50 });
    expect(raceTuning(content, "rooftops", "floors-50").tuning.COURSE_FLOOR_COUNT).toBe(50);
  });

  it("keeps the stage's key where the mode is silent", () => {
    const content = withLayers({ FLOOR_GAP_MIN: 130 }, "floors-20", { COURSE_FLOOR_COUNT: 20 });
    expect(raceTuning(content, "rooftops", "floors-20").tuning.FLOOR_GAP_MIN).toBe(130);
  });

  it("turns Survival's chosen clock into the race's limit (survival spec §5)", () => {
    expect(raceTuning(shipped, "rooftops", "infinite", 60).tuning.RACE_TIME_LIMIT_TICKS).toBe(60 * 60);
    expect(raceTuning(shipped, "rooftops", "infinite", 300).tuning.RACE_TIME_LIMIT_TICKS).toBe(300 * 60);
  });

  it("ignores a clock the mode does not offer, and any clock on a finite mode", () => {
    expect(raceTuning(shipped, "rooftops", "infinite", 61).tuning.RACE_TIME_LIMIT_TICKS).toBe(10_800);
    expect(raceTuning(shipped, "rooftops", "floors-20", 60).tuning.RACE_TIME_LIMIT_TICKS).toBe(0);
  });

  it("takes the stage's frozen seed", () => {
    expect(raceTuning(shipped, "rooftops", "floors-20").seed).toBe(rooftops.course!.seed);
  });
});
