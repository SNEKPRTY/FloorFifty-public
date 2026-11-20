import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PresentationFlow } from "@floor-fifty/shared/content/presentation";

describe("the shipped flow's transition styles", () => {
  it("has no hard cut between screens", () => {
    const artifact = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../content/generated/content.json"), "utf8")) as {
      content: { presentation: { flow: PresentationFlow } };
    };
    for (const edge of artifact.content.presentation.flow.transitions) {
      expect(["fade", "liquid"], `${edge.from}.${edge.event}`).toContain(edge.transition);
    }
  });
});
