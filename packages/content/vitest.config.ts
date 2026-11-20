import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "content",
    environment: "node",
    // Tests live in the repository-level `tests/` tree, grouped by the project
    // that owns them, as every other package does.
    include: ["../../tests/content/**/*.test.ts"],
  },
});
