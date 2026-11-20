import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { CONDITION_IDS, CONDITION_THRESHOLDS, isConditionId } from "@floor-fifty/shared/unlocks/conditions";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../content/generated/content.json"), "utf8")),
);

describe("conditions and unlocks.toml", () => {
  it("every entry has a predicate, in the same order", () => {
    expect(content.unlocks.map((entry) => entry.id)).toEqual([...CONDITION_IDS]);
  });

  it("every counted predicate's threshold equals its entry's goal", () => {
    for (const entry of content.unlocks) {
      const id: string = entry.id;
      if (!isConditionId(id)) throw new Error(`no predicate for ${id}`);
      const threshold = CONDITION_THRESHOLDS[id];
      if (threshold !== undefined) expect(threshold, entry.id).toBe(entry.goal);
    }
  });
});
