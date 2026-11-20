import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, QUICK_MATCH_SEARCH_TICKS, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import type { RaceRoom } from "../../../apps/server/src/rooms/race-room";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;
const race = () => harness.room.raceState;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

/** A public room made directly, its clock stopped, for tests that need two. */
async function openPublicRoom(name: string) {
  const sdkRoom = await harness.server.sdk.create("race", { name, protocolVersion: PROTOCOL_VERSION, quickMatch: true });
  (harness.server.getRoomById(sdkRoom.roomId) as unknown as RaceRoom).stopClock();
  return sdkRoom;
}

describe("matching", () => {
  it("seats two quick-match clients in one public room", async () => {
    const first = await harness.quickMatch("Kite");
    const second = await harness.quickMatch("Sable");
    expect(second.roomId).toBe(first.roomId);
    expect(race().access).toBe("public");
    expect(Object.keys(race().players)).toHaveLength(2);
  });

  it("seats two players who press Find a race together in one room", async () => {
    // Straight through the SDK: the harness settles one tick per join, which two
    // concurrent joins would wait on at once.
    const find = (name: string) =>
      harness.server.sdk.joinOrCreate("race", { name, protocolVersion: PROTOCOL_VERSION, quickMatch: true });
    const [first, second] = await Promise.all([find("Kite"), find("Sable")]);
    (harness.server.getRoomById(first.roomId) as unknown as RaceRoom).stopClock();
    expect(second.roomId).toBe(first.roomId);
  });

  it("never matches a room opened with Create room", async () => {
    const host = await harness.create("Kite");
    expect(race().access).toBe("private");
    const stranger = await harness.quickMatch("Sable");
    expect(stranger.roomId).not.toBe(host.roomId);
    expect(Object.keys(race().players)).toHaveLength(1);
  });

  it("still lets a friend join a public room by its code", async () => {
    const host = await harness.quickMatch("Kite");
    const friend = await harness.joinById(host.roomId, "Sable");
    expect(friend.roomId).toBe(host.roomId);
  });

  it("fills the fuller of two open public rooms", async () => {
    const quiet = await openPublicRoom("Kite");
    const busy = await openPublicRoom("Sable");
    await harness.server.sdk.joinById(busy.roomId, { name: "Ember", protocolVersion: PROTOCOL_VERSION });

    const arrival = await harness.server.sdk.joinOrCreate("race", {
      name: "Late",
      protocolVersion: PROTOCOL_VERSION,
      quickMatch: true,
    });
    expect(arrival.roomId).toBe(busy.roomId);
    expect(arrival.roomId).not.toBe(quiet.roomId);
  });
});

describe("the listing follows the phase", () => {
  async function twoInSelect() {
    const host = await harness.quickMatch("Kite");
    const guest = await harness.quickMatch("Sable");
    await harness.setReady(host, true);
    await harness.setReady(guest, true);
    expect(race().phase).toBe("select");
    return { host, guest };
  }

  it("opens a new room for the next quick match once a public room is in select", async () => {
    const { host } = await twoInSelect();
    const late = await harness.quickMatch("Late");
    expect(late.roomId).not.toBe(host.roomId);
  });

  it("still refuses a join by the code of a room in select, with the real reason", async () => {
    const { host } = await twoInSelect();
    const refusal = await harness.joinById(host.roomId, "Friend").catch((error: unknown) => error);
    expect(String((refusal as Error).message)).toMatch(/racing|closed/);
  });

  it("lists the room again after Race again, so strangers can fill the free seats", async () => {
    const { host } = await twoInSelect();
    harness.room.finishForTest();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(race().phase).toBe("lobby");

    const late = await harness.quickMatch("Late");
    expect(late.roomId).toBe(host.roomId);
  });
});

