import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArtManifest } from "../../packages/asset-contract/src/manifest-schema";

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../packages/asset-contract/assets/art-manifest.json"), "utf8"));
const manifest = parseArtManifest(raw);
const aliasesOf = (bundle: string) => new Set((manifest.bundles[bundle as keyof typeof manifest.bundles] ?? []).map((asset) => asset.alias));

describe("bundles", () => {
  it("keeps every character's sheet and portraits in the shell", () => {
    const shell = aliasesOf("shell");
    for (const alias of ["ninja.scarlet", "frog.violet", "portrait.cyan", "portrait.kitsuneGoldWin"]) expect(shell).toContain(alias);
  });

  it("gives each stage its own bundle of layer art", () => {
    expect(aliasesOf("stage-rooftops")).toContain("world.cityNear");
    expect(aliasesOf("stage-rooftops")).toContain("world.sun");
    expect(aliasesOf("stage-snow-shrine")).toContain("world.snowShrineSky");
    expect(aliasesOf("stage-sunken-dome")).toContain("world.sunkenDomeMantas");
  });

  it("keeps the shared platform and the tutorial's stage in gameplay", () => {
    expect(aliasesOf("gameplay")).toContain("world.platform");
    expect(aliasesOf("gameplay")).toContain("world.dawnSky");
  });

  it("carries every stage's select still in the shell", () => {
    for (const alias of ["still.rooftopsPreview", "still.snowShrinePreview", "still.sunkenDomePreview"]) expect(aliasesOf("shell")).toContain(alias);
  });

  it("refuses a bundle name outside the scheme", () => {
    expect(() => parseArtManifest({ ...raw, bundles: { ...raw.bundles, "select": [] } })).toThrow();
  });
});
