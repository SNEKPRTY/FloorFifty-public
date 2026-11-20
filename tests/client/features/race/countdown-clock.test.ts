// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { CountdownClock } from "../../../../apps/client/src/features/race/countdown-clock";
import { snapshotAt } from "../../support/snapshots";

const ENDS = 600;

function counting(): CountdownClock {
  const clock = new CountdownClock();
  clock.observe(snapshotAt(ENDS - 3 * TICK_HZ, { phase: "countdown", countdownEndsAtTick: ENDS }));
  return clock;
}

describe("the countdown clock", () => {
  it("shows each whole second's number against the authority tick", () => {
    const clock = counting();
    expect(clock.label(ENDS - 3 * TICK_HZ)).toBe("3");
    expect(clock.label(ENDS - 2 * TICK_HZ - 1)).toBe("3");
    expect(clock.label(ENDS - 2 * TICK_HZ)).toBe("2");
    expect(clock.label(ENDS - TICK_HZ)).toBe("1");
    expect(clock.label(ENDS - 1)).toBe("1");
  });

  it("shows GO from the end tick and clears it within 600 ms", () => {
    const clock = counting();
    expect(clock.label(ENDS)).toBe("GO");
    expect(clock.label(ENDS + 35)).toBe("GO");
    expect(clock.label(ENDS + 36)).toBeUndefined();
  });

  it("remembers the end tick once racing snapshots drop it", () => {
    const clock = counting();
    clock.observe(snapshotAt(ENDS + 1, { phase: "racing" }));
    expect(clock.label(ENDS + 1)).toBe("GO");
  });

  it("shows nothing for a race joined already running", () => {
    const clock = new CountdownClock();
    clock.observe(snapshotAt(900, { phase: "racing" }));
    expect(clock.label(900)).toBeUndefined();
  });

  it("shows nothing before a snapshot", () => {
    expect(counting().label(undefined)).toBeUndefined();
  });
});
