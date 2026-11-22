/**
 * Asset validation.
 *
 * The schema proves a manifest is well-formed; this proves the files it points
 * at are the files it promised. Both matter, and they fail differently: a bad
 * manifest is a typo, while a bad file is usually a PixelLab export that lost
 * its alpha channel or came back at the wrong scale.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import {
  KNOWN_EMPTY_BUNDLES,
  allAssets,
  expectedFileSize,
  isAudioAsset,
  isCoverAsset,
  isDemoAsset,
  type ArtAsset,
  type ArtManifest,
  type AudioAsset,
  type BundleName,
  type CoverAsset,
  type DemoAsset,
  type VisualAsset,
} from "./manifest-schema";
import { DEFAULT_MAX_GRAIN, measureGrain } from "./pixel-grain";
import { RESURRECT64, swatchRgb } from "./swatches";
import { webpSize } from "./webp-size";

/** Every swatch as a packed 24-bit key, built once per process. */
const SWATCH_KEYS: ReadonlySet<number> = new Set(
  RESURRECT64.map((_, index) => {
    const [r, g, b] = swatchRgb(index);
    return (r << 16) | (g << 8) | b;
  }),
);

/**
 * Opaque pixels in a file that are not palette swatches.
 *
 * Fully transparent pixels carry no colour a player can see, so their channels
 * are whatever the exporter left behind and are not held to the contract.
 * A sample of the offending colours is returned because "1,482 bad pixels" does
 * not tell an author what to fix, and "#3f2a19 appears 1,482 times" does.
 */
export function offPalettePixels(path: string): { count: number; sample: string[] } {
  return offPaletteIn(PNG.sync.read(readFileSync(path)));
}

/** `offPalettePixels` on an image already decoded, so the gate decodes each file once. */
function offPaletteIn(png: PNG): { count: number; sample: string[] } {
  const seen = new Map<number, number>();
  let count = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 3] === 0) continue;
    const key =
      ((png.data[index] ?? 0) << 16) |
      ((png.data[index + 1] ?? 0) << 8) |
      (png.data[index + 2] ?? 0);
    if (SWATCH_KEYS.has(key)) continue;
    count += 1;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const sample = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => `#${key.toString(16).padStart(6, "0")}`);

  return { count, sample };
}

/** The share of rows whose two edge columns disagree about being drawn. */
export function seamMismatch(png: PNG): number {
  let rows = 0;
  for (let y = 0; y < png.height; y += 1) {
    const left = png.data[y * png.width * 4 + 3]! > 0;
    const right = png.data[(y * png.width + png.width - 1) * 4 + 3]! > 0;
    if (left !== right) rows += 1;
  }
  return rows / png.height;
}

/** Whether a sky plate's top and bottom bands repeat cleanly (`StageLayers.buildSkyBand`). */
export function bandRepeats(png: PNG, rows = 16): boolean {
  const half = rows / 2;
  const rowBytes = png.width * 4;
  const same = (a: number, b: number): boolean =>
    png.data.subarray(a * rowBytes, (a + 1) * rowBytes).equals(png.data.subarray(b * rowBytes, (b + 1) * rowBytes));
  for (let y = 0; y < half; y += 1) {
    if (!same(y, y + half)) return false;
    if (!same(png.height - rows + y, png.height - half + y)) return false;
  }
  return true;
}

/** How much of a tiled strip's height may disagree across its seam. */
export const SEAM_TOLERANCE = 0.02;

export type AssetIssue = {
  alias: string;
  file: string;
  problem: string;
};

export type AssetValidationResult = {
  ok: boolean;
  checked: number;
  issues: AssetIssue[];
};

type PngFacts = {
  width: number;
  height: number;
  hasTransparency: boolean;
  opaqueCorners: boolean;
};

/**
 * Reads the facts the contract cares about out of a PNG.
 *
 * Transparency is measured from the pixels rather than from the declared colour
 * type, because an exporter that writes RGBA and then fills every alpha byte
 * with `255` has produced an opaque image whatever its header says.
 */
function pngFacts(png: PNG): PngFacts {
  let hasTransparency = false;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index] === 255) continue;
    hasTransparency = true;
    break;
  }

  // Corner opacity is the reliable tell for a sprite exported onto a filled
  // background: a cut-out sprite is transparent at all four corners.
  const cornerIndices = [
    0,
    (png.width - 1) * 4,
    (png.height - 1) * png.width * 4,
    ((png.height - 1) * png.width + (png.width - 1)) * 4,
  ];
  const opaqueCorners = cornerIndices.every((index) => (png.data[index + 3] ?? 255) > 0);

  return { width: png.width, height: png.height, hasTransparency, opaqueCorners };
}

/**
 * Checks one audio row against the file on disk.
 *
 * Only the facts a reader can establish without a decoder: that the file is
 * there and is not empty. Duration, loudness, and loop bounds are measured at
 * authoring time and cross-checked by the schema; re-deriving them here would
 * mean shipping an audio decoder inside the asset gate to re-answer a question
 * the manifest already records.
 */
