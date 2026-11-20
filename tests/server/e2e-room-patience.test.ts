import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import type { RaceRoom } from "../../apps/server/src/rooms/race-room";
import { createColyseusRaceServer, type ColyseusRaceServer } from "../../apps/server/src/colyseus-server";

/**
 * The browser suite's way of waiting on a room (`e2e/support/server-fixture`),
 * against a real server: patience counted in the room's ticks, so a stalled
 * machine does not use it up, and a room that has stopped is told apart from one
 * that is only slow.
 */

type Fixture = typeof import("../e2e/support/server-fixture");

/** One server for the file: a boot is the dearest thing in it, and each test makes its own room. */
let server: ColyseusRaceServer;
let fixture: Fixture;
let room: RaceRoom;
let code: string;

beforeAll(async () => {
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    testDriverToken: "e2e-driver-token",
  });
  // The fixture reads where the server is when it is loaded.
  vi.stubEnv("FLOOR_FIFTY_SERVER_URL", `http://127.0.0.1:${server.port}`);
  vi.stubEnv("FLOOR_FIFTY_TEST_DRIVER_TOKEN", "e2e-driver-token");
  vi.resetModules();
  fixture = await import("../e2e/support/server-fixture");
});

beforeEach(async () => {
  const created = (await (
    await fetch(`http://127.0.0.1:${server.port}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    })
  ).json()) as { roomId: string };
  code = created.roomId;
  room = matchMaker.getLocalRoomById(code) as unknown as RaceRoom;
  room.stopClock();
});

afterEach(async () => {
  // A room with its clock stopped and no one in it would otherwise wait for the server's close.
  await room.disconnect();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("waiting on a room in its own ticks", () => {
  it("returns the room's reading as soon as it says what was waited for", async () => {
    room.race.phase = "countdown";
    const reading = await fixture.waitForRoom(code, (now) => now.phase === "countdown", { what: "the count", ticks: 10, pollMs: 5 });
    expect(reading).toMatchObject({ phase: "countdown", held: [] });
  });

  it("is not used up by wall time the room did not tick through", async () => {
    // Three ticks of patience, a quarter of a second of wall with the room
    // standing still: a wall bound of that length would have failed.
    setTimeout(() => {
      room.race.phase = "racing";
    }, 250);
    const reading = await fixture.waitForRoom(code, (now) => now.phase === "racing", { what: "the race", ticks: 3, pollMs: 10 });
    expect(reading.phase).toBe("racing");
  });

  it("accepts a completed transition observed after a delayed poll", async () => {
    const realFetch = globalThis.fetch;
    let readings = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (String(input).endsWith("/__test__/room") && ++readings === 1) {
        // The first response already contains the old state. Before the next
        // poll, the server advances beyond the allowance and reaches the goal.
        for (let tick = 0; tick < 4; tick += 1) room.stepOnce();
        room.race.phase = "racing";
      }
      return response;
    });
    try {
      await expect(fixture.waitForRoom(code, (now) => now.phase === "racing", {
        what: "the race", ticks: 3, pollMs: 1,
      })).resolves.toMatchObject({ phase: "racing" });
      expect(readings).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fails once the room has run its ticks, and says where it is", async () => {
    const ticking = (async () => {
      for (let tick = 0; tick < 200; tick += 1) {
        room.stepOnce();
        await sleep(2);
      }
    })();
    await expect(fixture.waitForRoom(code, () => false, { what: "the song step", ticks: 40, pollMs: 5 })).rejects.toThrow(
      /the song step: the room ran \d+ ticks \(of 40\) and is still lobby, held: \[\]/,
    );
    await ticking;
  });

  it("names the clocks held when the room runs out of ticks, which is why a step that was never let go fails by name", async () => {
    await fixture.holdRoomClocks(code, ["stage", "song"]);
    const ticking = (async () => {
      for (let tick = 0; tick < 100; tick += 1) {
        room.stepOnce();
        await sleep(2);
      }
    })();
    await expect(fixture.waitForRoom(code, () => false, { what: "select", ticks: 20, pollMs: 5 })).rejects.toThrow(/held: \[stage, song\]/);
    await ticking;
  });

  it("tells a room that has stopped from one that is slow", async () => {
    const patience = new fixture.RoomPatience(code, "the countdown", 1_000, 60);
    await patience.check();
    await sleep(120);
    await expect(patience.check()).rejects.toThrow(/the countdown: the room's clock stood still for 0\.06 s at tick/);
  });

  it("says whether the server has a room, which is what tells a refused join from a missing room", async () => {
    expect(await fixture.roomExists(code)).toBe(true);
    expect(await fixture.roomExists("NOROOM")).toBe(false);
  });

  it("holds and lets go of clocks through the driver, and reads them back", async () => {
    expect((await fixture.holdRoomClocks(code, ["countdown"])).held).toEqual(["countdown"]);
    expect((await fixture.readRoom(code)).held).toEqual(["countdown"]);
    expect((await fixture.holdRoomClocks(code, [])).held).toEqual([]);
  });
});

describe("asking the driver over a connection that drops", () => {
  /** A server that kills the first connections it is given, then answers: a keep-alive socket reset under the client. */
  async function flakyDriver(drops: number): Promise<{ url: string; close(): Promise<void>; asked(): number }> {
    let asked = 0;
    const flaky = createServer((request, response) => {
      asked += 1;
      if (asked <= drops) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ phase: "lobby", tick: 7, held: [], seats: [] }));
    });
    await new Promise<void>((resolve) => flaky.listen(0, "127.0.0.1", resolve));
    return {
      url: `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`,
      close: () =>
        new Promise<void>((resolve) => {
          flaky.close(() => resolve());
          flaky.closeAllConnections();
        }),
      asked: () => asked,
    };
  }

  async function fixtureAt(url: string): Promise<Fixture> {
    vi.stubEnv("FLOOR_FIFTY_SERVER_URL", url);
    vi.resetModules();
    return import("../e2e/support/server-fixture");
  }

  it("asks again, because a read and a hold say the same thing twice", async () => {
    const driver = await flakyDriver(2);
    try {
      const flaky = await fixtureAt(driver.url);
      await expect(flaky.readRoom("ANY")).resolves.toMatchObject({ phase: "lobby", tick: 7 });
      expect(driver.asked()).toBe(3);
    } finally {
      await driver.close();
    }
  });

  it("gives up when the driver is gone, and says which request it could not make", async () => {
    const driver = await flakyDriver(1_000);
    try {
      const flaky = await fixtureAt(driver.url);
      await expect(flaky.holdRoomClocks("ANY", ["stage"])).rejects.toThrow(/\/__test__\/clock/);
    } finally {
      await driver.close();
    }
  });
});
