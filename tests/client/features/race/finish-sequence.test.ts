// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EASE_MS, FinishSequence, HOLD_MS, SLOW_SCALE } from "../../../../apps/client/src/features/race/finish-sequence";

describe("the finish sequence", () => {
  it("eases to a quarter speed over 150 ms and holds it for 1.2 s", () => {
    const sequence = new FinishSequence(1_000, false);
    expect(sequence.scale(1_000)).toBe(1);
    expect(sequence.scale(1_000 + EASE_MS / 2)).toBeCloseTo(1 - (1 - SLOW_SCALE) / 2, 6);
    expect(sequence.scale(1_000 + EASE_MS)).toBe(SLOW_SCALE);
    expect(sequence.scale(1_000 + EASE_MS + HOLD_MS - 1)).toBe(SLOW_SCALE);
    expect(sequence.done(1_000 + EASE_MS + HOLD_MS - 1)).toBe(false);
    expect(sequence.done(1_000 + EASE_MS + HOLD_MS)).toBe(true);
  });

  it("does not slow under reduced motion, and keeps the 1.2 s hold", () => {
    const sequence = new FinishSequence(0, true);
    expect(sequence.scale(500)).toBe(1);
    expect(sequence.done(HOLD_MS - 1)).toBe(false);
    expect(sequence.done(HOLD_MS)).toBe(true);
  });
});
