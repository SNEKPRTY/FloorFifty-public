// @vitest-environment node
/**
 * Nameplate de-stacking.
 *
 * Four racers in one spot used to draw four names in a tower of seat lanes.
 * The rule now: the local player's plate always shows, and every other racer
 * in a cluster is folded into one chip that counts the whole cluster. A
 * grouping only changes after it has held for a short dwell, so plates do not
 * flap as racers brush past each other.
 */

import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import {
  DECLUTTER_HOLD_MS,
  NAMEPLATE_CLUSTER,
  NameplateDeclutter,
  clusterPlates,
} from "../../../../apps/client/src/features/race/nameplate-declutter";

const [A, B, C, D] = ["a", "b", "c", "d"].map((id) => asPlayerId(id)) as [
  ReturnType<typeof asPlayerId>,
  ReturnType<typeof asPlayerId>,
  ReturnType<typeof asPlayerId>,
  ReturnType<typeof asPlayerId>,
];

const together = [
  { id: A, x: 100, y: 200 },
  { id: B, x: 104, y: 202 },
  { id: C, x: 98, y: 199 },
  { id: D, x: 101, y: 205 },
];
const apart = together.map((site, index) => ({ ...site, x: site.x + index * 200 }));

describe("clustering nameplates", () => {
  it("folds four racers in one plate's bounds into one chip beside the local plate", () => {
    const result = clusterPlates(together, A);

    expect([...result.hidden].sort()).toEqual([B, C, D].sort());
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]!.count).toBe(4);
  });

  it("folds a cluster without the local player into one chip and hides every plate in it", () => {
    const result = clusterPlates(together.slice(1), A);

    expect(result.hidden.size).toBe(3);
    expect(result.chips[0]!.count).toBe(3);
  });

  it("leaves racers apart alone", () => {
    const result = clusterPlates(apart, A);

    expect(result.hidden.size).toBe(0);
    expect(result.chips).toEqual([]);
  });

  it("clusters by the plate's bounds, not by exact position", () => {
    const edge = [
      { id: A, x: 0, y: 0 },
      { id: B, x: NAMEPLATE_CLUSTER.width - 1, y: 0 },
    ];
    expect(clusterPlates(edge, A).chips).toHaveLength(1);
    expect(clusterPlates([edge[0]!, { ...edge[1]!, x: NAMEPLATE_CLUSTER.width + 1 }], A).chips).toEqual([]);
  });
});

describe("the dwell before a grouping changes", () => {
  it("waits for a new grouping to hold before showing it", () => {
    const declutter = new NameplateDeclutter();
    declutter.update(apart, A, 16);

    expect(declutter.update(together, A, DECLUTTER_HOLD_MS / 2).chips).toEqual([]);
    expect(declutter.update(together, A, DECLUTTER_HOLD_MS / 2).chips).toHaveLength(1);
  });

  it("does not flap when racers brush past for less than the dwell", () => {
    const declutter = new NameplateDeclutter();
    declutter.update(together, A, DECLUTTER_HOLD_MS);
    declutter.update(together, A, DECLUTTER_HOLD_MS);

    // Apart for a moment, then back together: the chip never went away.
    expect(declutter.update(apart, A, DECLUTTER_HOLD_MS / 3).chips).toHaveLength(1);
    expect(declutter.update(together, A, DECLUTTER_HOLD_MS / 3).chips).toHaveLength(1);
    expect(declutter.update(apart, A, DECLUTTER_HOLD_MS / 3).chips).toHaveLength(1);
  });

  it("follows the cluster as it moves while the grouping holds", () => {
    const declutter = new NameplateDeclutter();
    declutter.update(together, A, DECLUTTER_HOLD_MS);
    declutter.update(together, A, DECLUTTER_HOLD_MS);
    const moved = together.map((site) => ({ ...site, x: site.x + 30 }));

    const chip = declutter.update(moved, A, 16).chips[0]!;
    expect(chip.x).toBeCloseTo(100.75 + 30);
  });
});
