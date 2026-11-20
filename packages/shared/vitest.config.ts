import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    environment: "node",
    // Tests live in the repository-level `tests/` tree, grouped by the project
    // that owns them, rather than beside the source they exercise.
    include: ["../../tests/shared/**/*.test.ts", "../../tests/architecture.test.ts"],
    // The climb suites simulate hundreds of seconds of race time across
    // several seeds, which takes about four seconds on an idle machine and
    // more than five when the whole suite is running at once. The default
    // budget made them a measurement of the machine rather than of the race.
    testTimeout: 20_000,
  },
});
