import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["../../tests/server/**/*.test.ts"],
    // Colyseus's stats attach to PM2 when `@pm2/io` resolves, and that agent
    // writes to `process.send` -- vitest's own IPC channel under the forks
    // pool. Worker threads have no `process.send`, so the agent's sends are
    // inert there and the pool's MessagePort protocol is left alone.
    pool: "threads",
    server: {
      deps: {
        // Colyseus ships ESM that imports its own pnpm-linked dependencies by
        // bare name; inlining it makes Vite resolve those from the workspace
        // symlink, where pnpm has not linked them. Node's own loader follows
        // the symlink to the real path and finds them.
        external: [/@colyseus\//],
      },
    },
    // Socket.IO integration tests bind ephemeral ports and drive real clients,
    // so they need more headroom than a pure unit test.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