describe("the listing across every phase, and the lock", () => {
  it("is unlisted while racing and once finished, so a stranger is never sent to it", async () => {
    const host = await harness.quickMatch("Kite");
    await harness.quickMatch("Sable");
    await harness.startRace();
    expect(race().phase).toBe("racing");

    const whileRacing = await harness.quickMatch("Late");
    expect(whileRacing.roomId).not.toBe(host.roomId);

    harness.room.finishForTest();
    expect(race().phase).toBe("finished");
    const afterFinish = await harness.quickMatch("Later");
    expect(afterFinish.roomId).not.toBe(host.roomId);
  });

  it("locks a full public room and sends the fifth stranger to a new one", async () => {
    const first = await harness.quickMatch("One");
    for (const name of ["Two", "Three", "Four"]) {
      expect((await harness.quickMatch(name)).roomId).toBe(first.roomId);
    }
    const fifth = await harness.quickMatch("Five");
    expect(fifth.roomId).not.toBe(first.roomId);
  });

  it("lists a full room again when a racer leaves: the lock means full and nothing else", async () => {
    const first = await harness.quickMatch("One");
    const others = [] as Awaited<ReturnType<typeof harness.quickMatch>>[];
    for (const name of ["Two", "Three", "Four"]) others.push(await harness.quickMatch(name));
    // A fifth opens a second room, so there is a decoy to prefer if the first stays full.
    await harness.quickMatch("Five");

    await others[0]!.leave();
    await harness.advanceTicks(1);

    const sixth = await harness.quickMatch("Six");
    expect(sixth.roomId).toBe(first.roomId);
  });
});

describe("the clocks in a real room", () => {
  it("projects access and the search clock to the client", async () => {
    const host = await harness.quickMatch("Kite");
    await vi.waitFor(() => {
      expect(host.state.access).toBe("public");
      expect(host.state.soloFromTick).toBeGreaterThan(0);
      expect(host.state.startsAtTick).toBe(-1);
    });
  });

  it("lets a lone racer race alone without waiting out the search", async () => {
    const host = await harness.quickMatch("Kite");
    await harness.advanceTicks(1);
    expect(race().soloFromTick).toBeGreaterThan(race().tick);
    await harness.setReady(host, true);
    expect(race().phase).toBe("select");
  });

  it("carries racers who never pressed Ready into select when the start clock runs out", async () => {
    await harness.quickMatch("Kite");
    await harness.quickMatch("Sable");
    await harness.advanceTicks(QUICK_MATCH_START_TICKS + 1);
    expect(race().phase).toBe("select");
    expect(Object.values(race().players).every((player) => player.ready)).toBe(true);
  });

  it("leaves a private room in its lobby once the public clocks would have run out (only the idle deadline ends it)", async () => {
    await harness.create("Kite");
    await harness.advanceTicks(QUICK_MATCH_START_TICKS + QUICK_MATCH_SEARCH_TICKS);
    expect(race().phase).toBe("lobby");
  });

  it("clears both clocks when the only racer drops and restarts the search when they return", async () => {
    const host = await harness.quickMatch("Kite");
    const token = host.reconnectionToken;
    await harness.drop(host);
    await harness.advanceTicks(1);
    expect(race().soloFromTick).toBeUndefined();
    expect(race().startsAtTick).toBeUndefined();

    await harness.reconnect(token);
    await harness.advanceTicks(1);
    expect(race().soloFromTick).toBeGreaterThan(race().tick);
  });

  it("starts the right clock again after Race again", async () => {
    const host = await harness.quickMatch("Kite");
    await harness.quickMatch("Sable");
    await harness.advanceTicks(QUICK_MATCH_START_TICKS + 1);
    harness.room.finishForTest();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(2);
    expect(race().phase).toBe("lobby");
    expect(race().startsAtTick).toBeGreaterThan(race().tick);
  });
});

describe("names in a public room", () => {
  beforeEach(() => {
    harness.contentStore.replace({
      ...GENERATED_CONTENT,
      content: { ...GENERATED_CONTENT.content, blockedNames: ["blorp"] },
    });
  });

  it("replaces a blocked name with a racer name, with no error", async () => {
    const host = await harness.quickMatch("Bl0rp Fan");
    const player = race().players[host.sessionPlayerId]!;
    expect(player.name).toMatch(/^Racer \d\d$/);
    expect(host.messages("serverError")).toHaveLength(0);
  });

  it("replaces it for a friend who joins a public room by its code", async () => {
    const host = await harness.quickMatch("Kite");
    const friend = await harness.joinById(host.roomId, "BLORP");
    expect(race().players[friend.sessionPlayerId]!.name).toMatch(/^Racer \d\d$/);
  });

  it("keeps the same name in a private room", async () => {
    const host = await harness.create("Bl0rp Fan");
    expect(race().players[host.sessionPlayerId]!.name).toBe("Bl0rp Fan");
  });

  it("keeps a clean name in a public room", async () => {
    const host = await harness.quickMatch("Kite");
    expect(race().players[host.sessionPlayerId]!.name).toBe("Kite");
  });
});
