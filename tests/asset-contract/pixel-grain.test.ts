/**
 * The grain measure, against the rule it states: the share of opaque pixels
 * that belong to no 2x2 block of their own colour. The reference below is the
 * rule written as plainly as possible; the shipped measure must agree with it
 * exactly, on hand-drawn cases, on noise, and on every shipped image.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { measureGrain } from "@floor-fifty/asset-contract/pixel-grain";
import { createRng } from "@floor-fifty/shared/level/rng";

/** The rule, plainly: string colours, every square that holds the pixel. */
function referenceGrain(png: PNG): { grain: number; opaque: number } {
  const colourAt = (x: number, y: number): string | undefined => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return undefined;
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3] === 0) return undefined;
    return `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
  };
  let opaque = 0;
  let grainy = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const self = colourAt(x, y);
      if (self === undefined) continue;
      opaque += 1;
      const covered = [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ].some(([ox, oy]) =>
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].every(([dx, dy]) => colourAt(x + ox! + dx!, y + oy! + dy!) === self),
      );
      if (!covered) grainy += 1;
    }
  }
  return { grain: opaque === 0 ? 0 : grainy / opaque, opaque };
}

/** An image from rows of characters: "." is transparent, any other letter a colour. */
function drawn(rows: string[]): PNG {
  const png = new PNG({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      const i = (y * png.width + x) * 4;
      const code = cell.charCodeAt(0);
      png.data[i] = code;
      png.data[i + 1] = code * 3;
      png.data[i + 2] = code * 7;
      png.data[i + 3] = cell === "." ? 0 : 255;
    }),
  );
  return png;
}

describe("the grain measure", () => {
  it("counts nothing in an empty image", () => {
    expect(measureGrain(drawn(["..", ".."]))).toEqual({ grain: 0, opaque: 0 });
  });

  it("calls a 2x2 block solid and a lone pixel grain", () => {
    expect(measureGrain(drawn(["aa.", "aa.", "..b"]))).toEqual({ grain: 1 / 5, opaque: 5 });
  });

  it("covers a pixel on a shape's right and bottom edges by the square to its left and above", () => {
    expect(measureGrain(drawn(["aaa", "aaa", "aaa"])).grain).toBe(0);
  });

  it("tells colours apart: a checkerboard is all grain", () => {
    expect(measureGrain(drawn(["ab", "ba"])).grain).toBe(1);
  });

  it("does not count a transparent pixel's leftover colour as a match", () => {
    const png = drawn(["a.", "aa"]);
    // The transparent pixel keeps channels equal to `a`'s; it still breaks the square.
    png.data[4] = png.data[0]!;
    png.data[5] = png.data[1]!;
    png.data[6] = png.data[2]!;
    expect(measureGrain(png)).toEqual(referenceGrain(png));
    expect(measureGrain(png).grain).toBe(1);
  });

  it("agrees with the rule on seeded noise of every density", () => {
    const rng = createRng(2026);
    for (let trial = 0; trial < 40; trial += 1) {
      const png = new PNG({ width: 1 + (rng.nextUint32() % 37), height: 1 + (rng.nextUint32() % 29) });
      const colours = 1 + (rng.nextUint32() % 4);
      const holes = rng.nextFloat();
      for (let i = 0; i < png.data.length; i += 4) {
        const c = rng.nextUint32() % colours;
        png.data[i] = c * 40;
        png.data[i + 1] = c * 20;
        png.data[i + 2] = c;
        png.data[i + 3] = rng.nextFloat() < holes ? 0 : 255;
      }
      expect(measureGrain(png)).toEqual(referenceGrain(png));
    }
  });

  it("agrees with the rule on every shipped image", () => {
    const root = resolve(process.cwd(), "packages/asset-contract/assets");
    const manifest = parseArtManifest(JSON.parse(readFileSync(resolve(root, "art-manifest.json"), "utf8")));
    let checked = 0;
    for (const assets of Object.values(manifest.bundles)) {
      for (const asset of assets as { file: string }[]) {
        if (!asset.file.endsWith(".png")) continue;
        const png = PNG.sync.read(readFileSync(resolve(root, asset.file)));
        expect(measureGrain(png), asset.file).toEqual(referenceGrain(png));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
