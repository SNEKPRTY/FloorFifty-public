// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collapseLevel } from "../../../../../apps/client/src/features/kit/layout/action-bar";
import { reservedRows, rowsBelow } from "../../../../../apps/client/src/features/kit/layout/scroll-list";
import { pagerMode } from "../../../../../apps/client/src/features/kit/layout/pager";
import { splitMode } from "../../../../../apps/client/src/features/kit/layout/split";

describe("collapseLevel (UI layout system §5, ActionBar)", () => {
  // The one-row widths at levels 0 (all labels), 1 (utilities icon-only) and 2 (secondaries short).
  const widths = [500, 450, 400] as const;

  it.each([
    [600, 0],
    [500, 0],
    [499, 1],
    [450, 1],
    [449, 2],
    [400, 2],
    [399, 3],
    [0, 3],
  ] as const)("at %i px it is level %i", (available, level) => {
    expect(collapseLevel(available, widths)).toBe(level);
  });

  it("never skips a level a narrower row would have fitted", () => {
    // A bar whose utilities have no icon measures the same at levels 0 and 1.
    expect(collapseLevel(480, [480, 480, 300])).toBe(0);
    expect(collapseLevel(479, [480, 480, 300])).toBe(2);
  });
});

describe("ScrollList's arithmetic (UI layout system §5)", () => {
  it("reserves the rows it asks for, or every row when there are fewer", () => {
    expect(reservedRows(4, 10)).toBe(4);
    expect(reservedRows(4, 2)).toBe(2);
    expect(reservedRows(0, 3)).toBe(0);
  });

  it.each([
    // the view's foot (scrollTop + clientHeight), each row's foot, hidden
    [120, [40, 80, 120, 160, 200], 2],
    [130, [40, 80, 120, 160, 200], 2], // a row cut by the edge is a hidden row
    [160, [40, 80, 120, 160, 200], 1],
    [200, [40, 80, 120, 160, 200], 0],
    [400, [40, 80, 120, 160, 200], 0],
    [120, [0, 0, 0, 0, 0], 0], // not laid out yet (jsdom, or before the first frame)
  ] as const)("a view ending at %i over rows ending at %j hides %i", (view, bottoms, hidden) => {
    expect(rowsBelow(view, bottoms)).toBe(hidden);
  });

  it("counts by where each row ends, so a taller first row and the gaps between rows hide nothing", () => {
    // A 290 px list of a 78 px row (your badges) and three 60 px rows, 8 px apart.
    expect(rowsBelow(290, [78, 146, 214, 282])).toBe(0);
    expect(rowsBelow(220, [78, 146, 214, 282])).toBe(1);
  });

  it("reserves only the rows a lone racer has, and hides none", () => {
    expect(reservedRows(4, 1)).toBe(1);
    expect(rowsBelow(40, [40])).toBe(0);
    expect(rowsBelow(160, [40])).toBe(0);
  });
});

describe("pagerMode (UI layout system §5, PagerDots)", () => {
  it.each([
    [8, 9, Infinity, 44, "dots"],
    [9, 9, Infinity, 44, "dots"],
    [10, 9, Infinity, 44, "counter"],
    [4, 9, 200, 44, "dots"], // 176 px of dots in 200
    [5, 9, 200, 44, "counter"], // 220 px would wrap
  ] as const)("%i pages, max %i, in %f px of %i px dots: %s", (count, max, available, dot, mode) => {
    expect(pagerMode(count, max, available, dot)).toBe(mode);
  });

  it("defaults to nine dots of 44 px with unlimited room", () => {
    expect(pagerMode(9)).toBe("dots");
    expect(pagerMode(10)).toBe("counter");
  });
});

describe("splitMode (UI layout system §5, Split)", () => {
  it.each([
    [700, 300, 16, "row"],
    [616, 300, 16, "row"],
    [615, 300, 16, "stack"],
    [0, 300, 16, "stack"],
  ] as const)("%i px for two %i px columns and a %i px gap: %s", (available, min, gap, mode) => {
    expect(splitMode(available, min, gap)).toBe(mode);
  });
});
