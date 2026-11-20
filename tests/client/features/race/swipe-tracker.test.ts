// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SwipeTracker, type SwipeAction } from "../../../../apps/client/src/features/race/swipe-tracker";

const rig = () => {
  let clock = 0;
  const held = new Set<SwipeAction>();
  const pulses: SwipeAction[] = [];
  const tracker = new SwipeTracker(
    (action, active) => {
      if (active) {
        held.add(action);
        pulses.push(action);
      } else held.delete(action);
    },
    () => clock,
  );
  return { tracker, held, pulses, at: (ms: number) => (clock = ms) };
};

describe("floating-anchor steering", () => {
  it("does nothing inside the 12 px dead zone", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.move(1, 111, 500);
    expect(held.size).toBe(0);
  });

  it("steers once the thumb is 12 px from where it landed", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.move(1, 112, 500);
    expect([...held]).toEqual(["right"]);
  });

  it("drags the anchor behind the thumb, so reversing always costs the same short move", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.move(1, 400, 500);                       // anchor trails to 352
    tracker.move(1, 341, 500);                       // 11 px left of the anchor: dead zone
    expect(held.size).toBe(0);
    tracker.move(1, 340, 500);                       // 12 px left: steering left
    expect([...held]).toEqual(["left"]);
  });

  it("releases steering when the finger lifts", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.move(1, 150, 500);
    tracker.up(1);
    expect(held.size).toBe(0);
  });
});

describe("flick to fast-fall", () => {
  it("pulses fast-fall for 40 px down inside 180 ms", () => {
    const { tracker, pulses, held, at } = rig();
    at(0);
    tracker.down(1, 100, 500);
    at(120);
    tracker.move(1, 100, 541);
    expect(pulses).toContain("fastFall");
    expect(held.has("fastFall")).toBe(false);       // a pulse; the InputManager latch carries it
  });

  it("ignores a slow drag down", () => {
    const { tracker, pulses, at } = rig();
    at(0);
    tracker.down(1, 100, 500);
    at(300);
    tracker.move(1, 100, 560);
    expect(pulses).not.toContain("fastFall");
  });
});

// Owner, 2026-10-10: any downward flick slams, wherever it starts on the screen. Steering stays
// with a finger that lands in the lower half (the thumbs' half), so a finger that lands higher up
// may flick but never steers.
describe("a finger that may not steer", () => {
  it("still fast-falls on a flick", () => {
    const { tracker, pulses, at } = rig();
    at(0);
    tracker.down(1, 100, 100, { steers: false });
    at(120);
    tracker.move(1, 100, 141);
    expect(pulses).toContain("fastFall");
  });

  it("never steers, and leaves steering to the next finger in the lower half", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 100, { steers: false });
    tracker.move(1, 200, 100);
    expect(held.size).toBe(0);
    tracker.down(2, 300, 600);
    tracker.move(2, 340, 600);
    expect([...held]).toEqual(["right"]);
  });
});

describe("two thumbs", () => {
  it("fast-falls from a second finger while the first holds its steer", () => {
    const { tracker, held, pulses, at } = rig();
    at(0);
    tracker.down(1, 100, 500);
    tracker.move(1, 150, 500);
    at(900);
    tracker.down(2, 300, 500);
    at(1000);
    tracker.move(2, 300, 545);
    expect(pulses).toContain("fastFall");
    expect([...held]).toEqual(["right"]);
    tracker.up(2);
    expect([...held]).toEqual(["right"]);
  });

  it("never steers from the second finger", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.down(2, 300, 500);
    tracker.move(2, 380, 500);
    expect(held.size).toBe(0);
  });

  it("no longer restarts on a two-finger tap", () => {
    const { tracker, pulses, at } = rig();
    at(0);
    tracker.down(1, 100, 500);
    at(40);
    tracker.down(2, 300, 500);
    at(150);
    tracker.up(1);
    tracker.up(2);
    expect(pulses).toEqual([]);
  });
});

describe("cancel", () => {
  it("releases everything", () => {
    const { tracker, held } = rig();
    tracker.down(1, 100, 500);
    tracker.move(1, 150, 500);
    tracker.cancel();
    expect(held.size).toBe(0);
    expect(tracker.indicator).toBeUndefined();
  });
});
