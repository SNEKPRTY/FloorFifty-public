import { afterEach, describe, expect, it } from "vitest";
import { IDLE_WARNING_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * Audit B1, the warning (the coordinator's ruling, 2026-11-14): a room nobody
 * has used for ten minutes closes, and one minute before it does the room tells
 * its players, who may press Keep room open. The deadline here is short so no
 * test steps ten minutes of ticks; the warning leads it by a minute, or by half
 * of it when it is shorter than two minutes.
 */

const IDLE = 1_200;
let harness: ColyseusHarness | undefined;
afterEach(async () => {
  await harness?.close();
});

const open = async () => {
  harness = await createColyseusHarness(4182, { roomIdleTicks: IDLE });
  return harness.create("Kite");
};
const room = (): ColyseusHarness => harness!;
/** The warnings themselves, apart from the word that a room was kept open. */
const warnings = (client: { messages(type: string): unknown[] }): unknown[] =>
  client.messages("idleWarning").filter((message) => (message as { closesInSeconds: unknown }).closesInSeconds !== null);
const live = (): boolean => room().server.getRoomById(room().room.roomId) !== undefined;

describe("the warning before an idle room closes", () => {
  it("is a minute long, in the room's own ticks", () => {
    expect(IDLE_WARNING_TICKS).toBe(60 * TICK_HZ);
  });

  it("is sent once, a lead before the deadline, and says how long is left", async () => {
    const host = await open();
    await room().advanceTicks(IDLE / 2 - 20);
    expect(host.messages("idleWarning")).toEqual([]);
    await room().advanceTicks(40);
    expect(warnings(host)).toEqual([{ closesInSeconds: IDLE / 2 / TICK_HZ }]);
    await room().advanceTicks(IDLE / 4);
    expect(warnings(host)).toHaveLength(1);
  });

  it("is followed by the close if nobody answers", async () => {
    await open();
    await room().advanceTicks(IDLE + 1);
    await room().waitForDisposal();
  });

  it("is answered by Keep room open, which gives the room another whole deadline and re-arms the warning", async () => {
    const host = await open();
    await room().advanceTicks(IDLE / 2 + 20);
    expect(warnings(host)).toHaveLength(1);
    host.send("stillHere", { requestId: nextRequestId() });
    await room().advanceTicks(IDLE - 100);
    expect(live()).toBe(true);
    await room().advanceTicks(IDLE / 2);
    expect(warnings(host)).toHaveLength(2);
  });

  it("tells every seat it was kept open, so no screen goes on saying it closes", async () => {
    const host = await open();
    await room().advanceTicks(IDLE / 2 + 20);
    host.send("setReady", { requestId: nextRequestId(), ready: true });
    await room().advanceTicks(2);
    expect(host.messages("idleWarning").at(-1)).toEqual({ closesInSeconds: null });
  });

  it("says nothing of being kept open when no warning was sent", async () => {
    const host = await open();
    host.send("setReady", { requestId: nextRequestId(), ready: true });
    await room().advanceTicks(2);
    expect(host.messages("idleWarning")).toEqual([]);
  });

  it("answers Keep room open like any command", async () => {
    const host = await open();
    const requestId = nextRequestId();
    host.send("stillHere", { requestId });
    await room().advanceTicks(1);
    expect(host.messages("commandResult")).toContainEqual({ requestId, ok: true });
  });

  it("is never sent to a race in progress", async () => {
    harness = await createColyseusHarness(4182, { roomIdleTicks: IDLE });
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
    await room().advanceTicks(1);
    await room().startRace();
    await room().advanceTicks(IDLE * 2);
    expect(host.messages("idleWarning")).toEqual([]);
  });
});
