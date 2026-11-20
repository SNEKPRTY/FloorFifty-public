import { afterEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { MAX_ROOMS_PER_ADDRESS, PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
  type ColyseusRaceServerOptions,
} from "../../../apps/server/src/colyseus-server";
import { liveRooms } from "../../../apps/server/src/rooms/live-rooms";
import { RaceRoom } from "../../../apps/server/src/rooms/race-room";

/**
 * The production audit's B1, second half: nothing limited how many rooms one
 * address could hold, so two addresses could take every slot. The limit is
 * counted by the address that created the room, so a stranger who fills a
 * public room does not pay for it.
 */

let server: ColyseusRaceServer | undefined;
let base = "";

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (over: Partial<ColyseusRaceServerOptions> = {}): Promise<void> => {
  // Behind Fly, so a test can be two addresses with one header.
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    proxy: "fly",
    ...over,
  });
  base = `http://127.0.0.1:${server.port}`;
};

const call = (verb: "create" | "joinOrCreate", address: string, body: object = {}): Promise<Response> =>
  fetch(`${base}/matchmake/${verb}/race`, {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": address },
    body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION, ...body }),
  });

const refusal = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { error?: string; message?: string };
  return `${body.error ?? ""} ${body.message ?? ""}`;
};

describe("rooms per address (audit B1)", () => {
  it("refuses an address's room past its cap with the server-is-full words", async () => {
    await start({ maxRoomsPerAddress: 2 });
    expect((await call("create", "203.0.113.7")).status).toBe(200);
    expect((await call("create", "203.0.113.7")).status).toBe(200);
    const third = await call("create", "203.0.113.7");
    expect(third.status).not.toBe(200);
    expect(await refusal(third)).toMatch(/server is full/);
    expect(liveRooms.size).toBe(2);
  });

  it("leaves every other address its own rooms", async () => {
    await start({ maxRoomsPerAddress: 1 });
    expect((await call("create", "203.0.113.7")).status).toBe(200);
    expect((await call("create", "203.0.113.7")).status).not.toBe(200);
    expect((await call("create", "198.51.100.9")).status).toBe(200);
  });

  it("gives the slot back the moment the room closes", async () => {
    await start({ maxRoomsPerAddress: 1 });
    const first = (await (await call("create", "203.0.113.7")).json()) as { roomId: string };
    expect((await call("create", "203.0.113.7")).status).not.toBe(200);
    await matchMaker.getLocalRoomById(first.roomId)!.disconnect();
    expect((await call("create", "203.0.113.7")).status).toBe(200);
  });

  it("does not charge an address for a room it only filled", async () => {
    await start({ maxRoomsPerAddress: 1 });
    // One address opens a public room; another's Find a race fills it.
    const opened = (await (await call("joinOrCreate", "203.0.113.7", { quickMatch: true })).json()) as { roomId: string };
    const filled = (await (await call("joinOrCreate", "198.51.100.9", { quickMatch: true })).json()) as { roomId: string };
    expect(filled.roomId).toBe(opened.roomId);
    // The filler holds no room of its own: its one allowed room is still free.
    expect((await call("create", "198.51.100.9")).status).toBe(200);
  });

  it("counts a Find a race that opens a room, so it cannot be used around the cap", async () => {
    await start({ maxRoomsPerAddress: 1 });
    expect((await call("create", "203.0.113.7")).status).toBe(200);
    const find = await call("joinOrCreate", "203.0.113.7", { quickMatch: true });
    expect(find.status).not.toBe(200);
    expect(await refusal(find)).toMatch(/server is full/);
  });

  it("holds when the requests arrive together, so a burst cannot all pass a limit of one", async () => {
    await start({ maxRoomsPerAddress: 1 });
    const answers = await Promise.all(Array.from({ length: 5 }, () => call("create", "203.0.113.7")));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    expect(liveRooms.size).toBe(1);
  });

  it("uses MAX_ROOMS_PER_ADDRESS unless told otherwise", async () => {
    await start();
    expect(RaceRoom.options?.maxRoomsPerAddress).toBe(MAX_ROOMS_PER_ADDRESS);
  });

  it("applies no per-address cap to a server the browser suite drives, whose every browser is one address", async () => {
    await start({ proxy: "caddy", testDriverToken: "driver-token" });
    expect(RaceRoom.options?.maxRoomsPerAddress).toBe(Number.POSITIVE_INFINITY);
  });
});
