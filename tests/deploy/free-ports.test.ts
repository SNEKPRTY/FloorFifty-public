import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./support/stubs";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

describe("free-ports", () => {
  it("kills whatever a cancelled job left listening, and passes when nothing is", async () => {
    const port = await freePort();
    const squatter = spawn(process.execPath, ["-e", `require("net").createServer().listen(${port}, "127.0.0.1")`]);
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const result = spawnSync("bash", [join(REPO, "deploy/bin/free-ports"), String(port)], { encoding: "utf8" });
      const exited = await Promise.race([
        new Promise((resolve) => squatter.once("exit", () => resolve(true))),
        new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);

      expect(result.status).toBe(0);
      expect(exited).toBe(true);
      expect(spawnSync("bash", [join(REPO, "deploy/bin/free-ports"), String(port)]).status).toBe(0);
    } finally {
      // A failing run must not leave its squatter behind.
      squatter.kill();
    }
  });
});
