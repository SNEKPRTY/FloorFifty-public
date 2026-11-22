/**
 * `pnpm assets:city`.
 *
 * Turns reviewed generated illustrations into the parallax scenery plates.
 *
 * **Why generated here and drafted elsewhere.** The other wide plates in
 * `generate-placeholder.ts` are shapes a generator cannot be asked for: a cloud
 * band that tiles, a sun that is a disc and nothing else. A city is the
 * opposite. Its appeal is density -- water towers, antennas, fire escapes,
 * ladders, vents -- and density is exactly what hand-drafted rectangles cannot
 * reach and a generator produces without being asked twice. The drafted city
 * was flat blocks with window runs; this one has rooftops.
 *
 * **Why the source images are committed rather than regenerated.** The model is
 * not deterministic and the art is reviewed, so the reviewed bytes are the ones
 * that ship. `assets/source/` holds them. Regenerating is a deliberate act with
 * a new review, not something a build does.
 *
 * **What this file actually does**, in order, and why each step is load bearing:
 *
 * 1. *Key.* The generator will not honour a transparent background, so the
 *    source is drawn on flat magenta and keyed here. Keying by distance rather
 *    than by equality, because the encoder leaves a fringe.
 * 2. *Crop to content.* The generator frames loosely, and the plate's height is
 *    fixed by the manifest, so the drawn city is found rather than assumed.
 * 3. *Resize.* Box filter, then nearest-palette. Averaging before quantising is
 *    what keeps a roof edge an edge instead of a dither.
 * 4. *Quantise.* Every opaque pixel lands exactly on a Resurrect 64 swatch,
 *    which the asset contract enforces and this guarantees rather than hopes.
 * 5. *Extrude the foot.* The renderer continues a strip below its own edge by
 *    stretching the last row, which is seamless only if the last row is already
 *    what the rows above it are. The bottom band is therefore replaced by a
 *    vertical extrusion of the row above it. Drafted art got this for free,
 *    because its towers were columns; generated art has to be made to.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { ROLES } from "../src/roles";
import { swatchRgb } from "../src/swatches";
import { contentBounds, crop, quantizeNearest, resample } from "./source-raster";
import { powderFinishAtGrid } from "./powder";
import { PLATES } from "./generate-city/plates";
import {
  clearAlphaIslands,
  clearSpecks,
  coarsen,
  despeckle,
  morphSimplify,
  openShapes,
  quantize,
} from "./generate-city/cleanup";
import { extrudeFoot, quietFoot } from "./generate-city/feet";
import {
  fromLip,
  lanterns,
  menuBackdrop,
  platformSheet,
  slabWidth,
  SNOW_SHRINE_PLATFORM_ROLES,
  SUNKEN_DOME_PLATFORM_ROLES,
} from "./generate-city/platforms";
import {
  cloudBand,
  cloudPlate,
  fishPlate,
  stageSky,
  sunPlate,
  withRepeatingBands,
  ROOFTOPS_SKY_GRADIENTS,
  SNOW_SHRINE_SKY_GRADIENTS,
  SUNKEN_DOME_SKY_GRADIENTS,
} from "./generate-city/sky";
import { menuCityLayers, menuFacadeTile, menuLedgePlate, menuLedgeSlab } from "./generate-city/menu-city";
import { quietJoin, wrapPad, wrapSeamless, SEAM_MARGIN, SEAM_OVERLAP } from "./generate-city/seams";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(PACKAGE_ROOT, "assets", "source");
const OUT = resolve(PACKAGE_ROOT, "assets", "production");

function main(): void {
  process.stdout.write("converting generated city plates:\n");

  for (const plate of PLATES) {
    const read = PNG.sync.read(readFileSync(resolve(SOURCE, plate.source)));
    const png = plate.seamless === true ? wrapSeamless(read, SEAM_OVERLAP) : read;
    const { top, bottom } = contentBounds(png);
    const headroom = Math.round((bottom - top + 1) * (plate.headroom ?? 0));
    const foot = bottom - (plate.footTrim ?? 0);
    const resampled = resample(png, Math.max(0, top - headroom), foot, plate.width, plate.height);
    // A seamless plate is cleaned up with a margin of its own other end on
    // each side, then cut back: despeckling, the grid and the shape tests see
    // only what is in front of them, and at a bare edge a building the join
    // cuts looks thin on one side only, so it would be removed there alone.
    let work = plate.seamless === true ? wrapPad(resampled, SEAM_MARGIN) : resampled;
    if (plate.byColour === true) quantizeNearest(work, plate.ramp);
    else quantize(work, plate.ramp);
    despeckle(work);
    if (plate.ramp.length > 1) {
      clearSpecks(work, 4, swatchRgb(ROLES.cityWindow));
    }
    // Grid first, then shapes: snapping merges some neighbours and orphans
    // others, so the size test has to run against what the grid actually left.
    if (plate.grid !== undefined) coarsen(work, plate.grid);
    if (plate.minOpaqueArea !== undefined) {
      clearAlphaIslands(work, plate.minOpaqueArea, plate.requireBottomConnection);
    }
    if (plate.powder === true) {
      work = powderFinishAtGrid(work, plate.grid ?? 1);
      quantizeNearest(work, plate.ramp);
    } else {
      morphSimplify(work);
    }
    if (plate.minShape !== undefined) openShapes(work, plate.minShape);
    const out = plate.seamless === true ? quietJoin(crop(work, SEAM_MARGIN, 0, plate.width, plate.height), plate.grid ?? 1) : work;
    if (plate.extrudeFoot !== false) extrudeFoot(out);
    if (plate.footQuiet !== undefined) quietFoot(out, plate.footQuiet);

    writeFileSync(resolve(OUT, plate.file), PNG.sync.write(out));

    if (plate.file === "world-city-near.png") {
      // The near plate's roofline band, matching the renderer's `sink` for this
      // layer in `stage-layers.ts`.
      writeFileSync(
        resolve(OUT, "world-lanterns.png"),
        PNG.sync.write(lanterns(out, 290)),
      );
    }

    const used = new Set<string>();
    let opaque = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      opaque += 1;
      used.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
    }
    process.stdout.write(
      `  ${plate.file} (${plate.width}x${plate.height}) ` +
        `from rows ${top}-${bottom}, ${used.size} swatches, ` +
        `${Math.round((opaque / (plate.width * plate.height)) * 100)}% opaque\n`,
    );
  }
  for (const [file, source, build] of [
    ["world-platform.png", "platform.png", platformSheet],
    ["world-sun.png", "sun-low.png", sunPlate],
    ["world-clouds-high.png", "clouds-streaks.png", (png) => cloudBand(cloudPlate(png), 0)],
    ["world-clouds.png", "clouds-streaks.png", (png) => cloudBand(cloudPlate(png), 1)],
    ["world-clouds-low.png", "clouds-streaks.png", (png) => cloudBand(cloudPlate(png), 2)],
    ["menu-ledge.png", "menu-ledge.png", menuLedgePlate],
    ["menu-ledge-slab.png", "menu-ledge.png", menuLedgeSlab],
    ["menu-facade.png", "menu-facade.png", menuFacadeTile],
    ["menu-backdrop.png", "menu-backdrop.png", menuBackdrop],
    ["world-snow-shrine-sky.png", "snow-shrine-sky.png", withRepeatingBands(stageSky(SNOW_SHRINE_SKY_GRADIENTS))],
    ["world-rooftops-sky.png", "rooftops-sky.png", withRepeatingBands(stageSky(ROOFTOPS_SKY_GRADIENTS))],
    ["world-sunken-dome-sky.png", "sunken-dome-sky.png", withRepeatingBands(stageSky(SUNKEN_DOME_SKY_GRADIENTS))],
    ["world-sunken-dome-fish.png", "sunken-dome-fish.png", fishPlate],
    ["world-sunken-dome-mantas.png", "sunken-dome-mantas.png", fishPlate],
    ["world-snow-shrine-platform.png", "snow-shrine-platform.png", (png) => platformSheet(slabWidth(png), SNOW_SHRINE_PLATFORM_ROLES)],
    ["world-sunken-dome-platform.png", "sunken-dome-platform.png", (png) => platformSheet(fromLip(slabWidth(png)), SUNKEN_DOME_PLATFORM_ROLES)],
  ] as [string, string, (png: PNG) => PNG][]) {
    const out = build(PNG.sync.read(readFileSync(resolve(SOURCE, source))));
    writeFileSync(resolve(OUT, file), PNG.sync.write(out));
    process.stdout.write(`  ${file} (${out.width}x${out.height})\n`);
  }

  // The menu's city, split into the layers its parallax slides apart.
  const layers = menuCityLayers(PNG.sync.read(readFileSync(resolve(SOURCE, "menu-city.png"))));
  for (const [file, png] of [
    ["menu-city-far.png", layers.far],
    ["menu-city-near.png", layers.near],
  ] as [string, PNG][]) {
    writeFileSync(resolve(OUT, file), PNG.sync.write(png));
    process.stdout.write(`  ${file} (${png.width}x${png.height})\n`);
  }

  process.stdout.write("done\n");
}

main();
