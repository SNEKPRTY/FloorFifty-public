/**
 * The production boundary.
 *
 * The compiler is a development tool: it reads the authored tree and writes the
 * artifact. A server that could import it would be a server that could compile
 * at runtime, which is the thing committing the artifact exists to avoid. The
 * dev entry point is the one exception, and it is not reached in production.
 */

import { describe, expect, it } from "vitest";
import { readAllSources } from "./support/colyseus-harness";

describe("the production boundary", () => {
  it("keeps compiler imports out of the server's production entry point", async () => {
    const { readFile } = await import("node:fs/promises");
    const main = await readFile("apps/server/src/main.ts", "utf8");
    expect(main).not.toContain("@floor-fifty/content");
  });

  // The test driver drives rooms from outside; it is loaded only when a token
  // asks for it, so a production bundle never carries it (release readiness §6.6).
  it("loads the test driver only on demand, and never the dev entry", async () => {
    const { readFile } = await import("node:fs/promises");
    const server = await readFile("apps/server/src/colyseus-server.ts", "utf8");
    expect(server).not.toMatch(/^import[^;]*room-driver/m);
    const main = await readFile("apps/server/src/main.ts", "utf8");
    expect(main).not.toMatch(/from "\.\/dev"/);
  });

  it("keeps compiler imports out of the client", async () => {
    expect(await readAllSources("apps/client/src")).not.toContain("@floor-fifty/content");
  });
});
