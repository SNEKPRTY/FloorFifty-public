// @vitest-environment node
/**
 * The development proxy.
 *
 * The client talks to its own origin by default, in development exactly as in
 * production, so every path it asks the race server for has to be proxied by
 * the Vite development and preview servers. A path that is not proxied is
 * answered by the SPA fallback with `index.html`, which reaches the client as
 * `Unexpected token '<'` rather than as a failed request -- a boot failure
 * panel that names the server without saying the proxy is what is missing.
 *
 * The table is asserted here rather than the config file itself: importing
 * the config loads its plugins, and esbuild will not run under jsdom.
 */

import { describe, expect, it } from "vitest";
import { RACE_SERVER_PATHS, raceServerProxy } from "../../../apps/client/dev-proxy";

describe("the race server proxy", () => {
  it("covers matchmaking and the content endpoint", () => {
    expect([...RACE_SERVER_PATHS]).toEqual(["/matchmake", "/content"]);
  });

  it("points every path at the race server, upgrading nothing", () => {
    const proxy = raceServerProxy("http://127.0.0.1:3000");

    expect(Object.keys(proxy)).toEqual([...RACE_SERVER_PATHS]);
    expect(proxy["/content"]).toEqual({ target: "http://127.0.0.1:3000", changeOrigin: true });
    expect(proxy["/matchmake"]?.changeOrigin).toBe(true);
  });
});
