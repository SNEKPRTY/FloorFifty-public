import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

describe("server room default mode", () => {
  let harness: ColyseusHarness;

  beforeEach(async () => {
    harness = await createColyseusHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("initializes a fresh RaceRoom with 'infinite' as default mode", async () => {
    const client = await harness.create("Kite");
    await client.waitForNextPatch();
    expect(client.state.modeId).toBe("infinite");
  });
});
