/**
 * Atmospheric haze on the skylines.
 *
 * Two claims. A hazed texel is always a palette swatch, one step toward the
 * sky -- a tint would be folded straight back by the palette lock, which is why
 * haze is a dither at all. And the share of texels stepped is the authored
 * amount, laid out by the same ordered dither the sky uses, so the stipple is
 * fixed to the art rather than crawling.
 */

import { describe, expect, it } from "vitest";
import { ROLES, swatchRgb } from "@floor-fifty/asset-contract/palette";
import { hazePixels, hazeStep } from "../../../../apps/client/src/features/render/haze";

const rgb = (index: number): [number, number, number] => [...swatchRgb(index)] as [number, number, number];

/** A width x height plate of one swatch, opaque. */
function plate(width: number, height: number, colour: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data.set([...colour, 255], index);
  }
  return data;
}

describe("the haze step", () => {
  it("moves each skyline one swatch toward the sky, never onto itself", () => {
    for (const role of ["cityFar", "cityMid", "cityNear"] as const) {
      const from = rgb(ROLES[role]);
      const to = hazeStep(from);
      expect(to, role).not.toEqual(from);
      // Lighter: the sky is the lightest region, so a step toward it is up.
      const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      expect(luma(to), role).toBeGreaterThan(luma(from));
    }
  });
});

describe("hazing a plate", () => {
  it("steps the authored share of texels and leaves the rest", () => {
    const colour = rgb(ROLES.cityMid);
    const data = plate(8, 8, colour);

    hazePixels(data, 8, 0.25);

    let stepped = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] !== colour[0] || data[index + 1] !== colour[1] || data[index + 2] !== colour[2]) stepped += 1;
    }
    expect(stepped).toBe(16);
  });

  it("changes nothing at zero and leaves transparent texels alone", () => {
    const colour = rgb(ROLES.cityFar);
    const data = plate(4, 4, colour);
    data[3] = 0;
    const before = data.slice();

    hazePixels(data, 4, 0);
    expect(data).toEqual(before);

    hazePixels(data, 4, 1);
    expect([...data.slice(0, 4)]).toEqual([...before.slice(0, 4)]);
  });
});