function validateAudioAsset(root: string, asset: AudioAsset): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const report = (problem: string): void => {
    issues.push({ alias: asset.alias, file: asset.file, problem });
  };

  for (const field of ["tool", "prompt", "source", "license"] as const) {
    if (asset.provenance[field]) continue;
    report(`missing provenance.${field}; an asset nobody can regenerate cannot be fixed`);
  }

  try {
    const { size } = statSync(resolve(root, asset.file));
    if (size === 0) report(`${asset.file} is empty`);
  } catch (error) {
    report(`could not read ${asset.file}: ${(error as Error).message}`);
  }

  return issues;
}

/**
 * Checks one cover against its row: there, a WebP, and the size the row says.
 * No palette and no grain budget: a cover is smooth UI art, not world art.
 */
function validateCoverAsset(root: string, asset: CoverAsset): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const report = (problem: string): void => {
    issues.push({ alias: asset.alias, file: asset.file, problem });
  };
  for (const field of ["tool", "prompt", "source", "license"] as const) {
    if (asset.provenance[field]) continue;
    report(`missing provenance.${field}; an asset nobody can regenerate cannot be fixed`);
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(resolve(root, asset.file));
  } catch (error) {
    report(`could not read ${asset.file}: ${(error as Error).message}`);
    return issues;
  }
  const size = webpSize(bytes);
  if (size === undefined) report(`${asset.file} is not a WebP`);
  else if (size.width !== asset.width || size.height !== asset.height)
    report(`expected ${asset.width}x${asset.height}, found ${size.width}x${size.height}`);
  return issues;
}

/** The carousel's slides, in order: each has a clip (`demo.<slide>`) and a still (`demo.<slide>Still`). */
export const DEMO_SLIDES = ["steer", "bounce", "dropFast", "movingFloors", "lava", "race"] as const;
/**
 * The slides that have a recording: all six. The race's is four racers, recorded from the replay of a real
 * four-seat race on stepped frames (`demo-capture.spec.ts`, "records the race demo").
 */
export const RECORDED_SLIDES = DEMO_SLIDES;
/** The most bytes one clip may weigh, one still, and the six clips together (story-mode spec, "Size budget"). */
export const DEMO_CLIP_BYTES = 350 * 1024;
export const DEMO_STILL_BYTES = 30 * 1024;
export const DEMO_SET_BYTES = 1.8 * 1024 * 1024;

/**
 * Checks one demo against its row: there, a WebP, the size the row says and
 * inside its byte budget. Recordings of the game, so no palette applies.
 */
function validateDemoAsset(root: string, asset: DemoAsset): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const report = (problem: string): void => {
    issues.push({ alias: asset.alias, file: asset.file, problem });
  };
  for (const field of ["tool", "prompt", "source", "license"] as const) {
    if (asset.provenance[field]) continue;
    report(`missing provenance.${field}; an asset nobody can regenerate cannot be fixed`);
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(resolve(root, asset.file));
  } catch (error) {
    report(`could not read ${asset.file}: ${(error as Error).message}`);
    return issues;
  }
  const size = webpSize(bytes);
  if (size === undefined) report(`${asset.file} is not a WebP`);
  else if (size.width !== asset.width || size.height !== asset.height)
    report(`expected ${asset.width}x${asset.height}, found ${size.width}x${size.height}`);
  const limit = asset.kind === "clip" ? DEMO_CLIP_BYTES : DEMO_STILL_BYTES;
  if (bytes.length > limit) report(`${asset.file} is ${bytes.length} bytes, over the ${limit / 1024} KB a ${asset.kind} may be`);
  return issues;
}

/** The set as a whole: every slide has both rows, and the clips together stay inside their budget. */
function validateDemoSet(root: string, demos: readonly DemoAsset[]): AssetIssue[] {
  if (demos.length === 0) return [];
  const issues: AssetIssue[] = [];
  const byAlias = new Map(demos.map((demo) => [demo.alias, demo]));
  for (const slide of RECORDED_SLIDES) {
    if (!byAlias.has(`demo.${slide}`)) issues.push({ alias: `demo.${slide}`, file: "-", problem: "no row for this slide's clip" });
    if (!byAlias.has(`demo.${slide}Still`)) issues.push({ alias: `demo.${slide}Still`, file: "-", problem: "no row for this slide's still" });
  }
  let clipBytes = 0;
  for (const clip of demos.filter((demo) => demo.kind === "clip")) {
    try {
      clipBytes += statSync(resolve(root, clip.file)).size;
    } catch {
      // Unreadable: the row's own check says so.
    }
  }
  if (clipBytes > DEMO_SET_BYTES)
    issues.push({ alias: "demo.*", file: "-", problem: `the clips are ${clipBytes} bytes, over the ${(DEMO_SET_BYTES / 1024 / 1024).toFixed(1)} MB the set may be` });
  return issues;
}

