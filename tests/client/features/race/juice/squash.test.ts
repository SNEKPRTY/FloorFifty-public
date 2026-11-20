// @vitest-environment node
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { SquashBook } from "../../../../../apps/client/src/features/race/juice/squash";

const JUICE = GENERATED_CONTENT.content.juice;
const P1 = "p1" as PlayerId;

describe("SquashBook on a spring (Wonder spec §4.2)", () => {
  it("knocks x out and y in, then settles to 1 with a wobble, drawn on 1/32 steps", () => {
    const book = new SquashBook(() => JUICE.springs.squash);
    book.knock(P1, 0.25);
    expect(book.scaleOf(P1)).toEqual({ x: 1.25, y: 0.75 });
    const xs: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      book.update(1 / 60);
      xs.push(book.scaleOf(P1).x);
    }
    expect(Math.min(...xs)).toBeLessThan(1);
    expect(xs.at(-1)).toBe(1);
    for (const x of xs) expect((x * 32) % 1).toBeCloseTo(0, 6);
  });

  it("holds the frozen racer and settles everyone at once", () => {
    const book = new SquashBook(() => JUICE.springs.squash);
    book.knock(P1, 0.5);
    book.update(1 / 60, P1);
    expect(book.scaleOf(P1).x).toBe(1.5);
    book.settle();
    expect(book.scaleOf(P1)).toEqual({ x: 1, y: 1 });
  });

  it("holds a hammered squash at its amount: knocks never stack", () => {
    const book = new SquashBook(() => JUICE.springs.squash);
    for (let i = 0; i < 10; i += 1) {
      book.knock(P1, 0.5);
      book.update(1 / 60);
      expect(book.scaleOf(P1).x).toBeLessThanOrEqual(1.5);
    }
  });

  it("rests a racer it has never knocked", () => {
    expect(new SquashBook(() => JUICE.springs.squash).scaleOf(P1)).toEqual({ x: 1, y: 1 });
  });
});
