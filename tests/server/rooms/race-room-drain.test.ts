import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

/** Waits for something the room does on its own schedule. */
const until = async (condition: () => boolean, failure: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(failure);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const listed = async (roomId: string): Promise<boolean> =>
  (await matchMaker.query({ roomId }))[0]?.private === false;

describe("a room told to drain (release readiness §5.4)", () => {
  it("tells a lobby the server is updating, and closes it", async () => {
    const host = await harness.create("Kite");
    harness.room.beginDrain();
    await until(() => host.messages("serverError").length > 0, "the lobby was never told");
    expect(host.messages("serverError")[0]).toMatchObject({ code: "SERVER_UPDATING" });
    await until(() => harness.room.clients.length === 0, "the lobby stayed open");
  });

  it("unlists a public lobby at once", async () => {
    const host = await harness.quickMatch("Kite");
    expect(await listed(host.roomId)).toBe(true);
    harness.room.beginDrain();
    await until(() => harness.room.clients.length === 0, "the lobby stayed open");
  });

  it("lets a race run to its end, then closes when the room would go back to its lobby", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    harness.room.beginDrain();
    await harness.advanceTicks(5);
    expect(harness.room.clients.length).toBe(1);
    expect(host.messages("serverError")).toHaveLength(0);

    harness.room.finishForTest();
    await harness.advanceTicks(1);
    expect(harness.room.clients.length).toBe(1);

    host.send("raceAgain", { requestId: nextRequestId() });
    await until(() => host.messages("serverError").length > 0, "the finished room was never told");
    expect(host.messages("serverError")[0]).toMatchObject({ code: "SERVER_UPDATING" });
    await until(() => harness.room.clients.length === 0, "the finished room stayed open");
  });

  it("refuses a new join while draining", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    harness.room.beginDrain();
    const refusal = await harness.joinById(host.roomId, "Late").then(
      () => "",
      (error: unknown) => String((error as Error | undefined)?.message ?? error),
    );
    expect(refusal).toMatch(/server is updating/);
  });

  it("still gives a held seat back to its reconnection", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    harness.room.beginDrain();
    const resumed = await harness.reconnect(token);
    expect(resumed.sessionPlayerId).toBe(guest.sessionPlayerId);
  });
});
