import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allAssets, parseArtManifest, type ArtManifest } from "../../packages/asset-contract/src/manifest-schema";
import { validateAssets } from "../../packages/asset-contract/src/validate-assets";
import { webpSize } from "../../packages/asset-contract/src/webp-size";

const ROOT = resolve(process.cwd(), "packages/asset-contract/assets");
const loadManifest = (): ArtManifest => parseArtManifest(JSON.parse(readFileSync(resolve(ROOT, "art-manifest.json"), "utf8")));
// Every song in a pack, however many have landed: a cover lands with its song.
const songs = (
  JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8")) as {
    content: { songs: { id: string; coverAlias?: string }[] };
  }
).content.songs;

describe("the song covers", () => {
  const rows = new Map(allAssets(loadManifest()).map((entry) => [entry.asset.alias, entry]));

  it("covers at least one song", () => {
    expect(songs.length).toBeGreaterThan(0);
  });

  for (const song of songs) {
    it(`has ${song.id}'s cover at 192 and 640 px in the shell, and at 1200 px for the reveal, as WebP`, () => {
      expect(song.coverAlias).toBeDefined();
      for (const [alias, size, bundle] of [[song.coverAlias!, 192, "shell"], [`${song.coverAlias}Large`, 640, "shell"], [`${song.coverAlias}Full`, 1200, "reveal"]] as const) {
        const row = rows.get(alias);
        expect(row?.bundle, alias).toBe(bundle);
        expect(row?.asset).toMatchObject({ role: "cover", width: size, height: size });
        expect(webpSize(readFileSync(resolve(ROOT, row!.asset.file)))).toEqual({ width: size, height: size });
      }
    });
  }

  it("passes the asset gate, which checks a cover's WebP size rather than its palette", () => {
    const issues = validateAssets(ROOT, loadManifest()).issues;
    expect(issues.filter((issue) => issue.alias.startsWith("cover."))).toEqual([]);
  });

  it("reports a cover whose file is not the size its row says", () => {
    const manifest = loadManifest();
    const cover = manifest.bundles.shell.find((asset) => asset.role === "cover");
    expect(cover).toBeDefined();
    if (cover?.role === "cover") cover.width = 193;
    expect(validateAssets(ROOT, manifest).issues).toContainEqual(
      expect.objectContaining({ alias: cover!.alias, problem: expect.stringContaining("expected 193x") }),
    );
  });
});
