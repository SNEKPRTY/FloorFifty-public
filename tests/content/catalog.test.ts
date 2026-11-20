import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";

describe("catalog mode order", () => {
  it("promotes Survival (infinite) to the hero first mode in catalog.toml", () => {
    const catalogPath = resolve(__dirname, "../../content/catalog.toml");
    const catalogToml = readFileSync(catalogPath, "utf-8");
    const match = catalogToml.match(/modes\s*=\s*\[(.*?)\]/s);
    expect(match).not.toBeNull();
    const modes = JSON.parse(`[${match![1]}]`);
    expect(modes[0]).toBe("infinite");
  });

  it("generated content modes list starts with infinite", () => {
    expect(GENERATED_CONTENT.content.modes[0]?.id).toBe("infinite");
  });
});
