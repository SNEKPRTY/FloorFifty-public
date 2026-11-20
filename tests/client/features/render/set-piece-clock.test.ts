// @vitest-environment node
import type { SetPieceContent } from "@floor-fifty/shared/content/game-content";
import { describe, expect, it } from "vitest";
import { SetPieceClock, climbFloor } from "../../../../apps/client/src/features/render/set-piece-clock";

const PIECES: SetPieceContent[] = [
  { floor: 10, kind: "lightsOut", holdMs: 1000 },
  { floor: 45, kind: "skyFlash", holdMs: 2000, flashes: 1, tone: "lightning" },
  { floor: 45, kind: "paletteShift", holdMs: 3000, mood: "storm" },
];

describe("climbFloor (Wonder spec §6.5)", () => {
  it("counts the laps already climbed, since a lap starts again at the bottom", () => {
    expect(climbFloor(1, 20, 10 * 128, 128)).toBe(10);
    expect(climbFloor(3, 20, 10 * 128, 128)).toBe(50); // two full ladders below, ten floors up the third
    expect(climbFloor(2, 20, -64, 128)).toBe(20); // never below the laps done
  });
});

describe("SetPieceClock (Wonder spec §6.5)", () => {
  it("plays a set piece when the camera reaches its floor in a 50-floor race", () => {
    const clock = new SetPieceClock(PIECES);
    expect(clock.update(0, 9.9, 50).started).toBeUndefined();
    expect(clock.update(16, 10, 50).started?.floor).toBe(10);
  });

  it("scales the arc to a 20-floor race: floor 45 plays at floor 18", () => {
    const clock = new SetPieceClock(PIECES);
    expect(clock.update(0, 4, 20).started?.floor).toBe(10);
    expect(clock.update(5_000, 17.9, 20).started).toBeUndefined();
    expect(clock.update(5_016, 18, 20).started?.floor).toBe(45);
  });

  it("plays the arc once across three laps of twenty", () => {
    const clock = new SetPieceClock(PIECES);
    expect(clock.update(0, 11.9, 60).started).toBeUndefined();
    expect(clock.update(16, 12, 60).started?.floor).toBe(10);
  });

  it("plays a floor's pieces together, holding for the longest", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, 50);
    const started = clock.update(2_000, 45, 50).started!;
    expect(started.pieces.map((piece) => piece.kind).sort()).toEqual(["paletteShift", "skyFlash"]);
    expect(started.holdMs).toBe(3000);
  });

  it("never overlaps: a group due while another holds waits for it to end", () => {
    const clock = new SetPieceClock([
      { floor: 10, kind: "lightsOut", holdMs: 1000 },
      { floor: 11, kind: "paletteShift", holdMs: 1000, mood: "night" },
    ]);
    clock.update(0, 10, 50);
    expect(clock.update(100, 11, 50).started).toBeUndefined();
    const out = clock.update(1_001, 11, 50);
    expect(out.ended?.floor).toBe(10);
    expect(out.started?.floor).toBe(11);
  });

  it("skips groups the camera climbed past while another held, playing the latest due (audit)", () => {
    const clock = new SetPieceClock([
      { floor: 10, kind: "lightsOut", holdMs: 1000 },
      { floor: 11, kind: "paletteShift", holdMs: 1000, mood: "night" },
      { floor: 12, kind: "paletteShift", holdMs: 1000, mood: "day" },
    ]);
    expect(clock.update(0, 10, 50).started?.floor).toBe(10);
    expect(clock.update(100, 30, 50).started).toBeUndefined(); // 11 and 12 come due while 10 holds
    expect(clock.update(1_001, 30, 50).started?.floor).toBe(12); // 11 is skipped
    expect(clock.update(2_002, 30, 50).started).toBeUndefined();
  });

  it("scales a group's hold to the race: a 20-floor race holds for two fifths (audit)", () => {
    const clock = new SetPieceClock([{ floor: 10, kind: "paletteShift", holdMs: 10_000, mood: "storm" }]);
    const started = clock.update(0, 4, 20)!.started!;
    expect(started.holdScale).toBeCloseTo(0.4, 6);
    expect(clock.update(3_999, 4, 20).ended).toBeUndefined();
    expect(clock.update(4_000, 4, 20).ended?.floor).toBe(10);
  });

  it("holds the authored time in a 50-floor race and in Infinite", () => {
    expect(new SetPieceClock(PIECES).update(0, 10, 50).started!.holdScale).toBe(1);
    expect(new SetPieceClock(PIECES).update(0, 10, undefined).started!.holdScale).toBe(1);
  });

  it("a fall does not replay a set piece", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, 50);
    clock.update(2_000, 5, 50);
    expect(clock.update(4_000, 10, 50).started).toBeUndefined();
  });

  it("repeats the arc every 50 floors in Infinite", () => {
    const clock = new SetPieceClock(PIECES);
    expect(clock.update(0, 10, undefined).started).toMatchObject({ floor: 10, pass: 0 });
    clock.update(2_000, 30, undefined);
    expect(clock.update(4_000, 60, undefined).started).toMatchObject({ floor: 10, pass: 1 });
  });

  it("a fall back across a 50-floor boundary in Infinite replays nothing", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, undefined); // pass 0, floor 10
    clock.update(2_000, 60, undefined); // pass 1, floor 10
    clock.update(4_000, 30, undefined); // fell back into pass 0
    expect(clock.update(6_000, 30, undefined).started).toBeUndefined();
    expect(clock.update(8_000, 61, undefined).started).toBeUndefined(); // pass 1 again: its floor 10 already played
    expect(clock.update(10_000, 110, undefined).started).toMatchObject({ floor: 10, pass: 2 });
  });

  it("forgets every pass on reset", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, 50);
    clock.reset();
    expect(clock.update(16, 10, 50).started?.floor).toBe(10);
  });

  it("reports the active group until it ends", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, 50);
    expect(clock.active?.floor).toBe(10);
    expect(clock.update(1_000, 10, 50).ended?.floor).toBe(10);
    expect(clock.active).toBeUndefined();
  });

  it("forces a group for the gate, ending any that holds", () => {
    const clock = new SetPieceClock(PIECES);
    clock.update(0, 10, 50);
    const forced = clock.force(45, 100)!;
    expect(forced.pieces).toHaveLength(2);
    expect(clock.active?.floor).toBe(45);
    expect(clock.force(33, 200)).toBeUndefined();
  });

  it("plays nothing for a stage with none", () => {
    expect(new SetPieceClock([]).update(0, 50, 50).started).toBeUndefined();
  });
});
