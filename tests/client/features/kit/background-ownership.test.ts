// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readClient } from "../../support/client-source";


describe("non-gameplay background ownership", () => {
  it("leaves the Pixi refraction visible behind menu and results UI", () => {
    for (const component of ["TitleRoot.svelte", "LobbyRoot.svelte", "ResultsPanel.svelte"]) {
      const source = readClient(component);
      expect(source).not.toContain("menu-backdrop.png");
    }
  });
});
