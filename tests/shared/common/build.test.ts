import { describe, expect, it } from "vitest";
import { compareBuildIds, DEV_BUILD_ID } from "@floor-fifty/shared/common/build";

describe("build ids", () => {
  it("sort by their UTC stamp", () => {
    expect(compareBuildIds("202610041200-abc1234", "202610041201-0000000")).toBe(-1);
    expect(compareBuildIds("202610041201-abc1234", "202610041200-fffffff")).toBe(1);
  });

  it("are equal only when identical", () => {
    expect(compareBuildIds("202610041200-abc1234", "202610041200-abc1234")).toBe(0);
  });

  it("order two builds of the same minute by sha, so the answer is stable", () => {
    expect(compareBuildIds("202610041200-aaaaaaa", "202610041200-bbbbbbb")).toBe(-1);
  });

  it("treat a dev build as unordered", () => {
    expect(compareBuildIds(DEV_BUILD_ID, "202610041200-abc1234")).toBe(0);
    expect(compareBuildIds("202610041200-abc1234", DEV_BUILD_ID)).toBe(0);
  });
});
