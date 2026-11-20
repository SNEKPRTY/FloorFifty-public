/**
 * Every stage layer's art carries the flag that holds it to its edge check.
 *
 * `assets:check` only measures a seam or a sky band on a row that asks for it
 * (`tilesHorizontally`, `skyPlate`), so a strip added without its flag ships
 * unchecked, however hard its seam breaks. Every layer but a sky plate is
 * drawn as a strip repeating across the screen (`StageLayers`), and a sky
 * plate repeats its edge bands up and down a tall one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSources } from "@floor-fifty/content/parse";
import { readSources } from "@floor-fifty/content/read-sources";
import { allAssets, parseArtManifest } from "../../packages/asset-contract/src/manifest-schema";

const ROOT = resolve(import.meta.dirname, "../..");
const manifest = parseArtManifest(JSON.parse(readFileSync(resolve(ROOT, "packages/asset-contract/assets/art-manifest.json"), "utf8")));
const rows = new Map(allAssets(manifest).map(({ asset }) => [asset.alias, asset]));

const layers = async () => {
  const parsed = parseSources(await readSources(resolve(ROOT, "content")));
  if (!parsed.ok) throw new Error("content does not parse");
  return parsed.parsed.stages.flatMap((stage) => stage.value.theme.layers.map((layer) => ({ stage: stage.value.id, ...layer })));
};

describe("a stage layer's art", () => {
  it("flags every strip to tile horizontally", async () => {
    const unflagged = (await layers())
      .filter((layer) => layer.extend !== "plate")
      .filter((layer) => { const row = rows.get(layer.alias); return row?.role !== "image" || row.tilesHorizontally !== true; })
      .map((layer) => `${layer.stage}: ${layer.alias}`);
    expect(unflagged).toEqual([]);
  });

  it("flags every sky plate as one", async () => {
    const unflagged = (await layers())
      .filter((layer) => layer.extend === "plate")
      .filter((layer) => { const row = rows.get(layer.alias); return row?.role !== "image" || row.skyPlate !== true; })
      .map((layer) => `${layer.stage}: ${layer.alias}`);
    expect(unflagged).toEqual([]);
  });
});
