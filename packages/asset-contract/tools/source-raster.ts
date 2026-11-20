/**
 * Shared steps for turning a generated source into a palette-locked raster.
 *
 * Lifted out of `generate-city.ts` unchanged, so the portrait tool (and any
 * later plate tool) keys, crops and quantises exactly the way the city does.
 */

import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../src/roles";
import { swatchRgb } from "../src/swatches";

/** The chroma key the sources are drawn on, and how far a pixel may stray. */
export const KEY = [255, 0, 255] as const;
export const KEY_TOLERANCE = 100;

export const isKey = (r: number, g: number, b: number): boolean =>
  Math.abs(r - KEY[0]) + Math.abs(g - KEY[1]) + Math.abs(b - KEY[2]) < KEY_TOLERANCE;

/** The tightest box containing everything that is not the chroma key. */
export function contentBounds(png: PNG): { top: number; bottom: number } {
  let top = png.height;
  let bottom = 0;
  // A row counts as drawn only once enough of it is. The encoder leaves a few
  // stray non-key pixels along the top edge, and a single one of those would
  // otherwise anchor the crop to row zero and leave the city sitting in the
  // bottom third of a plate that is mostly empty.
  const MINIMUM_RUN = 24;

  for (let y = 0; y < png.height; y += 1) {
    let drawn = 0;
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 3] === 0 || isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!)) continue;
      drawn += 1;
    }
    if (drawn < MINIMUM_RUN) continue;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { top, bottom };
}

/**
 * Box-filter resample of a keyed region into the target size.
 *
 * Coverage is averaged alongside colour so a half-covered edge pixel comes out
 * half transparent rather than either solid or gone; the threshold below then
 * decides it. Averaging the key itself would bleed magenta into every edge, so
 * keyed pixels contribute to coverage and to nothing else.
 */
export function resample(png: PNG, top: number, bottom: number, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  const regionHeight = bottom - top + 1;
  const sx = png.width / width;
  const sy = regionHeight / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = top + Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, top + Math.floor((y + 1) * sy));

      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      let total = 0;

      for (let sourceY = y0; sourceY < y1 && sourceY <= bottom; sourceY += 1) {
        for (let sourceX = x0; sourceX < x1 && sourceX < png.width; sourceX += 1) {
          const i = (sourceY * png.width + sourceX) * 4;
          total += 1;
          const [sr, sg, sb] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
          if (png.data[i + 3] === 0 || isKey(sr, sg, sb)) continue;
          r += sr;
          g += sg;
          b += sb;
          covered += 1;
        }
      }

      const o = (y * width + x) * 4;
      if (covered === 0 || covered * 2 < total) {
        out.data[o + 3] = 0;
        continue;
      }
      out.data[o] = Math.round(r / covered);
      out.data[o + 1] = Math.round(g / covered);
      out.data[o + 2] = Math.round(b / covered);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** Maps every opaque pixel onto the ramp swatch nearest it, weighted as the lock weighs. */
export function quantizeNearest(png: PNG, ramp: readonly RoleName[]): void {
  const swatches = ramp.map((role) => swatchRgb(ROLES[role]));
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    let best = swatches[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const swatch of swatches) {
      const distance =
        2 * (png.data[i]! - swatch[0]) ** 2 +
        4 * (png.data[i + 1]! - swatch[1]) ** 2 +
        3 * (png.data[i + 2]! - swatch[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = swatch;
      }
    }
    png.data[i] = best[0];
    png.data[i + 1] = best[1];
    png.data[i + 2] = best[2];
  }
}

/** 4 x 4 ordered-dither thresholds, 0..15. */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/**
 * Maps every opaque pixel onto a stipple of two swatches: the ends of the
 * gradient in `gradients` it lies closest to, mixed in proportion to where it
 * falls between them.
 *
 * For a painted sky, whose colours sit between the palette's swatches: nearest
 * swatch bands a gradient, and this keeps its average colour. Only the given
 * pairs are mixed, so two unrelated hues never stipple into a grey that neither
 * the art nor the palette meant. Distances are weighted as the lock weighs.
 *
 * `cell` is the stipple's pixel size. Each cell is averaged and decided once,
 * so a two-pixel cell puts the pattern on the same grid as the plates and the
 * racers drawn in front of it, rather than a one-pixel checker finer than
 * anything else on screen.
 *
 * `spread` is the share of each gradient that stipples, centred on its middle;
 * the rest paints solid in the nearer end. Below one, the plate is broad flat
 * bands with dithered seams, as the race's own sky is -- a field stippled
 * edge to edge is the same pitch as the LCD panel's mesh and buries it, and
 * gives the refraction nothing to bend.
 */
