/**
 * A tiny indexed drawing surface.
 *
 * Just enough to author pixel art from code: no anti-aliasing, no blending
 * beyond straight alpha replacement, and integer coordinates only. Anything
 * smoother than this would stop looking like pixel art.
 */

import { PNG } from "pngjs";

export type Rgba = readonly [number, number, number, number];

/** Parses `#rrggbb` into an opaque colour. */
export function hex(value: string, alpha = 255): Rgba {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    alpha,
  ];
}

/** Mixes two colours by `t` in `[0, 1]`, rounding to whole channel values. */
export function mix(from: Rgba, to: Rgba, t: number): Rgba {
  const clamped = Math.min(1, Math.max(0, t));
  return [
    Math.round(from[0] + (to[0] - from[0]) * clamped),
    Math.round(from[1] + (to[1] - from[1]) * clamped),
    Math.round(from[2] + (to[2] - from[2]) * clamped),
    Math.round(from[3] + (to[3] - from[3]) * clamped),
  ];
}

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

export class PixelCanvas {
  private readonly png: PNG;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.png = new PNG({ width, height });
    this.png.data.fill(0);
  }

  set(x: number, y: number, colour: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    this.png.data[index] = colour[0];
    this.png.data[index + 1] = colour[1];
    this.png.data[index + 2] = colour[2];
    this.png.data[index + 3] = colour[3];
  }

  fillRect(x: number, y: number, width: number, height: number, colour: Rgba): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) this.set(column, row, colour);
    }
  }

  /** Fills every row with a colour derived from its vertical position. */
  verticalGradient(shade: (t: number) => Rgba): void {
    for (let y = 0; y < this.height; y += 1) {
      const colour = shade(this.height === 1 ? 0 : y / (this.height - 1));
      this.fillRect(0, y, this.width, 1, colour);
    }
  }

  /** Draws a filled disc with a per-radius colour, skipping fully clear pixels. */
  disc(cx: number, cy: number, radius: number, shade: (t: number) => Rgba): void {
    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > radius) continue;
        const colour = shade(distance / radius);
        if (colour[3] === 0) continue;
        this.set(x, y, colour);
      }
    }
  }

  /** Copies another canvas in at an offset, skipping fully transparent pixels. */
  blit(source: PixelCanvas, atX: number, atY: number): void {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const colour = source.get(x, y);
        if (colour[3] === 0) continue;
        this.set(atX + x, atY + y, colour);
      }
    }
  }

  get(x: number, y: number): Rgba {
    const index = (y * this.width + x) * 4;
    return [
      this.png.data[index] ?? 0,
      this.png.data[index + 1] ?? 0,
      this.png.data[index + 2] ?? 0,
      this.png.data[index + 3] ?? 0,
    ];
  }

  toBuffer(): Buffer {
    return PNG.sync.write(this.png);
  }

  /** Reads an encoded PNG back into a canvas. */
  static fromPngBuffer(buffer: Buffer): PixelCanvas {
    const png = PNG.sync.read(buffer);
    const canvas = new PixelCanvas(png.width, png.height);
    png.data.copy(canvas.png.data);
    return canvas;
  }
}

/**
 * A small deterministic generator.
 *
 * Placeholder art has to be byte-identical between runs, or every regeneration
 * would show up as a diff and the review record would mean nothing.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  };
}
