import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { WINDOW_CODE_STEPS, codeWindows } from "../../../../apps/client/src/features/render/window-code";

const window = roleTint("cityWindow");
const KEY = [(window >> 16) & 0xff, (window >> 8) & 0xff, window & 0xff] as const;
const WALL = [50, 51, 83] as const;

/** A plate from rows of characters: `#` is a lit window pixel, anything else wall. */
function plate(rows: readonly string[]): { data: Uint8ClampedArray; width: number; height: number } {
  const width = rows[0]!.length;
  const height = rows.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      const colour = cell === "#" ? KEY : WALL;
      data.set([...colour, 255], (y * width + x) * 4);
    }),
  );
  return { data, width, height };
}

const codeAt = (p: ReturnType<typeof plate>, x: number, y: number): string => {
  const i = (y * p.width + x) * 4;
  return `${p.data[i + 1]},${p.data[i + 2]}`;
};

describe("window codes", () => {
  it("codes a window split by a mullion as one window", () => {
    const p = plate([
      "........",
      ".###.###",
      ".###.###",
      "........",
    ]);
    expect(codeWindows(p.data, p.width, p.height, KEY)).toBe(1);
    expect(codeAt(p, 1, 1)).toBe(codeAt(p, 7, 2));
  });

  it("keeps neighbouring windows apart", () => {
    const p = plate([
      "##...##...##...##...##...##",
      "##...##...##...##...##...##",
    ]);
    expect(codeWindows(p.data, p.width, p.height, KEY)).toBe(6);
    // Six windows, and at least two different codes among them: a code that
    // every window shared would make the whole city breathe as one.
    const codes = new Set([0, 5, 10, 15, 20, 25].map((x) => codeAt(p, x, 0)));
    expect(codes.size).toBeGreaterThan(1);
  });

  it("codes the same window the same way every time", () => {
    const rows = ["....", ".##.", ".##.", "...."];
    const a = plate(rows);
    const b = plate(rows);
    codeWindows(a.data, a.width, a.height, KEY);
    codeWindows(b.data, b.width, b.height, KEY);
    expect([...a.data]).toEqual([...b.data]);
  });

  it("stays close enough to the window colour that the shader still keys on it", () => {
    const p = plate(["#"]);
    codeWindows(p.data, p.width, p.height, KEY);
    const nudge = Math.hypot(p.data[1]! - KEY[1], p.data[2]! - KEY[2]) / 255;
    expect(nudge).toBeLessThan(0.08);
    expect(p.data[1]! - KEY[1]).toBeLessThan(WINDOW_CODE_STEPS);
    expect(p.data[2]! - KEY[2]).toBeLessThan(WINDOW_CODE_STEPS);
    // Red and alpha never move.
    expect(p.data[0]).toBe(KEY[0]);
    expect(p.data[3]).toBe(255);
  });

  it("leaves everything that is not a window alone", () => {
    const p = plate(["..", ".."]);
    const before = [...p.data];
    expect(codeWindows(p.data, p.width, p.height, KEY)).toBe(0);
    expect([...p.data]).toEqual(before);
  });

  it("finds the near city's windows one by one, spread across the codes", () => {
    const png = PNG.sync.read(
      readFileSync(
        resolve(process.cwd(), "packages/asset-contract/assets/production/world-city-near.png"),
      ),
    );
    const data = new Uint8ClampedArray(png.data);
    const windows = codeWindows(data, png.width, png.height, KEY);
    // Measured: 152 windows since the powdery finish (stage ascent) merged
    // mullioned panes and dropped the smallest -- there were 373 blobs before,
    // and the board's own notes ask for fewer windows than it drew. Still
    // well over a hundred, so the codes have plenty to spread across.
    expect(windows).toBeGreaterThan(120);
    expect(windows).toBeLessThanOrEqual(373);

    const codes = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === KEY[0] && data[i + 3]! > 0 && Math.abs(data[i + 1]! - KEY[1]) < WINDOW_CODE_STEPS) {
        codes.add((data[i + 1]! - KEY[1]) * WINDOW_CODE_STEPS + (data[i + 2]! - KEY[2]));
      }
    }
    expect(codes.size).toBeGreaterThan(48);
  });
});
