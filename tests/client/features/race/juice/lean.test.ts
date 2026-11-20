// @vitest-environment node
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { LeanBook, leanTarget } from "../../../../../apps/client/src/features/race/juice/lean";

const JUICE = GENERATED_CONTENT.content.juice;
const DEG = Math.PI / 180;
const P1 = "p1" as PlayerId;

describe("lean (Wonder spec §4.1)", () => {
  it("leans with the motion, up to the cap", () => {
    // A negative skew.x leans the top of the sprite to the right.
    expect(leanTarget(356, JUICE.lean)).toBeCloseTo(-12 * DEG, 6);
    expect(leanTarget(-356, JUICE.lean)).toBeCloseTo(12 * DEG, 6);
    expect(leanTarget(178, JUICE.lean)).toBeCloseTo(-6 * DEG, 6);
    expect(leanTarget(5000, JUICE.lean)).toBeCloseTo(-12 * DEG, 6);
  });

  it("draws on whole lean steps, and comes back upright when the racer stops", () => {
    const book = new LeanBook();
    for (let i = 0; i < 60; i += 1) book.update([{ id: P1, vx: 356 }], 1 / 60, JUICE);
    expect(Math.abs(book.drawnOf(P1) / (3 * DEG)) % 1).toBeCloseTo(0, 6);
    expect(book.drawnOf(P1)).toBeLessThan(0);
    for (let i = 0; i < 180; i += 1) book.update([{ id: P1, vx: 0 }], 1 / 60, JUICE);
    expect(book.drawnOf(P1)).toBe(0);
  });

  it("swings through upright to the far side on a turn", () => {
    const book = new LeanBook();
    for (let i = 0; i < 60; i += 1) book.update([{ id: P1, vx: 356 }], 1 / 60, JUICE);
    const drawn: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      book.update([{ id: P1, vx: -356 }], 1 / 60, JUICE);
      drawn.push(book.drawnOf(P1));
    }
    expect(Math.max(...drawn)).toBeGreaterThan(12 * DEG - 1e-9);
  });

  it("a mashed turn stays within the cap", () => {
    const book = new LeanBook();
    for (let i = 0; i < 240; i += 1) {
      book.update([{ id: P1, vx: i % 2 === 0 ? 356 : -356 }], 1 / 60, JUICE);
      expect(Math.abs(book.drawnOf(P1))).toBeLessThanOrEqual(12 * DEG * 1.25 + 1e-9);
    }
  });

  it("holds a frozen racer's lean", () => {
    const book = new LeanBook();
    for (let i = 0; i < 30; i += 1) book.update([{ id: P1, vx: 356 }], 1 / 60, JUICE);
    const held = book.drawnOf(P1);
    book.update([{ id: P1, vx: -356 }], 1 / 60, JUICE, P1);
    expect(book.drawnOf(P1)).toBe(held);
  });

  it("settles every racer upright at once", () => {
    const book = new LeanBook();
    for (let i = 0; i < 30; i += 1) book.update([{ id: P1, vx: 356 }], 1 / 60, JUICE);
    book.settle();
    expect(book.drawnOf(P1)).toBe(0);
  });

  it("never draws past a quarter over the cap, however low the damping is tuned", () => {
    const loose = { ...JUICE, springs: { ...JUICE.springs, lean: { f: 6, zeta: 0.05, r: 2 } } };
    const book = new LeanBook();
    for (let i = 0; i < 240; i += 1) {
      book.update([{ id: P1, vx: i % 30 < 15 ? 356 : -356 }], 1 / 60, loose);
      expect(Math.abs(book.drawnOf(P1))).toBeLessThanOrEqual(12 * DEG * 1.25 + 1e-9);
    }
  });
});
