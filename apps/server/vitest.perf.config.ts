import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Timing tests, alone. A wall-clock budget measured while other test files
// share the CPU measures the machine, not the room: the tick p99 is ~0.1 ms
// alone and crossed 4 ms under the parallel suite on CI. So these run after
// the rest (`pnpm test:perf`, chained from `pnpm test`), one file at a time,
// as the e2e frame budget does. Options otherwise mirror `vitest.config.ts`.
export default defineConfig({
  // Run from the repo root by `pnpm test:perf`; paths resolve from here.
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "server-perf",
    environment: "node",
    include: ["../../tests/server-perf/**/*.test.ts"],
    pool: "threads",
    fileParallelism: false,
    server: { deps: { external: [/@colyseus\//] } },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
