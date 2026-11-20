import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * Audit S23: the server logged refusals for rate, sockets, origin, draining and
 * busy, and nothing for a join the room itself refused. After a release, a
 * version lock-out could not be told from mistyped codes. A refusal is logged
 * by its reason only: never an address, a name or a room code.
 */

let harness: ColyseusHarness;
let lines: string[] = [];
beforeEach(async () => {
  lines = [];
  harness = await createColyseusHarness(4182, { telemetry: { log: (line) => void lines.push(line) } });
});
afterEach(async () => {
  await harness.close();
});

const refusals = (): string[] =>
  lines.flatMap((line) => {
    try {
      const record = JSON.parse(line) as { event?: string; limit?: string };
      return record.event === "refused" ? [String(record.limit)] : [];
    } catch {
      return [];
    }
  });

describe("a join the room refuses (audit S23)", () => {
  it("logs rules that differ from the server's as ruleset", async () => {
    const host = await harness.create("Kite");
    // A named build, so this is not two development builds, which are judged on protocol alone.
    await expect(
      harness.joinById(host.roomId, "Ninja", { buildId: "201001010000-aaaaaaa", rulesetRevision: "not-this-one" }),
    ).rejects.toThrow();
    expect(refusals()).toEqual(["ruleset"]);
  });

  it("logs a join to a room already racing as closed", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await expect(harness.joinById(host.roomId, "Late")).rejects.toThrow();
    expect(refusals()).toEqual(["closed"]);
  });

  it("logs no name and no room code", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await expect(harness.joinById(host.roomId, "Latecomer")).rejects.toThrow();
    const text = lines.join("\n");
    expect(text).not.toContain("Latecomer");
    expect(text).not.toContain(host.roomId);
  });
});
