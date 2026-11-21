/**
 * The work behind `pnpm assets:story <command>` (`generate-story-panels.ts`): the story's cutscene panels (story mode v2 spec, "Art").
 *
 *   generate <name…> [--candidates 3]   asks fal.ai for candidates of the named panels
 *   pick <name> <k>                     keeps candidate k as the panel's committed source
 *   build                               turns every kept source into its 480 by 270 panel
 *
 * `<name>` is a panel's file name without `.png` (`story-the-deep`). Candidates
 * land in `assets/source/story/candidates/` (git-ignored); the kept source is
 * committed, so a panel can be remade without a new call. Every call goes
 * through the ledger first (`fal-ledger.ts`), which refuses one past the cap.
 *
 * The build box-downscales the source to 480 by 270, moves every pixel to its
 * nearest Resurrect 64 swatch with no dithering (flat shapes, like the
 * portraits) and clears lone pixels with a 3-by-3 majority pass, so the grain
 * reads as drawn rather than as noise.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { nearestSwatch, swatchRgb } from "../src/swatches";
import { assertRoom, readLedger, record } from "./fal-ledger";
import { crop, isKey, resample } from "./source-raster";
import { STORY_PANELS, STORY_STYLE, type StoryPanelPrompt, type StoryReference } from "./story-prompts";

const ASSETS = resolve(import.meta.dirname, "..", "assets");
const SOURCE = resolve(ASSETS, "source", "story");
const CANDIDATES = resolve(SOURCE, "candidates");
const PRODUCTION = resolve(ASSETS, "production", "story");
const LEDGER = resolve(SOURCE, "fal-ledger.jsonl");

export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 270;

export const FAL_MODEL = "fal-ai/nano-banana/edit";
/** fal's listed price for one picture from this model, rounded up. */
export const FAL_USD_PER_IMAGE = 0.04;

const panelNamed = (name: string): StoryPanelPrompt => {
  const panel = STORY_PANELS.find((candidate) => candidate.file === `${name}.png`);
  if (panel === undefined) throw new Error(`no panel named ${name}`);
  return panel;
};

/** A reference as a PNG data URI, with a portrait row keyed onto white so the magenta never leaks into a panel. */
function referenceUri(reference: StoryReference): string {
  let png: PNG = PNG.sync.read(readFileSync(resolve(ASSETS, reference.file)));
  if (reference.kind === "portraitRow") {
    const rowHeight = Math.floor(png.height / 4);
    png = crop(png, 0, rowHeight * reference.row, png.width, rowHeight);
    for (let i = 0; i < png.data.length; i += 4) {
      if (isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!)) png.data.fill(255, i, i + 4);
    }
  } else if (png.width < 400) {
    png = upscale(png, Math.ceil(400 / png.width));
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function upscale(png: PNG, by: number): PNG {
  const out = new PNG({ width: png.width * by, height: png.height * by });
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const from = (Math.floor(y / by) * png.width + Math.floor(x / by)) * 4;
      const to = (y * out.width + x) * 4;
      // Transparent sprite pixels go white: the model reads alpha as black.
      if (png.data[from + 3] === 0) out.data.fill(255, to, to + 4);
      else png.data.copy(out.data, to, from, from + 4);
    }
  }
  return out;
}

export function requestBody(panel: StoryPanelPrompt): Record<string, unknown> {
  return {
    prompt: `${STORY_STYLE} ${panel.referenceNote} ${panel.prompt}`,
    image_urls: panel.references.map(referenceUri),
    num_images: 1,
    aspect_ratio: "16:9",
    output_format: "png",
  };
}

/** One candidate: refused before the call if the ledger has no room, recorded the moment it returns. */
export async function generateOne(
  panel: StoryPanelPrompt,
  candidate: number,
  options: { fetch: typeof fetch; key: string; ledgerPath: string; outDir: string; now: () => Date },
): Promise<string> {
  const ledger = readLedger(options.ledgerPath);
  assertRoom(ledger, FAL_USD_PER_IMAGE);
  const response = await options.fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${options.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(panel)),
  });
  if (!response.ok) throw new Error(`${panel.file}: fal answered ${response.status} ${await response.text()}`);
  const name = `${panel.file.replace(/\.png$/, "")}-${candidate}`;
  // Charged once it answers, whether or not the picture is kept.
  record(options.ledgerPath, readLedger(options.ledgerPath), { at: options.now().toISOString(), model: FAL_MODEL, name, usd: FAL_USD_PER_IMAGE });
  const body = (await response.json()) as { images?: { url: string }[] };
  const url = body.images?.[0]?.url;
  if (url === undefined) throw new Error(`${name}: no picture in the answer`);
  const picture = await options.fetch(url);
  const path = resolve(options.outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(await picture.arrayBuffer()));
  return path;
}

export const SOURCE_WIDTH = 960;
export const SOURCE_HEIGHT = 540;

/** fal's picture cropped to 16:9 around its centre and box-downscaled to the kept size. */
export function toSource(picture: PNG): PNG {
  const wanted = (picture.width * SOURCE_HEIGHT) / SOURCE_WIDTH;
  const cropped = wanted <= picture.height
    ? crop(picture, 0, Math.floor((picture.height - wanted) / 2), picture.width, Math.floor(wanted))
    : crop(picture, Math.floor((picture.width - (picture.height * SOURCE_WIDTH) / SOURCE_HEIGHT) / 2), 0, Math.floor((picture.height * SOURCE_WIDTH) / SOURCE_HEIGHT), picture.height);
  for (let i = 3; i < cropped.data.length; i += 4) cropped.data[i] = 255;
  return resample(cropped, 0, cropped.height - 1, SOURCE_WIDTH, SOURCE_HEIGHT);
}

