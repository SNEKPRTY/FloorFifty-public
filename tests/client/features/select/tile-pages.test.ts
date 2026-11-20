// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fitColumns, fitShape, pageOf, paginate, stackedSide, tileSide, trimRows, wrapPage, type TileItem } from "../../../../apps/client/src/features/select/tile-pages";

const item = (id: string): TileItem => ({ id, label: id, state: "open" });

describe("paginate", () => {
  it("puts one pack on a page, padding an unfilled page with empty slots", () => {
    const pages = paginate(
      [
        { packId: "base", title: "Base", items: [item("a"), item("b"), item("c")] },
        { packId: "friends", title: "Friends", items: [item("d")] },
      ],
      4,
    );
    expect(pages.map((page) => page.title)).toEqual(["Base", "Friends"]);
    expect(pages[0]!.slots.map((slot) => slot?.id)).toEqual(["a", "b", "c", undefined]);
    expect(pages[1]!.slots).toHaveLength(4);
  });

  it("continues a long pack under the same title with (2)", () => {
    const pages = paginate([{ packId: "base", title: "Base", items: ["a", "b", "c", "d", "e"].map(item) }], 3);
    expect(pages.map((page) => page.title)).toEqual(["Base", "Base (2)"]);
    expect(pages.every((page) => page.packId === "base")).toBe(true);
  });

  it("skips an empty pack", () => {
    expect(paginate([{ packId: "none", title: "None", items: [] }], 3)).toEqual([]);
  });
});

describe("fitShape", () => {
  it("keeps the most the box can hold", () => {
    expect(fitShape({ columns: 4, rows: 1 }, { width: 600, height: 200 }, 44, 8)).toEqual({ columns: 4, rows: 1 });
  });

  it("drops rows first, then columns, never below one", () => {
    expect(fitShape({ columns: 5, rows: 2 }, { width: 400, height: 60 }, 44, 8)).toEqual({ columns: 5, rows: 1 });
    expect(fitShape({ columns: 5, rows: 2 }, { width: 100, height: 60 }, 44, 8)).toEqual({ columns: 2, rows: 1 });
    expect(fitShape({ columns: 3, rows: 3 }, { width: 10, height: 10 }, 44, 8)).toEqual({ columns: 1, rows: 1 });
  });
});

describe("tileSide", () => {
  const limits = { peek: 0, min: 44, max: 128 };

  it("leaves room for the next page's peek", () => {
    // 3 tiles of 100 and two 8 px gaps, plus 0.35 of a tile peeking: 351.
    expect(tileSide({ columns: 3, rows: 1 }, { width: 351, height: Infinity }, 8, { ...limits, peek: 0.35 })).toBe(100);
  });

  it("sizes by width alone when the box sets no height", () => {
    expect(tileSide({ columns: 3, rows: 2 }, { width: 316, height: Infinity }, 8, limits)).toBe(100);
  });

  it("takes the tighter axis when the box has a height", () => {
    expect(tileSide({ columns: 3, rows: 2 }, { width: 316, height: 128 }, 8, limits)).toBe(60);
  });

  it("never grows past the largest tile or shrinks below a finger", () => {
    expect(tileSide({ columns: 3, rows: 1 }, { width: 2000, height: Infinity }, 8, limits)).toBe(128);
    expect(tileSide({ columns: 3, rows: 1 }, { width: 40, height: 20 }, 8, limits)).toBe(44);
  });
});

describe("trimRows", () => {
  const group = (count: number) => ({ packId: `p${count}`, title: "P", items: Array.from({ length: count }, (_, index) => item(`i${index}`)) });

  it("keeps no row that no pack can fill", () => {
    expect(trimRows({ columns: 3, rows: 2 }, [group(3), group(2)])).toEqual({ columns: 3, rows: 1 });
  });

  it("keeps the rows the largest pack needs, up to the shape's", () => {
    expect(trimRows({ columns: 3, rows: 2 }, [group(4)])).toEqual({ columns: 3, rows: 2 });
    expect(trimRows({ columns: 3, rows: 2 }, [group(9)])).toEqual({ columns: 3, rows: 2 });
  });

  it("never goes below one row", () => {
    expect(trimRows({ columns: 3, rows: 2 }, [])).toEqual({ columns: 3, rows: 1 });
  });
});

describe("stackedSide", () => {
  const item = (id: string): TileItem => ({ id, label: id, state: "open" });
  const base = { packId: "base", title: "Base", items: ["ninja", "frog", "diver"].map(item) };
  const friends = { packId: "friends", title: "Friends", items: ["robo", "kitsune"].map(item) };
  const limits = { titleRow: 28, min: 44, max: 128 };

  it("sizes chips to the width when every pack fits", () => {
    // Four across in 344 px with 8 px gaps: 80. Base holds ? and three chips
    // (one row), Friends two (one row): 2 x 28 + 2 x 80 + one 8 px gap
    // between the sections = 224, which 400 holds.
    expect(stackedSide([base, friends], 1, 4, { width: 344, height: 400 }, 8, limits)).toBe(80);
  });

  it("shrinks chips to the height when the width alone would overflow it", () => {
    // 2 x 28 + 8 + 2 x side <= 180, so side = 58.
    expect(stackedSide([base, friends], 1, 4, { width: 344, height: 180 }, 8, limits)).toBe(58);
  });

  it("refuses what does not fit at the smallest chip, so the roster pages instead", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ packId: `p${index}`, title: `P${index}`, items: ["a", "b", "c", "d", "e"].map(item) }));
    expect(stackedSide(many, 1, 4, { width: 344, height: 400 }, 8, limits)).toBeUndefined();
  });

  it("never grows a chip past the largest", () => {
    expect(stackedSide([base], 1, 4, { width: 2000, height: 2000 }, 8, limits)).toBe(128);
  });
});

describe("paging", () => {
  const pages = paginate([{ packId: "base", title: "Base", items: ["a", "b", "c", "d", "e"].map(item) }], 2);

  it("finds an item's page", () => {
    expect(pageOf(pages, "e")).toBe(2);
    expect(pageOf(pages, "zzz")).toBe(-1);
  });

  it("wraps from the last page to the first and back", () => {
    expect(wrapPage(3, 3)).toBe(0);
    expect(wrapPage(-1, 3)).toBe(2);
  });
});

describe("fitColumns", () => {
  const group = (n: number) => ({ packId: "base", title: "Base", items: Array.from({ length: n }, (_, i) => item(`c${i}`)) });

  it("cuts the columns to what the largest pack fills", () => {
    expect(fitColumns({ columns: 4, rows: 2 }, [group(5)])).toEqual({ columns: 3, rows: 2 });
  });

  it("never adds columns", () => {
    expect(fitColumns({ columns: 4, rows: 1 }, [group(9)])).toEqual({ columns: 4, rows: 1 });
  });

  it("keeps at least one column", () => {
    expect(fitColumns({ columns: 4, rows: 2 }, [])).toEqual({ columns: 1, rows: 2 });
  });
});
