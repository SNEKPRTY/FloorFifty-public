import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { allAssets, parseArtManifest } from "../../packages/asset-contract/src/manifest-schema";

const manifest = parseArtManifest(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../packages/asset-contract/assets/art-manifest.json"), "utf8")),
);
const aliases = new Set(allAssets(manifest).map(({ asset }) => asset.alias));
const cap = (word: string) => word[0]!.toUpperCase() + word.slice(1);

describe("character art", () => {
  it.each(["frog", "diver", "robo", "kitsune", "penguin", "oni", "witch", "knight"])("carries %s in every seat colour, with three portrait moods", (body) => {
    for (const colour of SEAT_COLOURS) {
      expect(aliases).toContain(`${body}.${colour}`);
      for (const mood of ["", "Win", "Lose"]) expect(aliases).toContain(`portrait.${body}${cap(colour)}${mood}`);
    }
  });

  it("every character sheet is four frames across and seven animations down", () => {
    // The ready room's showcase draws the idle frame by this layout.
    let seen = 0;
    for (const { asset } of allAssets(manifest)) {
      if (asset.role !== "character") continue;
      seen += 1;
      const sheet = PNG.sync.read(readFileSync(resolve(import.meta.dirname, "../../packages/asset-contract/assets", asset.file)));
      expect([asset.alias, sheet.width, sheet.height]).toEqual([asset.alias, 4 * asset.width, 7 * asset.height]);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("keeps Oni portraits inside their frame without neighbouring-row fragments", () => {
    for (const colour of SEAT_COLOURS) {
      for (const suffix of ["", "-win", "-lose"]) {
        const file = `portrait-oni-${colour}${suffix}.png`;
        const png = PNG.sync.read(readFileSync(resolve(import.meta.dirname, "../../packages/asset-contract/assets/production", file)));
        const edgeAlpha = [...Array(png.width).keys()].flatMap((x) => [
          png.data[x * 4 + 3],
          png.data[((png.height - 1) * png.width + x) * 4 + 3],
        ]);
        expect(edgeAlpha.every((alpha) => alpha === 0), file).toBe(true);
      }
    }
  });

  it("files every character sheet with the ninja's, in the shell", () => {
    const shell = new Set((manifest.bundles.shell ?? []).map((asset) => asset.alias));
    for (const body of ["ninja", "frog", "diver", "robo", "kitsune", "penguin", "oni", "witch", "knight"])
      for (const colour of SEAT_COLOURS) expect(shell).toContain(`${body}.${colour}`);
  });
});