export function quantizeDithered(
  png: PNG,
  gradients: readonly (readonly [RoleName, RoleName])[],
  cell = 1,
  spread = 1,
): void {
  const weights = [2, 4, 3] as const;
  const pairs = gradients.map(([from, to]) => [swatchRgb(ROLES[from]), swatchRgb(ROLES[to])] as const);

  /** The swatch a colour at dither threshold `threshold` (0..15) lands on. */
  const choose = (pixel: readonly number[], threshold: number): readonly [number, number, number] => {
    let chosen: readonly [number, number, number] = pairs[0]![0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [a, b] of pairs) {
      // Where the colour projects onto the segment a -> b, in weighted space.
      let dot = 0;
      let length = 0;
      for (let k = 0; k < 3; k += 1) {
        dot += weights[k]! * (pixel[k]! - a[k]!) * (b[k]! - a[k]!);
        length += weights[k]! * (b[k]! - a[k]!) ** 2;
      }
      const t = length === 0 ? 0 : Math.min(1, Math.max(0, dot / length));
      let distance = 0;
      for (let k = 0; k < 3; k += 1) distance += weights[k]! * (pixel[k]! - (a[k]! + (b[k]! - a[k]!) * t)) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        const share = Math.min(1, Math.max(0, (t - 0.5) / spread + 0.5));
        chosen = share * 16 > threshold + 0.5 ? b : a;
      }
    }
    return chosen;
  };

  for (let cy = 0; cy < png.height; cy += cell) {
    for (let cx = 0; cx < png.width; cx += cell) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = cy; y < Math.min(png.height, cy + cell); y += 1) {
        for (let x = cx; x < Math.min(png.width, cx + cell); x += 1) {
          const i = (y * png.width + x) * 4;
          if (png.data[i + 3] === 0) continue;
          for (let k = 0; k < 3; k += 1) sum[k]! += png.data[i + k]!;
          count += 1;
        }
      }
      if (count === 0) continue;
      const chosen = choose(
        sum.map((channel) => channel / count),
        BAYER_4[(cy / cell) % 4]![(cx / cell) % 4]!,
      );
      for (let y = cy; y < Math.min(png.height, cy + cell); y += 1) {
        for (let x = cx; x < Math.min(png.width, cx + cell); x += 1) {
          const i = (y * png.width + x) * 4;
          if (png.data[i + 3] === 0) continue;
          png.data[i] = chosen[0];
          png.data[i + 1] = chosen[1];
          png.data[i + 2] = chosen[2];
        }
      }
    }
  }
}

/** A copy of one rectangle of `png`. */
export function crop(png: PNG, x: number, y: number, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * png.width + x) * 4;
    png.data.copy(out.data, row * width * 4, from, from + width * 4);
  }
  return out;
}

/** Maps every opaque pixel onto the nearest of `colours`, weighted as the lock weighs. */
export function quantizeToColours(png: PNG, colours: readonly (readonly [number, number, number])[]): void {
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    let best = colours[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const colour of colours) {
      const distance =
        2 * (png.data[i]! - colour[0]) ** 2 +
        4 * (png.data[i + 1]! - colour[1]) ** 2 +
        3 * (png.data[i + 2]! - colour[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = colour;
      }
    }
    png.data[i] = best[0];
    png.data[i + 1] = best[1];
    png.data[i + 2] = best[2];
  }
}

export type Box = { x: number; y: number; width: number; height: number };

export const drawn = (png: PNG, x: number, y: number): boolean => {
  const i = (y * png.width + x) * 4;
  return png.data[i + 3] !== 0 && !isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
};

/** The tightest box round everything that is not the key, inside `within`. */
export function contentBox(png: PNG, within: Box): Box {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = -1;
  let bottom = -1;
  for (let y = within.y; y < within.y + within.height; y += 1) {
    for (let x = within.x; x < within.x + within.width; x += 1) {
      if (!drawn(png, x, y)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error(`no content inside ${JSON.stringify(within)}`);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
