// @vitest-environment node
/** The lava's model (lava spec §5): heat, surge, sinking, the marker and the sizzle's gate. */
import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { riseSpeed } from "@floor-fifty/shared/simulation/survival";
import {
  SIZZLE_INTERVAL_MS,
  SizzleGate,
  isSinking,
  lavaHeat,
  lavaMarkerFloors,
  lavaSurging,
} from "../../../../apps/client/src/features/race/lava-model";

const tuning = resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 });

describe("the lava's heat", () => {
  it("is the banded rise's share of the cap: cold at rest, full at the cap", () => {
    expect(lavaHeat(0, tuning)).toBe(0);
    expect(lavaHeat(55, tuning)).toBeCloseTo(55 / 150, 9);
    expect(lavaHeat(150, tuning)).toBe(1);
    expect(lavaHeat(400, tuning)).toBe(1);
  });
});

describe("a surge", () => {
  it("is an edge that moved more than the rise this frame", () => {
    const speed = riseSpeed(tuning.SURVIVAL_GRACE_TICKS + 10, tuning) * 1.5;
    const rise = speed / 60;
    expect(lavaSurging(100 + rise, 100, speed, 1 / 60)).toBe(false);
    expect(lavaSurging(100 + rise + 3, 100, speed, 1 / 60)).toBe(true);
  });

  it("is not a surge when the edge stands still or the frame took no time", () => {
    expect(lavaSurging(100, 100, 0, 1 / 60)).toBe(false);
    expect(lavaSurging(150, 100, 0, 0)).toBe(false);
  });
});

describe("sinking", () => {
  const half = tuning.PLAYER_HEIGHT / 2;
  it("is a body partly under the surface", () => {
    expect(isSinking(100 + half + 1, 100, tuning)).toBe(false);
    expect(isSinking(100 + half - 1, 100, tuning)).toBe(true);
    expect(isSinking(100 - half + 1, 100, tuning)).toBe(true);
  });

  it("is not a body wholly under it: that racer is out", () => {
    expect(isSinking(100 - half - 1, 100, tuning)).toBe(false);
  });
});

describe("the off-screen marker", () => {
  it("is hidden while the surface is in view", () => {
    expect(lavaMarkerFloors(1000, 700, 650, tuning)).toBeUndefined();
  });

  it("counts whole floors from the racer down to the surface, rounding up", () => {
    expect(lavaMarkerFloors(1000, 1000 - tuning.FLOOR_GAP_MAX * 2.2, 900, tuning)).toBe(3);
    expect(lavaMarkerFloors(1000, 1000 - tuning.FLOOR_GAP_MAX, 950, tuning)).toBe(1);
  });
});

describe("the sizzle's gate", () => {
  it("fires on a dip's leading edge, not while it lasts", () => {
    const gate = new SizzleGate();
    expect(gate.dip(true, 0)).toBe(true);
    expect(gate.dip(true, 16)).toBe(false);
    expect(gate.dip(true, 2_000)).toBe(false);
  });

  it("fires again for a new dip, at most every SIZZLE_INTERVAL_MS", () => {
    const gate = new SizzleGate();
    gate.dip(true, 0);
    gate.dip(false, 100);
    expect(gate.dip(true, 200)).toBe(false);
    gate.dip(false, 300);
    expect(gate.dip(true, SIZZLE_INTERVAL_MS + 1)).toBe(true);
  });
});
