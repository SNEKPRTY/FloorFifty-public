import { describe, expect, it } from "vitest";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { SnapshotBuffer } from "../../../../apps/client/src/features/net/snapshot-buffer";
import { REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

describe("remote interpolation", () => {
  it("interpolates a remote player between two snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { x: 0 } }));
    buffer.push(snapshotAt(13, { player: { x: 30 } }));
    expect(buffer.sample(11.5).players[0]?.x).toBeCloseTo(15);
  });

  it("interpolates vertically as well as horizontally", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { y: 100 } }));
    buffer.push(snapshotAt(13, { player: { y: 400 } }));
    expect(buffer.sample(12).players[0]?.y).toBeCloseTo(300);
  });

  it("holds at the newest snapshot rather than extrapolating past it", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { x: 0 } }));
    buffer.push(snapshotAt(13, { player: { x: 30 } }));
    expect(buffer.sample(99).players[0]?.x).toBe(30);
  });

  it("holds at the oldest snapshot before the buffer starts", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { x: 7 } }));
    buffer.push(snapshotAt(13, { player: { x: 30 } }));
    expect(buffer.sample(2).players[0]?.x).toBe(7);
  });

  it("never moves a remote player backward when a stale snapshot arrives late", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { x: 0 } }));
    buffer.push(snapshotAt(13, { player: { x: 30 } }));
    buffer.push(snapshotAt(11, { player: { x: 500 } }));
    expect(buffer.sample(13).players[0]?.x).toBe(30);
    expect(buffer.latest()?.tick).toBe(13);
  });

  it("snaps rather than sliding across the screen when a player wraps", () => {
    const buffer = new SnapshotBuffer();
    const half = VIEWPORT.width / 2;
    buffer.push(snapshotAt(10, { player: { x: half - 2 } }));
    buffer.push(snapshotAt(13, { player: { x: -half + 2 } }));
    // Interpolating this pair would drag the player back across the whole
    // viewport; the wrap is a teleport in logical space and must read as one.
    expect(buffer.sample(11.5).players[0]?.x).toBe(-half + 2);
  });

  it("takes discrete state from the older snapshot rather than the future", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10, { player: { lap: 1, progress: 0.5 } }));
    buffer.push(snapshotAt(13, { player: { lap: 2, progress: 0 } }));
    expect(buffer.sample(11).players[0]).toMatchObject({ lap: 1, progress: 0.5 });
  });

  it("keeps a player who is only in the newer snapshot", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(10));
    buffer.push(
      snapshotAt(13, {
        players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Ninja 2", x: 50 })],
      }),
    );
    expect(buffer.sample(11.5).players).toHaveLength(2);
  });

  it("discards snapshots that have aged out of the window", () => {
    const buffer = new SnapshotBuffer();
    for (let tick = 0; tick <= 600; tick += 3) buffer.push(snapshotAt(tick));
    expect(buffer.size).toBeLessThan(60);
    expect(buffer.latest()?.tick).toBe(600);
  });
});
