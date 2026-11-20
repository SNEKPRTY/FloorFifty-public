import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createColyseusHarness, type ColyseusHarness } from "./colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("advanceTicks", () => {
  // The harness promises that a test reading a client's copy of the state sees
  // what the room has just done: "a forced patch keeps a test from asserting
  // against state the wire has not carried yet". A long batch is where that
  // promise is hardest to keep. The room sends a patch every third tick, so a
  // client has hundreds of messages to read when the batch ends, and the last
  // of them can still be on its way when the harness returns. A test that read
  // `host.state` straight after such a batch passed or failed on how quickly
  // the machine moved bytes between two sockets -- not on the date, and not on
  // what the room did.
  //
  // Whether the tail has arrived is down to timing, so one batch only fails
  // some of the time. Many batches in a row make the unfixed harness fail
  // reliably, and cost the fixed one nothing.
  it("returns only once a connected client's copy has caught up with the room", async () => {
    const host = await harness.create("Kite");

    for (let batch = 0; batch < 10; batch += 1) {
      await harness.advanceTicks(1_800);

      expect(host.state.tick, `after batch ${batch + 1}`).toBe(harness.room.state.tick);
    }
  });
});
