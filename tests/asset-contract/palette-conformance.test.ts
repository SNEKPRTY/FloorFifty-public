import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { swatchRgb } from "@floor-fifty/asset-contract/swatches";
import { offPalettePixels } from "@floor-fifty/asset-contract/validate-assets";
import { quantizeFile } from "../../packages/asset-contract/tools/quantize";

/** Writes a 2x1 PNG: one pixel of `left`, one of `right`, both opaque. */
function writePair(dir: string, name: string, left: number[], right: number[]): string {
  const png = new PNG({ width: 2, height: 1 });
  [...left, 255, ...right, 255].forEach((value, index) => {
    png.data[index] = value;
  });
  const path = resolve(dir, name);
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

describe("pixel conformance", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "ff-palette-"));

  it("accepts an image drawn entirely from the palette", () => {
    const a = [...swatchRgb(0)];
    const b = [...swatchRgb(30)];
    const path = writePair(dir, "on-palette.png", a, b);
    expect(offPalettePixels(path).count).toBe(0);
  });

  it("reports a pixel that is not a swatch", () => {
    const path = writePair(dir, "off-palette.png", [...swatchRgb(0)], [1, 2, 3]);
    const report = offPalettePixels(path);
    expect(report.count).toBe(1);
    expect(report.sample).toContain("#010203");
  });

  it("ignores fully transparent pixels", () => {
    const png = new PNG({ width: 1, height: 1 });
    [9, 9, 9, 0].forEach((value, index) => {
      png.data[index] = value;
    });
    const path = resolve(dir, "transparent.png");
    writeFileSync(path, PNG.sync.write(png));
    expect(offPalettePixels(path).count).toBe(0);
  });

  it("quantizes an off-palette image onto the palette", () => {
    const path = writePair(dir, "to-quantize.png", [...swatchRgb(0)], [1, 2, 3]);
    const result = quantizeFile(path);
    expect(result.total).toBe(2);
    expect(result.changed).toBe(1);
    expect(offPalettePixels(path).count).toBe(0);
  });

  it("leaves alpha untouched when quantizing", () => {
    const png = new PNG({ width: 1, height: 1 });
    [200, 10, 10, 128].forEach((value, index) => {
      png.data[index] = value;
    });
    const path = resolve(dir, "semi.png");
    writeFileSync(path, PNG.sync.write(png));
    quantizeFile(path);
    expect(PNG.sync.read(readFileSync(path)).data[3]).toBe(128);
  });

  it("holds every shipped image to the palette", () => {
    // The real gate over the whole shipped set.
    //
    // Audio and cover rows are skipped rather than filtered by extension: a
    // track has no pixels to hold to a palette, a cover is smooth UI art kept
    // off it (select spec §8), and reading either as a PNG fails with a
    // decoder error that says nothing about what is actually wrong.
    const root = resolve(process.cwd(), "packages/asset-contract/assets");
    const manifest = JSON.parse(
      readFileSync(resolve(root, "art-manifest.json"), "utf8"),
    ) as { bundles: Record<string, { file: string; alias: string; role: string }[]> };

    const offenders = Object.values(manifest.bundles)
      .flat()
      .filter((asset) => asset.role !== "audio" && asset.role !== "cover")
      .map((asset) => ({ alias: asset.alias, ...offPalettePixels(resolve(root, asset.file)) }))
      .filter((report) => report.count > 0);

    expect(offenders).toEqual([]);
  });
});
