import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_BUNDLES, parseArtManifest, type ArtManifest } from "../../packages/asset-contract/src/manifest-schema";
import { DEMO_CLIP_BYTES, DEMO_SET_BYTES, DEMO_SLIDES, DEMO_STILL_BYTES, RECORDED_SLIDES, validateAssets } from "../../packages/asset-contract/src/validate-assets";
import { webpSize } from "../../packages/asset-contract/src/webp-size";

/** A file with a WebP's header (`VP8X`, as an animated one has) and `bytes` in all. */
function webp(width: number, height: number, bytes: number): Uint8Array {
  const out = new Uint8Array(Math.max(bytes, 30));
  const text = (offset: number, value: string): void => [...value].forEach((char, index) => (out[offset + index] = char.charCodeAt(0)));
  const u24 = (offset: number, value: number): void => {
    out[offset] = value & 255;
    out[offset + 1] = (value >> 8) & 255;
    out[offset + 2] = (value >> 16) & 255;
  };
  text(0, "RIFF");
  text(8, "WEBP");
  text(12, "VP8X");
  u24(24, width - 1);
  u24(27, height - 1);
  return out;
}

const provenance = { tool: "tests/e2e/demo-capture.spec.ts, tools/demos/encode.ts", prompt: "seed 6, script steer", source: "commit abcdef0", license: "own work" };
const row = (alias: string, file: string, kind: "clip" | "still") => ({ alias, file, role: "demo" as const, kind, width: 480, height: 270, provenance });
const aliases = RECORDED_SLIDES.flatMap((slide) => [`demo.${slide}`, `demo.${slide}Still`]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "demos-"));
  mkdirSync(resolve(dir, "production/demos"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The clips and stills, written into `dir`, at the sizes asked. */
function write(clipBytes = 100_000, stillBytes = 10_000, slides: readonly string[] = RECORDED_SLIDES): ArtManifest {
  const rows = slides.flatMap((slide) => {
    writeFileSync(resolve(dir, `production/demos/${slide}.webp`), webp(480, 270, clipBytes));
    writeFileSync(resolve(dir, `production/demos/${slide}-still.webp`), webp(480, 270, stillBytes));
    return [row(`demo.${slide}`, `production/demos/${slide}.webp`, "clip"), row(`demo.${slide}Still`, `production/demos/${slide}-still.webp`, "still")];
  });
  const bundles = Object.fromEntries(CORE_BUNDLES.map((name) => [name, name === "demos" ? rows : []]));
  return parseArtManifest({ version: 1, brief: "fixture", bundles });
}

const problems = (manifest: ArtManifest): string[] =>
  validateAssets(dir, manifest)
    .issues.filter((issue) => issue.alias.startsWith("demo."))
    .map((issue) => `${issue.alias}: ${issue.problem}`);

describe("the demo clips (story spec, criterion 19)", () => {
  it("names the six slides, in the carousel's order", () => {
    expect(DEMO_SLIDES).toEqual(["steer", "bounce", "dropFast", "movingFloors", "lava", "race"]);
    // Every slide has a recording, the race included: a Help page with no picture is a defect (Owner, 2026-11-20).
    expect(RECORDED_SLIDES).toEqual(DEMO_SLIDES);
    expect(aliases).toHaveLength(12);
  });

  it("holds the budget the spec sets", () => {
    expect([DEMO_CLIP_BYTES, DEMO_STILL_BYTES, DEMO_SET_BYTES]).toEqual([350 * 1024, 30 * 1024, 1.8 * 1024 * 1024]);
  });

  it("passes a set that is whole and inside its budget", () => {
    expect(problems(write())).toEqual([]);
  });

  it("refuses a missing clip, naming it", () => {
    const manifest = write();
    rmSync(resolve(dir, "production/demos/lava.webp"));
    expect(problems(manifest)).toEqual([expect.stringMatching(/^demo\.lava: could not read production\/demos\/lava\.webp/)]);
  });

  it("refuses a missing still", () => {
    const manifest = write();
    rmSync(resolve(dir, "production/demos/lava-still.webp"));
    expect(problems(manifest)).toEqual([expect.stringMatching(/^demo\.lavaStill: could not read/)]);
  });

  it("refuses a file that is not a WebP", () => {
    const manifest = write();
    writeFileSync(resolve(dir, "production/demos/steer.webp"), new Uint8Array(2000));
    expect(problems(manifest)).toEqual(["demo.steer: production/demos/steer.webp is not a WebP"]);
  });

  it("refuses a file whose size differs from its row", () => {
    const manifest = write();
    writeFileSync(resolve(dir, "production/demos/bounce-still.webp"), webp(480, 271, 5000));
    expect(problems(manifest)).toEqual(["demo.bounceStill: expected 480x270, found 480x271"]);
  });

  it("refuses a clip over 350 KB", () => {
    const manifest = write();
    writeFileSync(resolve(dir, "production/demos/dropFast.webp"), webp(480, 270, DEMO_CLIP_BYTES + 1));
    expect(problems(manifest)).toEqual([expect.stringMatching(/^demo\.dropFast: .* over the 350 KB a clip may be/)]);
  });

  it("refuses a still over 30 KB", () => {
    const manifest = write();
    writeFileSync(resolve(dir, "production/demos/movingFloors-still.webp"), webp(480, 270, DEMO_STILL_BYTES + 1));
    expect(problems(manifest)).toEqual([expect.stringMatching(/^demo\.movingFloorsStill: .* over the 30 KB a still may be/)]);
  });

  it("refuses six clips together over 1.8 MB, though each is inside its own budget", () => {
    const manifest = write(320 * 1024, 10_000, DEMO_SLIDES);
    expect(problems(manifest)).toEqual([expect.stringMatching(/^demo\.\*: the clips are .* over the 1\.8 MB the set may be/)]);
  });

  it("refuses a slide with no row at all", () => {
    const manifest = write();
    manifest.bundles.demos = manifest.bundles.demos.filter((asset) => asset.alias !== "demo.lavaStill");
    expect(problems(manifest)).toEqual(["demo.lavaStill: no row for this slide's still"]);
  });

  it("refuses a demo row in any bundle that is loaded as a bundle", () => {
    const manifest = write();
    for (const bundle of ["splash", "menu", "shell", "gameplay", "audio"] as const) {
      const moved = { ...JSON.parse(JSON.stringify(manifest)), bundles: { ...manifest.bundles, [bundle]: [manifest.bundles.demos[0]] } };
      expect(() => parseArtManifest(moved), bundle).toThrow(/demo/);
    }
  });
});

describe("the committed demos", () => {
  const root = resolve(process.cwd(), "packages/asset-contract/assets");
  const manifest = parseArtManifest(JSON.parse(readFileSync(resolve(root, "art-manifest.json"), "utf8")));

  it("are twelve rows in the demos bundle and nowhere else", () => {
    expect(manifest.bundles.demos.map((asset) => asset.alias)).toEqual(aliases);
    for (const [bundle, assets = []] of Object.entries(manifest.bundles))
      if (bundle !== "demos") expect(assets.filter((asset) => asset.alias.startsWith("demo.")), bundle).toEqual([]);
  });

  it("pass the gate, at 480 by 270, inside the budget", () => {
    expect(validateAssets(root, manifest).issues.filter((issue) => issue.alias.startsWith("demo."))).toEqual([]);
    for (const asset of manifest.bundles.demos) expect(webpSize(readFileSync(resolve(root, asset.file)))).toEqual({ width: 480, height: 270 });
  });
});
