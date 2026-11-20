import { describe, expect, it } from "vitest";
import { floorsChoices } from "../../../../apps/client/src/features/race/race-options";
import type { ModeContent } from "@floor-fifty/shared/content/game-content";
import { asContentId } from "@floor-fifty/shared/content/game-content";

describe("ReadyRoom hero mode presentation", () => {
  const modes: ModeContent[] = [
    {
      id: asContentId("infinite"),
      displayName: "Survival",
      course: "endless",
      tuning: {},
      clocks: [60, 120],
      laps: [1],
    },
    {
      id: asContentId("floors-20"),
      displayName: "20 Floors",
      course: "finite",
      tuning: { COURSE_FLOOR_COUNT: 20 },
      clocks: [],
      laps: [1, 3],
    },
    {
      id: asContentId("floors-50"),
      displayName: "50 Floors",
      course: "finite",
      tuning: { COURSE_FLOOR_COUNT: 50 },
      clocks: [],
      laps: [1, 3],
    },
  ];

  it("marks the endless mode as featured hero in floorsChoices", () => {
    const choices = floorsChoices(modes);
    expect(choices[0]!.id).toBe("infinite");
    expect(choices[0]!.badge).toBe("Featured");
    expect(choices[0]!.label).not.toBe("");
  });
});
