import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { describe, expect, it } from "vitest";
import { MotionWatch, type DrawnRacer } from "../../../../../apps/client/src/features/race/juice/motion-watch";

// The simulation is y-up: rising is vy > 0, and FAST_FALL_VELOCITY is -1341.
const REST = 268.2 * 0.05;
const SLAM = 0.6 * 1341;
const r = (vy: number, x = 0, y = 100, id = "p1"): DrawnRacer => ({ id: id as PlayerId, x, y, vy });

describe("MotionWatch", () => {
  it("hears a bounce once per reversal from falling to rising", () => {
    const watch = new MotionWatch(REST);
    expect(watch.observe([r(-200)], 1, SLAM)).toEqual([]);
    expect(watch.observe([r(-210)], 2, SLAM)).toEqual([]);
    expect(watch.observe([r(268)], 3, SLAM).map((m) => m.kind)).toEqual(["bounce"]);
    expect(watch.observe([r(250)], 4, SLAM)).toEqual([]);
  });

  it("ignores speeds inside the rest band, so a racer standing still never bounces", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-5)], 1, SLAM);
    watch.observe([r(-5)], 2, SLAM);
    expect(watch.observe([r(5)], 3, SLAM)).toEqual([]);
  });

  it("never hears a bounce on a racer's first frame", () => {
    const watch = new MotionWatch(REST);
    expect(watch.observe([r(268)], 1, SLAM)).toEqual([]);
  });

  it("calls a bounce a slam only when the fall had reached the threshold", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-100)], 1, SLAM);
    watch.observe([r(-700)], 2, SLAM);
    expect(watch.observe([r(268)], 3, SLAM)[0]!.kind).toBe("bounce");
    watch.observe([r(-900)], 4, SLAM);
    watch.observe([r(-1341)], 5, SLAM);
    expect(watch.observe([r(268)], 6, SLAM)[0]!.kind).toBe("slam");
  });

  it("starts each fall's peak afresh, so one slam does not make the next bounce a slam", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-100)], 1, SLAM);
    watch.observe([r(-1341)], 2, SLAM);
    expect(watch.observe([r(268)], 3, SLAM)[0]!.kind).toBe("slam");
    watch.observe([r(-200)], 4, SLAM);
    expect(watch.observe([r(268)], 5, SLAM)[0]!.kind).toBe("bounce");
  });

  it("hears every racer separately", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-200, 0, 0, "p1"), r(-200, 0, 0, "p2")], 1, SLAM);
    watch.observe([r(-200, 0, 0, "p1"), r(-200, 0, 0, "p2")], 2, SLAM);
    const moments = watch.observe([r(268, 0, 0, "p1"), r(-100, 0, 0, "p2")], 3, SLAM);
    expect(moments.map((m) => m.playerId)).toEqual(["p1"]);
  });

  it("hears a wrap when drawn x jumps across the seam", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(100, 470)], 1, SLAM);
    expect(watch.observe([r(100, -470)], 2, SLAM)).toEqual([
      expect.objectContaining({ kind: "wrap", fromX: 470, x: -470 }),
    ]);
  });

  it("does not call an ordinary run across the middle a wrap", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(100, 20)], 1, SLAM);
    expect(watch.observe([r(100, -20)], 2, SLAM)).toEqual([]);
  });

  it("a wrap and a bounce on one frame are both heard, at the drawn x", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-300, 475)], 1, SLAM);
    const moments = watch.observe([r(268, -476)], 2, SLAM);
    expect(moments.map((m) => m.kind).sort()).toEqual(["bounce", "wrap"]);
    expect(moments.find((m) => m.kind === "bounce")!.x).toBe(-476);
  });

  it("keys each moment by racer, kind and tick, so a repeated frame is the same moment", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-200)], 7, SLAM);
    expect(watch.observe([r(268)], 8, SLAM)[0]!.key).toBe("p1:bounce:8");
  });

  it("forgets a racer who left, so one who rejoins starts clean", () => {
    const watch = new MotionWatch(REST);
    watch.observe([r(-200)], 1, SLAM);
    watch.forget("p1" as PlayerId);
    expect(watch.observe([r(268)], 2, SLAM)).toEqual([]);
  });
});
