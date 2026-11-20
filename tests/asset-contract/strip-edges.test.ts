import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { bandRepeats, seamMismatch } from "@floor-fifty/asset-contract/validate-assets";

const png = (width: number, height: number, opaque: (x: number, y: number) => boolean): PNG => {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) out.data[(y * width + x) * 4 + 3] = opaque(x, y) ? 255 : 0;
  return out;
};

describe("a strip's seam", () => {
  it("is clean when the two edge columns agree", () => {
    expect(seamMismatch(png(8, 10, (_x, y) => y > 4))).toBe(0);
  });
  it("measures the rows where a building is cut at one edge only", () => {
    expect(seamMismatch(png(8, 10, (x, y) => y > 4 && (x < 7 || y > 7)))).toBeCloseTo(0.3, 5);
  });
});

describe("a sky plate's bands", () => {
  it("repeat when each edge band is two equal halves", () => {
    expect(bandRepeats(png(4, 40, (x, y) => (x + y) % 2 === 0))).toBe(true);
  });
  it("do not when the top band changes inside itself", () => {
    expect(bandRepeats(png(4, 40, (_x, y) => y === 3))).toBe(false);
  });
});
