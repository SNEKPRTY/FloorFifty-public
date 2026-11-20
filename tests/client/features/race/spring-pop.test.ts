import { describe, expect, it } from "vitest";
import { springPop } from "../../../../apps/client/src/features/race/spring-pop";

const SPRING = { f: 5, zeta: 0.4, r: 0 };

/** A frame scheduler the test steps by hand, 60 frames a second. */
function frames() {
  let queued: ((nowMs: number) => void) | undefined;
  let nowMs = 0;
  return {
    schedule: (callback: (nowMs: number) => void) => {
      queued = callback;
      return 1;
    },
    cancel: () => {
      queued = undefined;
    },
    step(): boolean {
      const callback = queued;
      queued = undefined;
      nowMs += 1000 / 60;
      callback?.(nowMs);
      return callback !== undefined;
    },
  };
}

const scaleOf = (node: HTMLElement): number => Number(/scale\(([\d.]+)\)/.exec(node.style.transform)?.[1] ?? "1");

describe("springPop (Wonder spec §4.2)", () => {
  it("knocks the node to the pop scale and settles it back through an overshoot, on 1/32 steps", () => {
    const node = document.createElement("span");
    const clock = frames();
    springPop(node, 1.25, SPRING, clock);
    expect(scaleOf(node)).toBe(1.25);
    const scales: number[] = [];
    while (clock.step()) scales.push(scaleOf(node));
    expect(Math.min(...scales)).toBeLessThan(1);
    for (const scale of scales) expect((scale * 32) % 1).toBeCloseTo(0, 6);
    expect(node.style.transform).toBe("");
  });

  it("re-knocks a node still settling, never past the pop scale", () => {
    const node = document.createElement("span");
    const clock = frames();
    springPop(node, 1.25, SPRING, clock);
    clock.step();
    springPop(node, 1.25, SPRING, clock);
    expect(scaleOf(node)).toBe(1.25);
    clock.step();
    expect(scaleOf(node)).toBeLessThanOrEqual(1.25);
  });

  it("stops when cancelled, and leaves the node at rest", () => {
    const node = document.createElement("span");
    const clock = frames();
    const stop = springPop(node, 1.25, SPRING, clock);
    clock.step();
    stop();
    expect(node.style.transform).toBe("");
    expect(clock.step()).toBe(false);
  });
});
