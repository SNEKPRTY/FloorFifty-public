import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createColyseusHarness, type ColyseusHarness } from "./colyseus-harness";

let harness: ColyseusHarness | undefined;
let holder: Server | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await new Promise<void>((resolve) => (holder === undefined ? resolve() : holder.close(() => resolve())));
  holder = undefined;
});

/** A port the kernel has just handed out, and nothing holds now. */
function freePortNow(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe("the harness's port", () => {
  // The port is found by asking the kernel for a free one and closing it, and
  // the server is booted on it afterwards. In that gap another vitest worker
  // can bind the same port, and `boot` then logs EADDRINUSE and never settles:
  // the hook runs to its 20 s timeout (run #674, race-room-lifecycle.test.ts,
  // "listen EADDRINUSE: address already in use :::55794"). Here a socket
  // already holds the first port the harness is offered, which is that race
  // with the timing taken out.
  it("takes another port when the one it was handed is already held", async () => {
    const heldPort = await new Promise<number>((resolve, reject) => {
      holder = createServer();
      holder.once("error", reject);
      holder.listen(0, () => resolve((holder!.address() as { port: number }).port));
    });
    const offered: number[] = [];
    const queue = [heldPort];

    harness = await createColyseusHarness(4182, {
      portSource: async () => {
        const port = queue.shift() ?? (await freePortNow());
        offered.push(port);
        return port;
      },
    });

    expect(offered[0]).toBe(heldPort);
    expect(offered.length).toBeGreaterThan(1);
    expect(offered.at(-1)).not.toBe(heldPort);
    // And the server it recovered onto is a working one.
    const host = await harness.create("Kite");
    expect(host.roomId).not.toBe("");
  });
});
