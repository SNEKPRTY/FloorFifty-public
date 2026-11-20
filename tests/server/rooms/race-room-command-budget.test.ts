import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_BUDGET, MAX_MESSAGES_PER_SECOND, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * The production audit's B2: only `input` and `ping` were budgeted, so one
 * socket could loop on any other command and make the room parse, handle,
 * project and answer every one. Over budget a command is dropped untouched.
 */

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.close();
});

/** Fresh request ids, so the ledger's de-duplication cannot be what answers or refuses them. */
const flood = (client: { send(type: string, payload?: unknown): void }, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    client.send("setReady", { requestId: nextRequestId(), ready: index % 2 === 0 });
  }
};

/** Lets every message sent so far reach the room, without stepping its clock. */
const deliver = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 100));
};

describe("a flood of commands from one seat (audit B2)", () => {
  it("is answered no more than the burst, and projected no more than the burst", async () => {
    const host = await harness.create("Kite");
    await deliver();
    const answeredBefore = host.messages("commandResult").length;
    const project = vi.spyOn(harness.room, "project");
    flood(host, COMMAND_BUDGET.burst + 40);
    await deliver();
    const answered = host.messages("commandResult").length - answeredBefore;
    expect(answered).toBeGreaterThan(0);
    expect(answered).toBeLessThanOrEqual(COMMAND_BUDGET.burst);
    expect(project.mock.calls.length).toBeLessThanOrEqual(COMMAND_BUDGET.burst);
  });

  it("leaves another seat its whole burst", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await deliver();
    flood(host, COMMAND_BUDGET.burst + 40);
    await deliver();
    const before = guest.messages("commandResult").length;
    flood(guest, 4);
    await deliver();
    expect(guest.messages("commandResult").length - before).toBe(4);
  });

  it("is answered again once the room clock has earned commands back", async () => {
    const host = await harness.create("Kite");
    flood(host, COMMAND_BUDGET.burst + 40);
    await deliver();
    const before = host.messages("commandResult").length;
    flood(host, 3);
    await deliver();
    expect(host.messages("commandResult").length).toBe(before);
    await harness.advanceTicks(TICK_HZ);
    flood(host, COMMAND_BUDGET.perSecond + 10);
    await deliver();
    const earned = host.messages("commandResult").length - before;
    expect(earned).toBeGreaterThanOrEqual(COMMAND_BUDGET.perSecond - 1);
    expect(earned).toBeLessThanOrEqual(COMMAND_BUDGET.perSecond + 1);
  });
});

describe("the outer guard on any message at all (audit B2)", () => {
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const seatStatus = (playerId: string): string | undefined =>
    harness.room.raceState.players[playerId as keyof typeof harness.room.raceState.players]?.status;

  it("uses MAX_MESSAGES_PER_SECOND on every room", async () => {
    await harness.create("Kite");
    expect(harness.room.maxMessagesPerSecond).toBe(MAX_MESSAGES_PER_SECOND);
  });

  it("closes a socket that sends just over that in a second, and holds its seat", async () => {
    const host = await harness.create("Kite");
    for (let index = 0; index < MAX_MESSAGES_PER_SECOND + 10; index += 1) host.send("ping", { id: index, tick: -1 });
    await pause(300);
    expect(seatStatus(host.sessionPlayerId)).toBe("ghost");
  });

  it("leaves a socket just under that in a second alone", async () => {
    const host = await harness.create("Kite");
    for (let index = 0; index < MAX_MESSAGES_PER_SECOND - 10; index += 1) host.send("ping", { id: index, tick: -1 });
    await pause(300);
    expect(seatStatus(host.sessionPlayerId)).toBe("connected");
  });

  it("leaves a socket sending a racing client's usual rate alone", async () => {
    const host = await harness.create("Kite");
    // A second's inputs and the pings beside them: the busiest honest second.
    for (let index = 0; index < TICK_HZ + 4; index += 1) host.send("ping", { id: index, tick: -1 });
    await pause(300);
    expect(seatStatus(host.sessionPlayerId)).toBe("connected");
  });
});
