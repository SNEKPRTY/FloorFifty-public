/**
 * `pnpm assets:quantize`.
 *
 * Generated art does not arrive on-palette: PixelLab returns whatever its model
 * produced, and an in-repo gradient blends between swatches. Without this stage
 * the conformance rule would reject every asset the moment it was generated,
 * which would make the contract unusable rather than strict.
 *
 * Alpha is preserved exactly. Fully transparent pixels are untouched, so a
 * cut-out sprite's silhouette is not altered by quantization.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { nearestSwatch, swatchRgb } from "../src/swatches";
import { allAssets, parseArtManifest } from "../src/manifest-schema";

export function quantizeFile(path: string): { changed: number; total: number } {
  const png = PNG.sync.read(readFileSync(path));
  let changed = 0;
  let total = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 3] === 0) continue;
    total += 1;

    const r = png.data[index] ?? 0;
    const g = png.data[index + 1] ?? 0;
    const b = png.data[index + 2] ?? 0;
    const [nr, ng, nb] = swatchRgb(nearestSwatch(r, g, b));
    if (nr === r && ng === g && nb === b) continue;

    png.data[index] = nr;
    png.data[index + 1] = ng;
    png.data[index + 2] = nb;
    changed += 1;
  }

  if (changed > 0) writeFileSync(path, PNG.sync.write(png));
  return { changed, total };
}

function main(): void {
  const root = resolve(import.meta.dirname, "..", "assets");
  const manifest = parseArtManifest(
    JSON.parse(readFileSync(resolve(root, "art-manifest.json"), "utf8")),
  );

  for (const { asset } of allAssets(manifest)) {
    const result = quantizeFile(resolve(root, asset.file));
    process.stdout.write(
      `${asset.alias}: ${result.changed}/${result.total} opaque pixels moved onto the palette\n`,
    );
  }
}

// Only run as a script; the test imports `quantizeFile` directly.
if (process.argv[1]?.endsWith("quantize.ts") === true) main();
