import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * Audit S13 (found on 5 October as A03): a reload mid-race could leave the old
 * direction held. The input queue's last sequence survived the drop and the
 * reconnect did not reset it, while the reloaded client numbers on from the
 * sequence its racer acknowledged. Its first frames were refused, and the held
 * direction kept applying.
 */

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const frame = (sequence: number, tick: number, right: boolean) => ({
  sequence,
  tick,
  left: false,
  right,
  fastFall: false,
  reset: false,
});

/** A twenty-floor race, which a still racer does not lose, with the host racing. */
const startRace = async () => {
  const host = await harness.create("Kite");
  host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
  await harness.advanceTicks(1);
  await harness.startRace();
  return host;
};

describe("a reload in the middle of a race (audit S13)", () => {
  it("accepts the reloaded page's first frame, numbered from what its racer acknowledged", async () => {
    const host = await startRace();
    const token = host.reconnectionToken;
    const tick = harness.room.raceState.tick;
    // Held right, and stamped ahead: accepted, and not yet in force when the page drops.
    for (let sequence = 1; sequence <= 5; sequence += 1) host.send("input", frame(sequence, tick + 20, true));
    await harness.advanceTicks(1);
    await harness.drop(host);
    const reloaded = await harness.reconnect(token);
    await harness.advanceTicks(1);
    const acked = reloaded.state.players.get(reloaded.sessionPlayerId)!.lastAckedSequence;

    reloaded.send("input", frame(acked + 1, harness.room.raceState.tick + 1, false));
    await harness.advanceTicks(3);

    expect(reloaded.state.players.get(reloaded.sessionPlayerId)!.lastAckedSequence).toBe(acked + 1);
  });

  it("does not keep pushing in the direction the dropped page was holding", async () => {
    const host = await startRace();
    const token = host.reconnectionToken;
    const tick = harness.room.raceState.tick;
    for (let sequence = 1; sequence <= 5; sequence += 1) host.send("input", frame(sequence, tick + 20, true));
    await harness.advanceTicks(1);
    await harness.drop(host);
    const reloaded = await harness.reconnect(token);

    await harness.advanceTicks(90);

    const racer = reloaded.state.players.get(reloaded.sessionPlayerId)!;
    expect(racer.vx).toBe(0);
  });
});
