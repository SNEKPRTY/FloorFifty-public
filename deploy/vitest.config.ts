import { defineConfig } from "vitest/config";

// The deploy scripts and release tools, tested from the repository's `tests/`
// tree like every other project. The script tests run real bash against stub
// `systemctl`, `caddy` and `curl` binaries, so they need Node, not a browser.
export default defineConfig({
  test: {
    name: "deploy",
    environment: "node",
    include: ["../tests/deploy/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
