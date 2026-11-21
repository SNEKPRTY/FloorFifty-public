import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_BUNDLES, parseArtManifest } from "../../packages/asset-contract/src/manifest-schema";
import { STORY_PANEL_BYTES, STORY_SET_BYTES, validateAssets } from "../../packages/asset-contract/src/validate-assets";
import { measureGrain } from "../../packages/asset-contract/src/pixel-grain";
import { SPEND_CAP_USD, readLedger, spent } from "../../packages/asset-contract/tools/fal-ledger";
import { FAL_USD_PER_IMAGE, PANEL_HEIGHT, PANEL_WIDTH, generateOne, toPanel } from "../../packages/asset-contract/tools/story-panels";
import { STORY_PANELS } from "../../packages/asset-contract/tools/story-prompts";

const ASSETS = resolve(import.meta.dirname, "../../packages/asset-contract/assets");
const manifest = JSON.parse(readFileSync(resolve(ASSETS, "art-manifest.json"), "utf8")) as { bundles: Record<string, { alias: string; file: string }[]> };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "story-panels-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the story's panels in the contract (story mode v2, criterion 22)", () => {
  it("are thirteen rows in the URL-only story bundle, one per prompt", () => {
    const rows = manifest.bundles["story"]!;
    expect(rows.map((row) => row.alias).sort()).toEqual(STORY_PANELS.map((panel) => panel.alias).sort());
    for (const panel of STORY_PANELS) expect(rows.find((row) => row.alias === panel.alias)!.file).toBe(`production/story/${panel.file}`);
  });

  it("keep every story picture out of every other bundle, and the story bundle to story pictures", () => {
    for (const [name, rows] of Object.entries(manifest.bundles)) {
      if (name === "story") continue;
      expect(rows.filter((row) => row.alias.startsWith("story.")), name).toEqual([]);
    }
    const bundles = Object.fromEntries(CORE_BUNDLES.map((name) => [name, [] as unknown[]]));
    const panel = { ...manifest.bundles["story"]![0]! };
    expect(() => parseArtManifest({ version: 1, brief: "fixture", bundles: { ...bundles, story: [panel], gameplay: [panel] } })).toThrow(/story bundle only/);
  });

  it("weigh what the spec allows, one by one and together", () => {
    const sizes = manifest.bundles["story"]!.map((row) => readFileSync(resolve(ASSETS, row.file)).length);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(STORY_PANEL_BYTES);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(STORY_SET_BYTES);
  });

  it("refuses a story picture over its byte budget", () => {
    const big = new PNG({ width: 480, height: 270 });
    const row = { ...manifest.bundles["story"]![0]!, file: "big.png" };
    writeFileSync(resolve(dir, "big.png"), Buffer.concat([PNG.sync.write(big), Buffer.alloc(STORY_PANEL_BYTES)]));
    const bundles = Object.fromEntries(CORE_BUNDLES.map((name) => [name, name === "story" ? [row] : []]));
    const issues = validateAssets(dir, parseArtManifest({ version: 1, brief: "fixture", bundles })).issues.map((issue) => issue.problem);
    expect(issues.some((problem) => /over the 90 KB/.test(problem))).toBe(true);
  });

  it("are rebuilt from their kept sources byte for byte", () => {
    for (const panel of STORY_PANELS) {
      const source = PNG.sync.read(readFileSync(resolve(ASSETS, "source/story", panel.file)));
      const built = toPanel(source, PANEL_WIDTH, PANEL_HEIGHT);
      const shipped = PNG.sync.read(readFileSync(resolve(ASSETS, "production/story", panel.file)));
      expect(Buffer.compare(built.data, shipped.data), panel.file).toBe(0);
      expect(measureGrain(shipped).grain, panel.file).toBeLessThanOrEqual(0.1);
    }
  }, 120_000); // Thirteen full-size sources decoded and rebuilt: about 20 s on a busy 8-vCPU pod.
});

describe("the fal ledger (story mode v2, criterion 23)", () => {
  const panel = STORY_PANELS[0]!;
  const fakeFetch = () => {
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    return vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith("https://fal.run/")
        ? new Response(JSON.stringify({ images: [{ url: "https://fal.media/x.png" }] }), { status: 200 })
        : new Response(new Uint8Array(png), { status: 200 }),
    );
  };

  it("records each call and stays inside the cap", () => {
    const ledger = readLedger(resolve(ASSETS, "source/story/fal-ledger.jsonl"));
    expect(spent(ledger)).toBeLessThanOrEqual(SPEND_CAP_USD);
    // Every kept source came out of a recorded call.
    for (const kept of STORY_PANELS) {
      const name = kept.file.replace(/\.png$/, "");
      expect(ledger.rows.some((row) => row.name.startsWith(`${name}-`)), name).toBe(true);
    }
  });

  it("writes a row for a call it makes", async () => {
    const ledgerPath = resolve(dir, "ledger.jsonl");
    const fetch = fakeFetch();
    await generateOne(panel, 1, { fetch: fetch as unknown as typeof globalThis.fetch, key: "k", ledgerPath, outDir: dir, now: () => new Date(0) });
    expect(readLedger(ledgerPath).rows).toEqual([{ at: new Date(0).toISOString(), model: "fal-ai/nano-banana/edit", name: "story-lowtown-1", usd: FAL_USD_PER_IMAGE }]);
  });

  it("refuses a call that would pass the cap, without calling anything", async () => {
    const ledgerPath = resolve(dir, "ledger.jsonl");
    const rows = Math.floor(SPEND_CAP_USD / FAL_USD_PER_IMAGE);
    writeFileSync(ledgerPath, `${Array.from({ length: rows }, (_, k) => JSON.stringify({ at: "t", model: "m", name: `n-${k}`, usd: FAL_USD_PER_IMAGE })).join("\n")}\n`);
    const fetch = fakeFetch();
    await expect(generateOne(panel, 1, { fetch: fetch as unknown as typeof globalThis.fetch, key: "k", ledgerPath, outDir: dir, now: () => new Date(0) })).rejects.toThrow(/refused/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
