/**
 * Window codes.
 *
 * Every lit window in a city plate carries its own identity in its pixels, so
 * the atmosphere shader can give each window a brightness and a rhythm of its
 * own. Baked once at mount, into a copy of the texture.
 *
 * Why in the pixels rather than in a lookup the shader reads by position. The
 * city scrolls and tiles and parallaxes, and a filter's idea of where a pixel
 * is depends on how the pass is nested -- so a window keyed by where it sits
 * on screen changes identity as it moves, and reads as shimmer. A code carried
 * by the texel moves with the window through anything that draws it.
 *
 * The code is a nudge to the green and blue channels of up to
 * `WINDOW_CODE_STEPS - 1` levels each: at most 0.04 from the window colour in
 * unit RGB, inside the 0.08 the shader keys on, and folded back onto the
 * window swatch by any palette lock the shader does not run in front of.
 */

import type { Texture } from "pixi.js";
import { rewrittenTexture } from "./haze";

/** Levels per coded channel. Two channels, so 64 distinct windows. */
export const WINDOW_CODE_STEPS = 8;

/**
 * How far apart two window pixels may be and still be one window, in texels.
 *
 * Two: a mullion is one texel of wall, so the panes either side of it are two
 * apart and stay one window. Neighbouring windows in the art are five or more
 * apart, so they stay two.
 */
const WINDOW_REACH = 2;

type Rgb = readonly [number, number, number];

/** A small integer hash, so the code depends only on where a window is. */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374_761_393) + Math.imul(y, 668_265_263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Codes every window in `data` in place, and returns how many there were.
 *
 * A window is a group of pixels exactly the window colour, grouped across gaps
 * up to `WINDOW_REACH`. Each window's code is a hash of its first pixel in
 * scan order, so a reload codes the same window the same way.
 */
export function codeWindows(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  key: Rgb,
): number {
  const isWindow = (index: number): boolean =>
    data[index * 4 + 3]! > 0 &&
    data[index * 4] === key[0] &&
    data[index * 4 + 1] === key[1] &&
    data[index * 4 + 2] === key[2];

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let windows = 0;

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] === 1 || !isWindow(start)) continue;

    const code = hash(start % width, Math.floor(start / width)) % (WINDOW_CODE_STEPS * WINDOW_CODE_STEPS);
    const green = Math.floor(code / WINDOW_CODE_STEPS);
    const blue = code % WINDOW_CODE_STEPS;
    windows += 1;

    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      data[index * 4 + 1] = Math.min(255, key[1] + green);
      data[index * 4 + 2] = Math.min(255, key[2] + blue);

      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -WINDOW_REACH; dy <= WINDOW_REACH; dy += 1) {
        for (let dx = -WINDOW_REACH; dx <= WINDOW_REACH; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] === 1 || !isWindow(next)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
  }
  return windows;
}

/**
 * A copy of `texture` with its windows coded, or `undefined` where the pixels
 * cannot be read back. The caller keeps the original then, and the shader
 * falls back to keying windows by position. The copy is the caller's to destroy.
 */
export function windowCodedTexture(texture: Texture, window: number): Texture | undefined {
  const key: Rgb = [(window >> 16) & 0xff, (window >> 8) & 0xff, window & 0xff];
  return rewrittenTexture(texture, (data, width, height) => {
    codeWindows(data, width, height, key);
  });
}
