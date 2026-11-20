/**
 * The sky plate's brightest colour, read once from its image (Wonder spec
 * §6.6): no sky flash may go past it. Read through a 2D canvas, which a test
 * environment may not have; then there is no ceiling to read, and the lock's
 * own clamp to white stands.
 */

import type { Texture } from "pixi.js";
import { brightestPixel } from "./filters/palette-lock";

/** The brightest colour in `texture`'s image, or undefined where it cannot be read. */
export function plateCeiling(texture: Texture | undefined): [number, number, number] | undefined {
  const image = texture?.source?.resource as CanvasImageSource | undefined;
  if (image === undefined || typeof document === "undefined") return undefined;
  const width = texture!.source.pixelWidth;
  const height = texture!.source.pixelHeight;
  if (width <= 0 || height <= 0) return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(image, 0, 0);
    return brightestPixel(context.getImageData(0, 0, width, height).data);
  } catch {
    return undefined;
  }
}
