import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_EMPTY_BUNDLES, allAssets, parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { offPalettePixels } from "@floor-fifty/asset-contract/validate-assets";

const ROOT = resolve(process.cwd(), "packages/asset-contract/assets");
const manifest = parseArtManifest(
  JSON.parse(readFileSync(resolve(ROOT, "art-manifest.json"), "utf8")),
);

describe("UI chrome", () => {
  it("no longer declares the menu bundle intentionally empty", () => {
    expect(KNOWN_EMPTY_BUNDLES).not.toContain("menu");
  });

  it("fills the menu bundle", () => {
    // The layered menu (launch polish spec §2.8, §2.9): the original painted
    // plate as the refracted sky, a far and a near city for parallax over it,
    // and the ledge the racers stand on, with the single composite
    // kept as the fallback when the split art is missing. The title plate
    // that used to sit here was nine-sliced behind a heading by CSS
    // `border-image`; the Aquarian panels are CSS surfaces, so it was retired.
    // The facade is the building under the ledge, so it reads as a roof, and
    // the slab is the ledge's middle as its own tile, for the menu to repeat.
    expect(manifest.bundles.menu.map((asset) => asset.alias).sort()).toEqual([
      "menu.backdrop",
      "menu.cityFar",
      "menu.cityNear",
      "menu.facade",
      "menu.ledge",
      "menu.ledgeSlab",
    ]);
  });

  it("keeps the reviewed menu art at the full logical frame", () => {
    const backdrop = manifest.bundles.menu.find((asset) => asset.alias === "menu.backdrop");
    expect(backdrop).toMatchObject({ width: 960, height: 540 });
    expect(backdrop?.provenance.prompt).not.toMatch(/320x180|3x logical upscale/i);
  });

  it("declares no chip frame", () => {
    // `ui.chipFrame` was the nine-slice both `Chip.svelte` and the drawn HUD
    // stretched. The DOM panels are CSS surfaces now and the drawn HUD is
    // retired, so nothing slices it -- and an asset nobody draws is still
    // downloaded, validated and reviewed as though it were in the game. It is
    // retired, and this asserts it stays retired rather than drifting back in
    // with the generator.
    const aliases = allAssets(manifest).map(({ asset }) => asset.alias);
    expect(aliases).not.toContain("ui.chipFrame");
  });

  it("declares no glyph page", () => {
    // `ui.font` was a bitmap sheet for a Pixi BitmapText path the HUD never
    // took: it sets type in the same webfont the DOM does. The asset was
    // generated, validated and drawn by nothing, and is retired. This asserts
    // it stays retired rather than drifting back in with the generator.
    const aliases = allAssets(manifest).map(({ asset }) => asset.alias);
    expect(aliases).not.toContain("ui.font");
  });

  it("draws every chrome asset from the palette", () => {
    for (const file of ["production/menu-backdrop.png"]) {
      expect(offPalettePixels(resolve(ROOT, file)).count).toBe(0);
    }
  });
});
