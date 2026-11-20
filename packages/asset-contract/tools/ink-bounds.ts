/**
 * The bounding box of what is actually drawn.
 *
 * The frame is padding; the character is the ink. Every size rule in the brief
 * is about the second, so measuring the first would let a generous frame pass
 * a sprite that is far too small inside it.
 *
 * Threshold rather than `> 0`: PixelLab returns a handful of nearly
 * transparent pixels at the silhouette edge, and counting those as ink moves
 * the measured height by a pixel or two in a band that has little room.
 */

import type { PNG } from "pngjs";

const OPAQUE_ENOUGH = 8;

export type InkBounds = { top: number; bottom: number; left: number; right: number };

/** Null when nothing is drawn at all, which is a defect rather than a zero. */
export function inkBounds(png: PNG): InkBounds | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = -1;
  let left = Number.POSITIVE_INFINITY;
  let right = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if ((png.data[(y * png.width + x) * 4 + 3] ?? 0) <= OPAQUE_ENOUGH) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  return bottom < 0 ? null : { top, bottom, left, right };
}

/** Zero when nothing is drawn. */
export function inkHeight(png: PNG): number {
  const bounds = inkBounds(png);
  return bounds === null ? 0 : bounds.bottom - bounds.top + 1;
}
