// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RESURRECT64, swatchRgb } from "@floor-fifty/asset-contract/swatches";
import {
  CELL_SLOTS,
  CELL_TEXELS,
  CELLS_PER_AXIS,
  CELL_TEXTURE,
  NO_CANDIDATE,
  cellCandidates,
  cellOf,
  paletteCellTable,
} from "../../../../../apps/client/src/features/render/filters/palette-cells";

/** Unit channels, as the shader sees them. */
const SWATCHES = RESURRECT64.map((_, index) => swatchRgb(index).map((channel) => channel / 255) as [number, number, number]);

const distance = (colour: readonly number[], swatch: readonly number[]): number =>
  2 * (colour[0]! - swatch[0]!) ** 2 + 4 * (colour[1]! - swatch[1]!) ** 2 + 3 * (colour[2]! - swatch[2]!) ** 2;

/** The lock's full search: the first swatch strictly nearer than every earlier one. */
const fullSearch = (colour: readonly number[]): number => {
  let best = -1;
  let bestDistance = 1e9;
  SWATCHES.forEach((swatch, index) => {
    const d = distance(colour, swatch);
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
};

/** The same search over a cell's candidates only, in the order the table lists them. */
const cellSearch = (table: Uint8Array, colour: readonly number[]): number => {
  let best = -1;
  let bestDistance = 1e9;
  for (const index of cellCandidates(table, cellOf(colour))) {
    const d = distance(colour, SWATCHES[index]!);
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  }
  return best;
};

describe("the palette lock's cell table", () => {
  const table = paletteCellTable(SWATCHES);

  it("is one RGBA texel row-major per three slots, opaque, sized to its texture", () => {
    expect(table).toHaveLength(CELL_TEXTURE.width * CELL_TEXTURE.height * 4);
    expect(CELL_TEXTURE.width * CELL_TEXTURE.height).toBe(CELLS_PER_AXIS ** 3 * CELL_TEXELS);
    expect(CELL_SLOTS).toBe(CELL_TEXELS * 3);
    // Alpha is 255 everywhere, so an upload that premultiplies changes nothing.
    for (let alpha = 3; alpha < table.length; alpha += 4) expect(table[alpha]).toBe(255);
  });

  it("lists each cell's candidates in palette order, ended by the sentinel or the last slot", () => {
    for (let cell = 0; cell < CELLS_PER_AXIS ** 3; cell += 1) {
      const candidates = cellCandidates(table, cell);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(CELL_SLOTS);
      expect([...candidates].sort((a, b) => a - b)).toEqual(candidates);
      for (const index of candidates) expect(index).toBeLessThan(NO_CANDIDATE);
    }
  });

  it("finds the full search's swatch for every 8-bit colour on a 4-step grid", () => {
    // 64^3 colours, every cell many times over and every cell boundary on the
    // 8-bit lattice hit, against the search the shader replaces.
    let checked = 0;
    for (let r = 0; r < 256; r += 4) {
      for (let g = 0; g < 256; g += 4) {
        for (let b = 0; b < 256; b += 4) {
          const colour = [r / 255, g / 255, b / 255];
          if (cellSearch(table, colour) !== fullSearch(colour)) throw new Error(`differs at ${r},${g},${b}`);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(64 ** 3);
  });

  it("finds it for off-lattice colours too, a tinted mood's and a blend's, up to the cube's margin", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 200_000; i += 1) {
      // Slightly past the cube on purpose: the table covers a margin, and the
      // shader takes the full search beyond it.
      const colour = [random() * 1.0018 - 0.0009, random() * 1.0018 - 0.0009, random() * 1.0018 - 0.0009];
      if (cellSearch(table, colour) !== fullSearch(colour)) throw new Error(`differs at ${colour.join(",")}`);
    }
  });

  it("includes a swatch that ties for nearest wherever it can tie", () => {
    // Midpoints between pairs of swatches are where two can be equidistant;
    // the full search keeps the lower index there, so the table must hold it.
    for (let a = 0; a < SWATCHES.length; a += 1) {
      for (let b = a + 1; b < SWATCHES.length; b += 1) {
        const mid = SWATCHES[a]!.map((channel, c) => (channel + SWATCHES[b]![c]!) / 2);
        expect(cellSearch(table, mid)).toBe(fullSearch(mid));
      }
    }
  });

  it("maps a colour to its cell, clamping the margin past either face", () => {
    expect(cellOf([0, 0, 0])).toBe(0);
    expect(cellOf([1, 1, 1])).toBe(CELLS_PER_AXIS ** 3 - 1);
    expect(cellOf([-0.0005, 1.0005, 0])).toBe(cellOf([0, 1, 0]));
    expect(cellOf([1 / CELLS_PER_AXIS, 0, 0])).toBe(CELLS_PER_AXIS ** 2);
  });
});
