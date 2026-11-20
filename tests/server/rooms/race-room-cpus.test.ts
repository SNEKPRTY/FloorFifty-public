/** CPU seats in a real room (CPU players spec §3, §7.2). */
import type { Client } from "@colyseus/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_PLAYERS, PROTOCOL_VERSION, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { openSets } from "@floor-fifty/shared/content/access";
import { PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { unpackReplay } from "@floor-fifty/shared/replay/compression";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { createReplayStepper } from "@floor-fifty/shared/replay/stepper";
import { zlibCompression } from "../../../apps/server/src/rooms/replay-compression";
import { createColyseusHarness, nextRequestId, type ColyseusHarness, type HarnessClient } from "../support/colyseus-harness";

let harness: ColyseusHarness;
const race = () => harness.room.raceState;
const cpus = () => Object.values(race().players).filter((player) => player.cpu);

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const lastResult = (client: HarnessClient): CommandResult => client.messages("commandResult").at(-1) as CommandResult;
async function send(client: HarnessClient, type: string, payload: Record<string, unknown> = {}): Promise<string | undefined> {
  client.send(type, { requestId: nextRequestId(), ...payload });
  await harness.advanceTicks(1);
  const result = lastResult(client);
  return result.ok ? undefined : result.error.code;
}

describe("a private room's host", () => {
  it("adds a CPU that every seat sees, ready, in a free colour, wearing any character", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Wren");
    expect(await send(host, "addCpu")).toBeUndefined();
    const [cpu] = cpus();
    expect(cpu).toMatchObject({ ready: true, status: "connected" });
    expect(["gold", "violet"]).toContain(cpu!.colour);
    expect(cpu!.name).toBe(PERSONALITIES[cpu!.colour].name);
    expect(GENERATED_CONTENT.content.characters.map((character) => character.id)).toContain(cpu!.characterId);
    await guest.waitForNextPatch();
    expect(guest.state.players.get(cpu!.id)!.cpu).toBe(true);
  });

  it("dresses its CPUs from the whole catalogue, not only what is free to pick", async () => {
    const host = await harness.create("Kite");
    const open = new Set(openSets(GENERATED_CONTENT.content).characters);
    // Each CPU draws afresh (its id salts the room's stream), so seat and free
    // one until a draw lands outside the free set. Thirty all-free draws by
    // chance is under one in 10^20; a room offering only the free set fails always.
    const worn: string[] = [];
    for (let draw = 0; draw < 30 && !worn.some((id) => !open.has(id)); draw += 1) {
      await send(host, "addCpu");
      const cpu = cpus()[0]!;
      worn.push(cpu.characterId);
      await send(host, "removeCpu", { playerId: cpu.id });
    }
    expect(worn.some((id) => !open.has(id)), `worn: ${worn.join(", ")}`).toBe(true);
  });

  it("alone may add or remove one; a guest is told they are not the host", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Wren");
    expect(await send(guest, "addCpu")).toBe("NOT_HOST");
    await send(host, "addCpu");
    expect(await send(guest, "removeCpu", { playerId: cpus()[0]!.id })).toBe("NOT_HOST");
    expect(cpus()).toHaveLength(1);
  });

  it("fills the room with CPUs, after which a friend is refused as full", async () => {
    const host = await harness.create("Kite");
    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) expect(await send(host, "addCpu")).toBeUndefined();
    expect(await send(host, "addCpu")).toBe("ROOM_FULL");
    const refusal = await harness.joinById(host.roomId, "Late").catch((error: unknown) => error);
    expect(String((refusal as Error).message)).toMatch(/full|locked/i);
  });

  it("frees a seat by removing a CPU, and a friend can then join", async () => {
    const host = await harness.create("Kite");
    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) await send(host, "addCpu");
    expect(await send(host, "removeCpu", { playerId: cpus()[0]!.id })).toBeUndefined();
    const friend = await harness.joinById(host.roomId, "Late");
    expect(friend.roomId).toBe(host.roomId);
  });

  it("refuses a join that reaches the room after its last seat went to a CPU", async () => {
    const host = await harness.create("Kite");
    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) await send(host, "addCpu");
    expect(cpus()).toHaveLength(MAX_PLAYERS - 1);
    // Both doors a reserved join walks through, called as Colyseus would call
    // them once the socket arrives: the seat it reserved has gone since.
    const late = { sessionId: "late-session" } as unknown as Client;
    const options = { name: "Late", protocolVersion: PROTOCOL_VERSION };
    expect(() => harness.room.onAuth(late, options)).toThrow(/full/i);
    expect(() => harness.room.onJoin(late, options)).toThrow(/full/i);
    expect(Object.keys(race().players)).toHaveLength(MAX_PLAYERS);
  });
});

