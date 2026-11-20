import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION, UNARRIVED_ROOM_TICKS } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { createColyseusRaceServer, type ColyseusRaceServer } from "../../../apps/server/src/colyseus-server";
import { liveRooms } from "../../../apps/server/src/rooms/live-rooms";
import type { RaceRoom } from "../../../apps/server/src/rooms/race-room";

/**
 * The production audit's B1: nothing may hold a room slot for ever (14 Nov
 * 2026, the project's internal notes). Against a
 * real server, with each room's clock stepped by hand so no wall time passes.
 */

let server: ColyseusRaceServer;

beforeEach(async () => {
  server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
});
afterEach(async () => {
  await server.close();
});

/** A room made over HTTP alone, as the cheap form of B1 makes one: nobody connects to it. */
async function createUnconnectedRoom(): Promise<RaceRoom> {
  const response = await fetch(`http://127.0.0.1:${server.port}/matchmake/create/race`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
  });
  const { roomId } = (await response.json()) as { roomId: string };
  const room = matchMaker.getLocalRoomById(roomId) as unknown as RaceRoom;
  room.stopClock();
  return room;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe("a room whose first player never arrives", () => {
  it("is released after UNARRIVED_ROOM_TICKS, not held for the reconnect grace", async () => {
    const room = await createUnconnectedRoom();
    expect(liveRooms.size).toBe(1);
    for (let tick = 0; tick < UNARRIVED_ROOM_TICKS + 1; tick += 1) room.stepOnce();
    await settle();
    expect(liveRooms.size).toBe(0);
  });

  it("is still held just inside that window", async () => {
    const room = await createUnconnectedRoom();
    for (let tick = 0; tick < UNARRIVED_ROOM_TICKS - 1; tick += 1) room.stepOnce();
    await settle();
    expect(liveRooms.size).toBe(1);
    await room.disconnect();
  });
});