/** Box-downscale, palette-lock and clean one source into a panel of `width` by `height`. */
export function toPanel(source: PNG, width: number, height: number): PNG {
  // Crop to 16:9 around the centre first, so nothing is squashed.
  const wanted = (source.width * height) / width;
  const cropped = wanted <= source.height
    ? crop(source, 0, Math.floor((source.height - wanted) / 2), source.width, Math.floor(wanted))
    : crop(source, Math.floor((source.width - (source.height * width) / height) / 2), 0, Math.floor((source.height * width) / height), source.height);
  for (let i = 3; i < cropped.data.length; i += 4) cropped.data[i] = 255;
  const small = resample(cropped, 0, cropped.height - 1, width, height);
  const swatch = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    swatch[p] = nearestSwatch(small.data[p * 4]!, small.data[p * 4 + 1]!, small.data[p * 4 + 2]!);
  }
  let cleaned = majority(swatch, width, height);
  for (let pass = 0; pass < GRAIN_PASSES; pass += 1) cleaned = joinBlocks(cleaned, width, height);
  const out = new PNG({ width, height });
  for (let p = 0; p < width * height; p += 1) {
    const [r, g, b] = swatchRgb(cleaned[p]!);
    out.data[p * 4] = r;
    out.data[p * 4 + 1] = g;
    out.data[p * 4 + 2] = b;
    out.data[p * 4 + 3] = 255;
  }
  return out;
}

/** How many times `joinBlocks` runs: two halve the grain and keep faces and outlines. */
const GRAIN_PASSES = 2;

/** True when the pixel at (x, y) sits in some 2-by-2 block of its own swatch. */
function inBlock(swatch: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const self = swatch[y * width + x];
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
    const left = x + dx;
    const top = y + dy;
    if (left < 0 || top < 0 || left + 1 >= width || top + 1 >= height) continue;
    if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([ox, oy]) => swatch[(top + oy!) * width + left + ox!] === self)) return true;
  }
  return false;
}

/**
 * The contract's grain rule (`pixel-grain.ts`) counts a pixel in no 2-by-2
 * block of its own colour as grain. A pixel like that whose neighbours mostly
 * share one other swatch takes it: dither and soft-edge noise go, while a
 * line or an eye, whose neighbours are split, stays.
 */
export function joinBlocks(swatch: Uint8Array, width: number, height: number): Uint8Array {
  const out = swatch.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (inBlock(swatch, width, height, x, y)) continue;
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const other = swatch[(y + dy) * width + x + dx]!;
          counts.set(other, (counts.get(other) ?? 0) + 1);
        }
      let best = swatch[y * width + x]!;
      let bestCount = 0;
      for (const [other, count] of counts) if (count > bestCount) [best, bestCount] = [other, count];
      if (bestCount >= 5) out[y * width + x] = best;
    }
  }
  return out;
}

/** A pixel none of whose eight neighbours shares its swatch takes the swatch most of them share. */
export function majority(swatch: Uint8Array, width: number, height: number): Uint8Array {
  const out = swatch.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const self = swatch[y * width + x]!;
      const counts = new Map<number, number>();
      let same = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const other = swatch[(y + dy) * width + x + dx]!;
          if (other === self) same += 1;
          counts.set(other, (counts.get(other) ?? 0) + 1);
        }
      }
      if (same > 0) continue;
      let best = self;
      let bestCount = 0;
      for (const [other, count] of counts) if (count > bestCount) [best, bestCount] = [other, count];
      out[y * width + x] = best;
    }
  }
  return out;
}

function build(): void {
  mkdirSync(PRODUCTION, { recursive: true });
  for (const panel of STORY_PANELS) {
    const source = resolve(SOURCE, panel.file);
    if (!existsSync(source)) {
      process.stdout.write(`${panel.file}: no kept source yet\n`);
      continue;
    }
    const png = PNG.sync.read(readFileSync(source));
    writeFileSync(resolve(PRODUCTION, panel.file), PNG.sync.write(toPanel(png, PANEL_WIDTH, PANEL_HEIGHT)));
    process.stdout.write(`${panel.file}: built\n`);
  }
}

export async function runStoryPanels(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  mkdirSync(CANDIDATES, { recursive: true });
  if (command === "generate") {
    const key = process.env["FAL_KEY"];
    if (key === undefined || key === "") throw new Error("FAL_KEY is not set");
    const at = rest.indexOf("--candidates");
    const count = at === -1 ? 3 : Number(rest[at + 1]);
    const first = rest.indexOf("--from") === -1 ? 1 : Number(rest[rest.indexOf("--from") + 1]);
    const names = rest.filter((word, index) => !word.startsWith("--") && !rest[index - 1]?.startsWith("--"));
    // Sequential, so the ledger's cap is checked against every call before it.
    for (const name of names) {
      const panel = panelNamed(name);
      const jobs = Array.from({ length: count }, (_, k) => first + k);
      for (const candidate of jobs) {
        const path = await generateOne(panel, candidate, { fetch, key, ledgerPath: LEDGER, outDir: CANDIDATES, now: () => new Date() });
        process.stdout.write(`${path}\n`);
      }
    }
  } else if (command === "pick") {
    const [name, k] = rest;
    if (name === undefined || k === undefined) throw new Error("pick <name> <k>");
    panelNamed(name);
    // Kept at 960 by 540, twice the panel: enough to remake it, a fraction of fal's bytes in history.
    const picture = PNG.sync.read(readFileSync(resolve(CANDIDATES, `${name}-${k}.png`)));
    writeFileSync(resolve(SOURCE, `${name}.png`), PNG.sync.write(toSource(picture)));
  } else if (command === "build") {
    build();
  } else {
    throw new Error("usage: assets:story generate <name…> [--candidates 3] | pick <name> <k> | build");
  }
}

