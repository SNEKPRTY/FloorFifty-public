import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "asset-contract",
    environment: "node",
    // Tests live in the repository-level `tests/` tree, grouped by the project
    // that owns them, as every other package does.
    include: ["../../tests/asset-contract/**/*.test.ts"],
    // The whole-set checks decode and walk every production image, about a
    // second and a half on an idle machine and more than five when the whole
    // suite is running at once. As in `packages/shared`, the default budget
    // made them a measurement of the machine rather than of the art.
    testTimeout: 20_000,
  },
});
