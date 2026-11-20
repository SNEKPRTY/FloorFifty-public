/**
 * A build-time palette swap.
 *
 * Seat identity is the only difference between the four racers, so the poses
 * are generated once and recoloured rather than generated four times. Four
 * independent generations would give four different silhouettes for what is
 * mechanically the same character.
 *
 * Build-time rather than a runtime `sprite.tint`: a multiply produces colours
 * that are not swatches, and while palette-lock would fold them back on
 * screen, the shipped PNG is where `assets:check` enforces the contract. An
 * asset that is only on-palette after a shader is not on-palette.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { swatchRgb, type SwatchIndex } from "../src/swatches";

/**
 * Rewrites every opaque pixel of one swatch as another, in place.
 *
 * Exact match, never nearest: the input is already on-palette because it was
 * generated under `color_image`, so a near-miss means something upstream is
 * wrong and should fail the conformance gate rather than be quietly absorbed.
 *
 * Returns the number of pixels changed, so a caller can fail on zero -- a
 * recolour that matched nothing is a wrong `from` index, and it would
 * otherwise ship four identical sheets.
 */
export function recolourFile(path: string, from: SwatchIndex, to: SwatchIndex): number {
  const png = PNG.sync.read(readFileSync(path));
  const [fr, fg, fb] = swatchRgb(from);
  const [tr, tg, tb] = swatchRgb(to);
  let changed = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    if ((png.data[index + 3] ?? 0) === 0) continue;
    if (png.data[index] !== fr || png.data[index + 1] !== fg || png.data[index + 2] !== fb) continue;
    png.data[index] = tr;
    png.data[index + 1] = tg;
    png.data[index + 2] = tb;
    changed += 1;
  }

  writeFileSync(path, PNG.sync.write(png));
  return changed;
}
