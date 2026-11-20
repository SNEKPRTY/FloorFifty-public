/**
 * Atmospheric haze for the skylines (launch polish spec, phase 1).
 *
 * The accepted board reads depth by value: the far city pale and blue, the
 * middle skyline a step darker, the near rooftops darkest. A further layer is
 * hazed toward the sky it stands in front of.
 *
 * A tint cannot draw that here. Every scenery pixel is folded onto the 64
 * swatches by the city's palette lock, so a smooth mix toward the sky either
 * lands back on its own swatch or jumps the whole layer onto its neighbour's.
 * Haze is therefore a dither: a share of each layer's texels -- the authored
 * amount -- is stepped one swatch toward the sky, laid out by the same 4 x 4
 * Bayer table the sky dithers with. Every result is a swatch, so the lock
 * leaves it alone, and the stipple is baked into the texels once at mount, so
 * it is fixed to the art rather than crawling across it as the layer scrolls.
 * Nothing here blurs.
 */

import { Texture } from "pixi.js";
import { nearestSwatch, swatchRgb } from "@floor-fifty/asset-contract/palette";
import { roleTint } from "@floor-fifty/asset-contract/roles";

type Rgb = readonly [number, number, number];

/** The colour a hazed layer steps toward: the sky overhead. */
const HAZE_TOWARD: Rgb = (() => {
  const tint = roleTint("skyHigh");
  return [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff] as const;
})();

/**
 * The 4 x 4 ordered-dither thresholds, in `[0, 1)`.
 *
 * The same table `filters/dither-sky.ts` draws the sky with, so the skyline's
 * stipple and the sky's are one texture rather than two.
 */
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => value / 16);

const steps = new Map<number, Rgb>();

/**
 * The first swatch, walking from `colour` toward the sky, that is not the
 * swatch `colour` already is.
 *
 * Walked in tenths so the step is the *nearest* distinct swatch in that
 * direction, not the sky itself: a far skyline stepped straight to the sky
 * colour would read as holes, not as air.
 */
export function hazeStep(colour: Rgb): Rgb {
  const key = (colour[0] << 16) | (colour[1] << 8) | colour[2];
  const cached = steps.get(key);
  if (cached !== undefined) return cached;

  const own = nearestSwatch(colour[0], colour[1], colour[2]);
  let step: Rgb = HAZE_TOWARD;
  for (let tenth = 1; tenth <= 10; tenth += 1) {
    const t = tenth / 10;
    const mixed = [0, 1, 2].map((channel) => colour[channel]! + (HAZE_TOWARD[channel]! - colour[channel]!) * t);
    const swatch = nearestSwatch(mixed[0]!, mixed[1]!, mixed[2]!);
    if (swatch !== own) {
      step = swatchRgb(swatch);
      break;
    }
  }
  steps.set(key, step);
  return step;
}

/**
 * Hazes RGBA texels in place: every opaque texel whose dither threshold falls
 * under `amount` is stepped one swatch toward the sky.
 *
 * `amount` is the share of texels stepped, so 0 changes nothing and 1 steps
 * every one. Transparent texels are sky already and are left alone.
 */
export function hazePixels(data: Uint8ClampedArray, width: number, amount: number): void {
  if (amount <= 0) return;
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index + 3] ?? 0) === 0) continue;
    const texel = index / 4;
    const x = texel % width;
    const y = Math.floor(texel / width);
    if ((BAYER_4X4[(x % 4) + (y % 4) * 4] ?? 1) >= amount) continue;
    const [r, g, b] = hazeStep([data[index]!, data[index + 1]!, data[index + 2]!]);
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }
}

/**
 * A hazed copy of `texture`, or `undefined` where there is nothing to do or no
 * way to do it.
 *
 * `undefined` for a zero amount, and for any texture whose pixels cannot be
 * read back -- no 2D canvas (a test environment), or a resource that is not an
 * image. The caller keeps the original then: an unhazed skyline is a flatter
 * picture, not a broken one. The copy is the caller's to destroy.
 */
export function hazedTexture(texture: Texture, amount: number): Texture | undefined {
  if (amount <= 0) return undefined;
  return rewrittenTexture(texture, (data, width) => hazePixels(data, width, amount));
}

/**
 * A nearest-sampled copy of `texture` with its pixels passed through `rewrite`.
 *
 * `undefined` wherever the pixels cannot be read back, for the reasons
 * `hazedTexture` gives. The copy is the caller's to destroy.
 */
export function rewrittenTexture(
  texture: Texture,
  rewrite: (data: Uint8ClampedArray, width: number, height: number) => void,
): Texture | undefined {
  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (resource === undefined || typeof document === "undefined") return undefined;

  const { x, y, width, height } = texture.frame;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return undefined;
  }
  if (context === null) return undefined;

  try {
    context.drawImage(resource, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    rewrite(pixels.data, width, height);
    context.putImageData(pixels, 0, 0);
  } catch {
    // A resource the canvas will not draw or read (tainted, or not an image).
    return undefined;
  }

  const rewritten = Texture.from(canvas);
  rewritten.source.scaleMode = "nearest";
  return rewritten;
}
