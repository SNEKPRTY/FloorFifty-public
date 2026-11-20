import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArtManifest } from "../../packages/asset-contract/src/manifest-schema";
import { validateAssets } from "../../packages/asset-contract/src/validate-assets";

const ROOT = resolve(import.meta.dirname, "../../packages/asset-contract/assets");
const manifest = parseArtManifest(JSON.parse(readFileSync(resolve(ROOT, "art-manifest.json"), "utf8")));
const logo = manifest.bundles["shell"]?.find((asset) => asset.alias === "brand.snekprtyLogo");

describe("the studio's logo", () => {
  it("ships as a WebP of the exempt role, with its full provenance and a size inside budget", () => {
    expect(logo).toMatchObject({ role: "cover", file: "production/brand/snekprty-logo.webp", width: 1200 });
    expect(logo?.provenance.source).toContain("brand/snekprty-logo-2026-11-14.png");
    expect(logo?.provenance.license).not.toBe("");
    const file = resolve(ROOT, logo!.file);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).length).toBeLessThan(150 * 1024);
  });

  it("passes the asset gate, which checks its WebP size rather than its palette", () => {
    const issues = validateAssets(ROOT, manifest).issues;
    expect(issues.filter((issue) => issue.alias === "brand.snekprtyLogo")).toEqual([]);
  });
});