describe("the host role and closing", () => {
  it("passes to a person, never a CPU, when the host leaves", async () => {
    const host = await harness.create("Kite");
    await send(host, "addCpu");
    expect(cpus()).toHaveLength(1);
    const guest = await harness.joinById(host.roomId, "Wren");
    await harness.leave(host);
    expect(race().hostId).toBe(guest.sessionPlayerId);
  });

  it("closes when the last person leaves the lobby, CPUs or not", async () => {
    const host = await harness.create("Kite");
    await send(host, "addCpu");
    expect(cpus()).toHaveLength(1);
    await harness.leave(host);
    await harness.waitForDisposal();
  });

  it("closes when the last person leaves mid-race, CPUs or not", async () => {
    const host = await harness.create("Kite");
    await send(host, "addCpu");
    expect(cpus()).toHaveLength(1);
    await harness.startRace();
    await harness.leave(host);
    await harness.waitForDisposal();
  });
});

describe("quick match", () => {
  it("fills the lone racer's room when they press Ready (Race CPUs), and opens select", async () => {
    const racer = await harness.quickMatch("Kite");
    await harness.setReady(racer, true);
    expect(cpus()).toHaveLength(MAX_PLAYERS - 1);
    expect(race().phase).toBe("select");
  });

  it("fills the empty seats when the start clock runs out with two racers", async () => {
    await harness.quickMatch("Kite");
    await harness.quickMatch("Sable");
    await harness.advanceTicks(QUICK_MATCH_START_TICKS + 1);
    expect(cpus()).toHaveLength(MAX_PLAYERS - 2);
    expect(race().phase).toBe("select");
  });

  it("never races a lone racer without CPUs, even when company left after they readied", async () => {
    const first = await harness.quickMatch("Kite");
    const second = await harness.quickMatch("Sable");
    await harness.setReady(first, true);
    await harness.leave(second);
    // The ready racer waits out the search clock, then the room leaves the lobby.
    await harness.advanceTicks(QUICK_MATCH_START_TICKS);
    expect(race().phase).toBe("select");
    expect(cpus()).toHaveLength(MAX_PLAYERS - 1);
  });

  it("lets the CPUs go at Race again, so strangers can be matched in", async () => {
    const racer = await harness.quickMatch("Kite");
    await harness.startRace();
    expect(cpus()).toHaveLength(MAX_PLAYERS - 1);
    harness.room.finishForTest();
    racer.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(cpus()).toHaveLength(0);
    const stranger = await harness.quickMatch("Sable");
    expect(stranger.roomId).toBe(racer.roomId);
  });
});

describe("the race", () => {
  it("gives no CPU a pick in select", async () => {
    const host = await harness.create("Kite");
    await send(host, "addCpu");
    expect(cpus()).toHaveLength(1);
    await harness.setReady(host, true);
    expect(Object.keys(race().select!.picks)).toEqual([host.sessionPlayerId]);
  });

  it("drives every CPU up the course, and the replay re-simulates without drift", async () => {
    const host = await harness.create("Kite");
    for (let seat = 1; seat < MAX_PLAYERS; seat += 1) await send(host, "addCpu");
    expect(cpus()).toHaveLength(MAX_PLAYERS - 1);
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    for (const cpu of cpus()) expect(cpu.bestFloor, `${cpu.name} climbed`).toBeGreaterThan(0);

    const [bytes] = host.messages("replay") as Uint8Array[];
    const stepper = createReplayStepper(await unpackReplay(bytes!, zlibCompression));
    while (!stepper.done) {
      const { check } = stepper.step();
      if (check !== undefined) expect(check.actual).toBe(check.expected);
    }
    expect(stateHash(stepper.state)).toBe(stateHash(race()));
    stepper.dispose();
  });

  it("keeps a private room's CPUs, ready, at Race again", async () => {
    const host = await harness.create("Kite");
    await send(host, "addCpu");
    await harness.startRace();
    harness.room.finishForTest();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(cpus()).toHaveLength(1);
    expect(cpus()[0]!.ready).toBe(true);
  });
});
