/**
 * The canvas's resolution: device pixels per CSS pixel.
 *
 * Sharp on high-density displays, without rendering at a fractional scale, so
 * the device's density is capped at a whole 2. A tablet held upright is the
 * exception. Its CSS area is about four times a phone's, so at 2x the backdrop
 * and the filter chain that runs at canvas resolution would fill ~3.9M device
 * pixels, which measured well over the frame budget (responsive parity plan,
 * Task 15). It draws at 1x instead. That is still whole-pixel, and the pixel
 * art comes from the fixed-resolution composite either way.
 *
 * A software renderer (`software-renderer.ts`) draws at half a device pixel per
 * CSS pixel everywhere: on the CPU every device pixel of every pass is paid
 * for, and the passes at canvas resolution (the bloom's eight blurs, the
 * panel) were most of a frame. The pixel art still comes from the composite.
 */

import type { FormFactor } from "./form-factor";

export const MAX_RESOLUTION = 2;

/** A software renderer's resolution: half a device pixel per CSS pixel. */
export const SOFTWARE_RESOLUTION = 0.5;

export function canvasResolutionFor(formFactor: FormFactor, devicePixelRatio: number, software = false): number {
  if (software) return SOFTWARE_RESOLUTION;
  if (formFactor === "tablet-portrait") return 1;
  return Math.min(devicePixelRatio || 1, MAX_RESOLUTION);
}
