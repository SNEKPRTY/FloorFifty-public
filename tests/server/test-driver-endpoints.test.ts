import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION, SELECT_STEP_TICKS } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import type { RaceRoom } from "../../apps/server/src/rooms/race-room";
import { createColyseusRaceServer, type ColyseusRaceServer } from "../../apps/server/src/colyseus-server";

const TOKEN = "e2e-driver-token";

/**
 * One server for the file: a boot is the dearest thing in it, and each test makes its own room.
 * (Colyseus's matchmaker is one per process, so a second server here would take this one's down;
 * that the routes are absent on a server with no token is pinned in `colyseus-server.test.ts`.)
 */
let server: ColyseusRaceServer;
let base: string;
const made: RaceRoom[] = [];

beforeAll(async () => {
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    testDriverToken: TOKEN,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  // A room with its clock stopped and no one in it would otherwise wait for the server's close.
  for (const room of made.splice(0)) await room.disconnect();
});

afterAll(async () => {
  await server.close();
});

async function start(): Promise<{ base: string; code: string; room: RaceRoom }> {
  const created = (await (
    await fetch(`${base}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    })
  ).json()) as { roomId: string };
  const room = matchMaker.getLocalRoomById(created.roomId) as unknown as RaceRoom;
  room.stopClock();
  made.push(room);
  return { base, code: created.roomId, room };
}

/** `token` null sends none: an omitted argument would take the default, which is the right token. */
function post(base: string, path: string, body: unknown, token: string | null = TOKEN): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === null ? {} : { "x-test-token": token }) },
    body: JSON.stringify(body),
  });
}

describe("the test driver's room reading and clock hold", () => {
  it("reads a room's phase, tick, select step and held clocks from the room itself", async () => {
    const { base, code, room } = await start();
    const lobby = await post(base, "/__test__/room", { roomCode: code });
    expect(lobby.status).toBe(200);
    expect(await lobby.json()).toMatchObject({ phase: "lobby", tick: room.raceState.tick, held: [], seats: [] });

    // A seat taken the way the harness takes a late one: `onJoin` is what a seat is.
    room.onJoin({ sessionId: "s1", send: () => undefined } as never, { name: "Kite", protocolVersion: PROTOCOL_VERSION });
    room.race.phase = "select";
    room.race.select = { step: "stage", endsAtTick: room.race.tick + SELECT_STEP_TICKS, picks: {}, loaded: [] };

    const select = (await (await post(base, "/__test__/room", { roomCode: code })).json()) as Record<string, unknown>;
    expect(select).toMatchObject({ phase: "select", tick: room.raceState.tick, step: "stage", stepEndsAtTick: room.raceState.tick + SELECT_STEP_TICKS });
    expect(select["seats"]).toMatchObject([{ id: room.seatedPlayerIds()[0], status: "connected", cpu: false, x: expect.any(Number), y: expect.any(Number), input: { left: false, right: false, fastFall: false } }]);
    const playerId = room.seatedPlayerIds()[0]!;
    room.race.phase = "countdown";
    expect(room.submitInput(playerId, { sequence: 1, tick: room.raceState.tick + 1, left: false, right: true, fastFall: false, reset: false }, false).outcome).toBe("accepted");
    room["inputQueue"].take(room.raceState.tick + 1);
    const applied = await (await post(base, "/__test__/room", { roomCode: code })).json();
    expect(applied.seats[0].input).toMatchObject({ right: true, left: false, sequence: 1 });
  });

  it("holds the clocks it is told to, and says which it holds", async () => {
    const { base, code, room } = await start();
    const held = await post(base, "/__test__/clock", { roomCode: code, hold: ["stage", "countdown"] });
    expect(held.status).toBe(200);
    expect(await held.json()).toMatchObject({ held: ["stage", "countdown"] });
    expect(room.heldClocks()).toEqual(["stage", "countdown"]);

    // The list replaces what was held: an empty one lets every clock go.
    const freed = await post(base, "/__test__/clock", { roomCode: code, hold: [] });
    expect(await freed.json()).toMatchObject({ held: [] });
    expect(room.heldClocks()).toEqual([]);
  });

  it("refuses a clock it does not know, leaving what was held as it was", async () => {
    const { base, code, room } = await start();
    await post(base, "/__test__/clock", { roomCode: code, hold: ["song"] });
    const refused = await post(base, "/__test__/clock", { roomCode: code, hold: ["racing"] });
    expect(refused.status).toBe(400);
    expect(room.heldClocks()).toEqual(["song"]);
    expect((await post(base, "/__test__/clock", { roomCode: code })).status).toBe(400);
  });

  it("answers 404 for a room that is not there", async () => {
    const { base } = await start();
    expect((await post(base, "/__test__/room", { roomCode: "NOROOM" })).status).toBe(404);
    expect((await post(base, "/__test__/clock", { roomCode: "NOROOM", hold: [] })).status).toBe(404);
  });

  it("wants the token, and a POST", async () => {
    const { base, code } = await start();
    for (const path of ["/__test__/room", "/__test__/clock"]) {
      expect((await post(base, path, { roomCode: code, hold: [] }, null)).status).toBe(403);
      expect((await post(base, path, { roomCode: code, hold: [] }, "not-the-token")).status).toBe(403);
      expect((await fetch(`${base}${path}`, { headers: { "x-test-token": TOKEN } })).status).toBe(405);
    }
  });

  it("still drives a room, as before", async () => {
    const { base, code } = await start();
    const driven = await post(base, "/__test__/drive", { roomCode: code, ticks: 5 });
    expect(driven.status).toBe(200);
    expect(await driven.json()).toMatchObject({ phase: "lobby" });
  });
});
