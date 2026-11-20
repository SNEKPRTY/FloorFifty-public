/**
 * How much of an asset could not have been drawn by hand.
 *
 * A person working in pixels picks a resolution, and every feature they draw
 * is at least one of those pixels across in both directions. A generator does
 * not: it produces an illustration, the conversion samples it, and features
 * land at arbitrary offsets and arbitrary sizes -- including sizes below the
 * art's own pixel. That is the thing the eye reads as machine-made without
 * being able to name, and it is measurable.
 *
 * The measure is the share of opaque pixels that survive no 2x2 square of
 * their own colour. A pixel with three same-coloured neighbours forming a
 * square is part of a shape at least two pixels thick; a pixel with none is a
 * spur, a speck, or a single-pixel line. Call it the grain.
 *
 * Grain is not a defect on its own. A 32-pixel character's eyes are one pixel,
 * a nine-slice frame's border is one pixel, and an ordered dither is one pixel
 * everywhere by construction -- all three are deliberate, and all three would
 * be destroyed by simplifying them. So the contract does not forbid grain; it
 * requires every asset to declare how much it is entitled to, which is what
 * turns "remember to run the pass" into something a build can check.
 */

import { PNG } from "pngjs";

/**
 * The default budget, for anything that does not ask for more.
 *
 * Two percent rather than zero. A converted plate that has been through the
 * simplification passes measures 0.00%, so this is not a tolerance the passes
 * need -- it is headroom for a code-drawn asset whose corners round off, and
 * it is tight enough that an asset which skipped the passes entirely lands
 * an order of magnitude above it.
 */
export const DEFAULT_MAX_GRAIN = 0.02;

/**
 * The share of opaque pixels belonging to no 2x2 block of their own colour.
 *
 * Zero for an empty image: nothing drawn is nothing wrong.
 */
export function measureGrain(png: PNG): { grain: number; opaque: number } {
  const { width, height, data } = png;

  // Each pixel's colour packed into one integer, -1 where it is transparent:
  // the squares below compare these, so no pixel is read or keyed twice.
  const colour = new Int32Array(width * height);
  for (let p = 0, i = 0; p < colour.length; p += 1, i += 4) {
    colour[p] = data[i + 3] === 0 ? -1 : (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
  }

  /** Whether the 2x2 square with top-left (x, y) lies inside the image and is all `self`. */
  const solid = (x: number, y: number, self: number): boolean => {
    if (x < 0 || y < 0 || x + 1 >= width || y + 1 >= height) return false;
    const p = y * width + x;
    return colour[p] === self && colour[p + 1] === self && colour[p + width] === self && colour[p + width + 1] === self;
  };

  let opaque = 0;
  let grainy = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const self = colour[y * width + x]!;
      if (self === -1) continue;
      opaque += 1;

      // Every 2x2 square that contains this pixel, not just the one anchored
      // at it: a pixel on a shape's right edge belongs to the square to its
      // left, and testing one corner would call every such pixel grain.
      const covered = solid(x, y, self) || solid(x - 1, y, self) || solid(x, y - 1, self) || solid(x - 1, y - 1, self);
      if (!covered) grainy += 1;
    }
  }

  return { grain: opaque === 0 ? 0 : grainy / opaque, opaque };
}