/** Checks one visual asset against its declaration. */
function validateAsset(root: string, asset: VisualAsset): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const path = resolve(root, asset.file);
  const report = (problem: string): void => {
    issues.push({ alias: asset.alias, file: asset.file, problem });
  };

  // Provenance is re-checked here rather than trusted from the schema, because
  // `validateAssets` is also the gate a hand-edited manifest passes through.
  const provenance = asset.provenance as Partial<ArtAsset["provenance"]> | undefined;
  for (const field of ["tool", "prompt", "source", "license"] as const) {
    if (provenance?.[field]) continue;
    report(`missing provenance.${field}; an asset nobody can regenerate cannot be fixed`);
  }

  if (asset.paletteRoles.length === 0) {
    report("declares no palette role");
  }

  // Decoded once: the size, alpha, grain, seam, band and palette checks below
  // all read these pixels, and decoding is the whole of this gate's cost.
  let decoded: PNG;
  try {
    decoded = PNG.sync.read(readFileSync(path));
  } catch (error) {
    report(`could not read ${asset.file}: ${(error as Error).message}`);
    return issues;
  }
  const facts = pngFacts(decoded);

  const expected = expectedFileSize(asset);
  if (facts.width !== expected.width || facts.height !== expected.height) {
    report(
      `expected ${expected.width}x${expected.height}, found ${facts.width}x${facts.height}`,
    );
  }

  if (asset.requiresAlpha && !facts.hasTransparency) {
    report("requires an alpha channel but every pixel in the file is opaque");
  }
  if (asset.requiresAlpha && facts.opaqueCorners) {
    report("background is not transparent: all four corners are opaque");
  }

  // Sub-two-pixel detail, against the budget this asset declares. The check
  // exists because the simplification passes are something a generator script
  // calls, and a new asset that never calls them would otherwise ship grainy
  // with nothing to say so.
  const budget = asset.maxGrain?.budget ?? DEFAULT_MAX_GRAIN;
  const { grain } = measureGrain(decoded);
  if (grain > budget) {
    report(
      `${(grain * 100).toFixed(1)}% of its pixels belong to no 2x2 block of their own ` +
        `colour, over a budget of ${(budget * 100).toFixed(1)}%. Either run the ` +
        `simplification passes over it, or raise \`maxGrain\` and say why.`,
    );
  }

  // A tiled strip meets itself at the seam, and a sky plate's edge bands are
  // repeated up and down a tall screen; either break shows as a hard line.
  if (asset.role === "image" && asset.tilesHorizontally) {
    const m = seamMismatch(decoded);
    if (m > SEAM_TOLERANCE) report(`${asset.alias}: ${(m * 100).toFixed(1)}% of rows break at the seam`);
  }
  if (asset.role === "image" && asset.skyPlate && !bandRepeats(decoded)) {
    report(`${asset.alias}: its edge bands do not repeat`);
  }

  const offPalette = offPaletteIn(decoded);
  if (offPalette.count > 0) {
    report(
      `${offPalette.count} pixels are not Resurrect 64 swatches ` +
        `(most common: ${offPalette.sample.join(", ")}). Run \`pnpm assets:quantize\`.`,
    );
  }

  return issues;
}

/**
 * Validates every asset a manifest declares against the files on disk.
 *
 * `root` is the directory manifest paths are relative to. A bundle listed in
 * `KNOWN_EMPTY_BUNDLES` is allowed to be empty; any other empty bundle is a
 * missing export rather than an intentional gap.
 */
export function validateAssets(root: string, manifest: ArtManifest): AssetValidationResult {
  const issues: AssetIssue[] = [];

  for (const [bundle, assets] of Object.entries(manifest.bundles) as [BundleName, ArtAsset[]][]) {
    if (assets.length > 0) continue;
    if (KNOWN_EMPTY_BUNDLES.includes(bundle)) continue;
    issues.push({
      alias: `${bundle}.*`,
      file: "-",
      problem: `bundle "${bundle}" declares no assets`,
    });
  }

  const entries = allAssets(manifest);
  for (const { asset } of entries) {
    issues.push(
      ...(isAudioAsset(asset)
        ? validateAudioAsset(root, asset)
        : isCoverAsset(asset)
          ? validateCoverAsset(root, asset)
          : isDemoAsset(asset)
            ? validateDemoAsset(root, asset)
            : validateAsset(root, asset)),
    );
  }
  issues.push(
    ...validateDemoSet(
      root,
      entries.map((entry) => entry.asset).filter(isDemoAsset),
    ),
  );


  return { ok: issues.length === 0, checked: entries.length, issues };
}

/** Renders a result as the report `pnpm assets:check` prints. */
export function formatValidationResult(result: AssetValidationResult): string {
  if (result.ok) return `art contract: ${result.checked} assets validated`;
  const lines = result.issues.map((issue) => `  ${issue.alias} (${issue.file}): ${issue.problem}`);
  return [`art contract: ${result.issues.length} problem(s)`, ...lines].join("\n");
}
