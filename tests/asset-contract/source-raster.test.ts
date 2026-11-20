/**
 * The dithered gradient quantizer.
 *
 * A painted sky is a gradient between swatches the palette does not have, and
 * snapping each pixel to its nearest swatch bands it. Stippling between the
 * two ends of a gradient the art is allowed to run along keeps the average
 * colour, which is what the eye reads at a distance.
 */

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { roleHex } from "@floor-fifty/asset-contract/roles";
import { quantizeDithered } from "../../packages/asset-contract/tools/source-raster";

const rgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** An 8 x 8 plate of one colour, optionally with its first pixel transparent. */
function flat(colour: readonly [number, number, number], hole = false): PNG {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = colour[0];
    png.data[i + 1] = colour[1];
    png.data[i + 2] = colour[2];
    png.data[i + 3] = 255;
  }
  if (hole) png.data[3] = 0;
  return png;
}

const census = (png: PNG): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const hex = `#${[0, 1, 2].map((k) => png.data[i + k]!.toString(16).padStart(2, "0")).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return counts;
};

describe("quantizeDithered", () => {
  const a = roleHex("outline");
  const b = roleHex("uiText");

  it("stipples a colour halfway along a gradient as an even mix of its two ends", () => {
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    const png = flat([Math.round((ar + br) / 2), Math.round((ag + bg) / 2), Math.round((ab + bb) / 2)]);

    quantizeDithered(png, [["outline", "uiText"]]);

    const counts = census(png);
    expect([...counts.keys()].sort()).toEqual([a, b].sort());
    expect(Math.abs(counts.get(a)! - counts.get(b)!)).toBeLessThanOrEqual(8);
  });

  it("leaves a colour that is already a swatch solid", () => {
    const png = flat(rgb(b));
    quantizeDithered(png, [["outline", "uiText"]]);
    expect([...census(png).keys()]).toEqual([b]);
  });

  it("mixes only along the gradients it is given", () => {
    // Halfway between outline and uiText, but only uiMuted-uiText is a gradient:
    // the result is drawn from that pair's swatches and nothing else.
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    const png = flat([Math.round((ar + br) / 2), Math.round((ag + bg) / 2), Math.round((ab + bb) / 2)]);
    quantizeDithered(png, [["uiMuted", "uiText"]]);
    for (const colour of census(png).keys()) expect([roleHex("uiMuted"), b]).toContain(colour);
  });

  it("stipples in cells of the size it is given, so the pattern sits on the art's pixel grid", () => {
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    const png = flat([Math.round((ar + br) / 2), Math.round((ag + bg) / 2), Math.round((ab + bb) / 2)]);
    quantizeDithered(png, [["outline", "uiText"]], 2);

    const at = (x: number, y: number): number => png.data[(y * 8 + x) * 4]!;
    for (let y = 0; y < 8; y += 2)
      for (let x = 0; x < 8; x += 2)
        expect(new Set([at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)]).size).toBe(1);
    expect(census(png).size).toBe(2);
  });

  it("stipples only the middle of a gradient when given a narrow spread, and paints the rest solid", () => {
    // A quarter of the way from outline to uiText: inside a 0.3 spread's flat
    // end, so solid outline, not a quarter-stipple.
    const [ar, ag, ab] = rgb(a);
    const [br, bg, bb] = rgb(b);
    const quarter = (from: number, to: number): number => Math.round(from + (to - from) * 0.25);
    const png = flat([quarter(ar, br), quarter(ag, bg), quarter(ab, bb)]);
    quantizeDithered(png, [["outline", "uiText"]], 1, 0.3);
    expect([...census(png).keys()]).toEqual([a]);

    // Halfway is still an even mix.
    const half = flat([Math.round((ar + br) / 2), Math.round((ag + bg) / 2), Math.round((ab + bb) / 2)]);
    quantizeDithered(half, [["outline", "uiText"]], 1, 0.3);
    expect([...census(half).keys()].sort()).toEqual([a, b].sort());
  });

  it("leaves transparent pixels alone", () => {
    const png = flat(rgb(b), true);
    quantizeDithered(png, [["outline", "uiText"]]);
    expect(png.data[3]).toBe(0);
  });
});
