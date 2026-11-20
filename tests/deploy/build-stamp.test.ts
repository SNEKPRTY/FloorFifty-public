import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDefines } from "../../tools/build-stamp";

const artifact = JSON.parse(
  readFileSync(new URL("../../content/generated/content.json", import.meta.url), "utf8"),
) as { rulesetRevision: string };

describe("the build stamp", () => {
  it("stamps the build id and the artifact's ruleset", () => {
    const defines = buildDefines({ FLOOR_FIFTY_BUILD_ID: "202610041200-abc1234" });
    expect(defines["__FF_BUILD_ID__"]).toBe(JSON.stringify("202610041200-abc1234"));
    expect(defines["__FF_RULESET_REVISION__"]).toBe(JSON.stringify(artifact.rulesetRevision));
  });

  it("stamps dev when no release is being built", () => {
    expect(buildDefines({})["__FF_BUILD_ID__"]).toBe(JSON.stringify("dev"));
  });

  it("refuses a malformed id rather than ship it", () => {
    expect(() => buildDefines({ FLOOR_FIFTY_BUILD_ID: "latest" })).toThrow(/build id/);
  });
});
