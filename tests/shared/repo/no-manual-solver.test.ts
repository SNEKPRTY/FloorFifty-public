import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function sourcesUnder(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourcesUnder(path);
      return entry.name.endsWith(".ts") ? readFile(path, "utf8") : "";
    }),
  );
  return parts.join("\n");
}

describe("the manual penetration solver is gone", () => {
  it("leaves no reference in shared, server or client production code", async () => {
    const sources = [
      await sourcesUnder("packages/shared/src"),
      await sourcesUnder("apps/server/src"),
      await sourcesUnder("apps/client/src"),
    ].join("\n");

    for (const name of [
      "stepRace",
      "resolvePlatformLandings",
      "resolveFloorContacts",
      "integratePlayers",
      "createManualRaceSimulation",
      "FLOOR_FIFTY_SIMULATION",
      "SimulationBackend",
      // The overlap arithmetic that outlived the solver it came from, and the
      // flush reseat that overwrote Planck's positions with its answer.
      "factsAt",
      "integratedTransforms",
      "IntegratedTransforms",
    ]) {
      expect(sources).not.toContain(name);
    }
  });
});
