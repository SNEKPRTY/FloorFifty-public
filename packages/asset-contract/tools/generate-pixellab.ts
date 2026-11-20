/**
 * `pnpm assets:generate`.
 *
 * Procures the PixelLab half of the art set: one 32 x 32 sidescroller ninja,
 * five animations, and the four seat recolours and portraits derived from them.
 * It requires `PIXELLAB_API_KEY` in `.env.local`, and it spends generation
 * quota, so it is a manual step rather than part of the build.
 *
 * **Why this endpoint.** Floor Fifty is a 2D sidescroller, so a character needs
 * one facing, not eight. `create-1-direction-object` with `view: "sidescroller"`
 * is the only character endpoint that has no rotations at all -- its animation
 * route refuses a `directions` argument outright. The 8-rotation endpoint was
 * tried first and seven of its eight outputs were waste, while the two true
 * profiles came back cropped.
 *
 * **Why it is cheap.** At `size: 32` the generator returns 64 candidate sprites
 * from a single generation, so the base sprite is chosen by measurement across
 * a field rather than accepted from a single roll.
 *
 * **What is pinned here and why.** `SOURCE_OBJECT` and `FRAME_PICKS` fix the
 * reviewed result. The model is not deterministic, and its animator redraws
 * each frame rather than posing the sprite, so frames drift in identity --
 * measured at 9-14% of swatch usage on `run` and 20-26% on `fall`, where the
 * mask comes off the face. The picks below were chosen against that
 * measurement, and pinning them is what stops a regeneration quietly shipping
 * worse art than the art that was reviewed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { PLAYER_COLORS, type PlayerColorName } from "../src/roles";
import { nearestSwatch, swatchRgb, type SwatchIndex } from "../src/swatches";
import { inkBounds } from "./ink-bounds";
import { PixelCanvas } from "./pixel-canvas";
import { readApiKey } from "./pixellab-client";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OUT = resolve(import.meta.dirname, "..", "assets", "production");
const CACHE = resolve(import.meta.dirname, "..", ".pixellab-cache");
const BASE_URL = "https://api.pixellab.ai/v2";

/** Sprite frame, and the cell the sheet is cut into. */
const FRAME = 32;

/**
 * The reviewed object.
 *
 * Its prompt is `DESCRIPTION`, and both travel in the manifest's provenance, so
 * the manifest alone is enough to re-derive the whole character set.
 */
const SOURCE_OBJECT: string | undefined = "74a5b92c-be63-4add-a484-ad8c68c2ef06";

const DESCRIPTION =
  "cute chibi ninja runner, super deformed with a big round head and small body, " +
  "thick dark navy outline, flat bright colors with only two tones per material, " +
  "no interior detail, bold readable silhouette, standing";

/** The five rows, and the motion each was generated from. */
const ANIMATIONS = [
  { name: "idle", description: "standing still, breathing" },
  { name: "run", description: "running fast to the right" },
  { name: "jump", description: "leaping upward with knees tucked" },
  { name: "fall", description: "falling downward with arms raised" },
  { name: "land", description: "landing in a deep crouch" },
] as const;

/**
 * Which generated frame goes in which cell, per row.
 *
 * The animator returns five frames -- the reference pose plus four -- and the
 * contract ships two, four, one, one and two. These indices are that selection,
 * made against measured identity drift rather than by eye: the frame that
 * wanders furthest from the base sprite's swatch histogram is the frame where
 * the mask comes off, and it is not shipped however good its pose is.
 *
 * `land` runs 2 then 1 because the row reads deep-crouch into rising, which is
 * the order the motion happens in and the reverse of the order it generated in.
 */
const FRAME_PICKS: Record<string, number[]> = {
  idle: [0, 1],
  run: [1, 2, 3, 4],
  jump: [2],
  fall: [4],
  land: [2, 1],
};

/**
 * The outfit as it arrives -- shadow, body, highlight -- and each seat's hue.
 *
 * The middle entry of every seat ramp is that seat's `PLAYER_COLORS` value, so
 * a racer's sprite and its HUD row resolve the same swatch. Belt, straps and
 * skin sit outside the ramp and stay identical across all four seats, which is
 * what makes colour the only difference between racers.
 */
const SOURCE_RAMP: SwatchIndex[] = [49, 50, 51];
const SEAT_RAMPS: Record<PlayerColorName, SwatchIndex[]> = {
  scarlet: [14, 15, 61],
  cyan: [46, 47, 48],
  gold: [20, 16, 22],
  violet: [50, 51, 52],
};

async function api(key: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PixelLab ${path} (${response.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Downloads once, then serves from disk, so a re-run costs no quota. */
async function cached(url: string, name: string): Promise<PNG> {
  mkdirSync(CACHE, { recursive: true });
  const path = resolve(CACHE, name);
  if (!existsSync(path)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not fetch ${name} (${response.status})`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  return PNG.sync.read(readFileSync(path));
}

/**
 * Copies one frame into the sheet.
 *
 * Nothing is re-seated. Every frame the animator returns is already registered
 * against the reference pose, and nudging them here would break the one thing
 * that registration guarantees.
 */
function blitFrame(sheet: PixelCanvas, frame: PNG, atX: number, atY: number): void {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const index = (y * frame.width + x) * 4;
      const alpha = frame.data[index + 3] ?? 0;
      if (alpha === 0) continue;
      sheet.set(atX + x, atY + y, [
        frame.data[index] ?? 0,
        frame.data[index + 1] ?? 0,
        frame.data[index + 2] ?? 0,
        alpha,
      ]);
    }
  }
}

/** Every opaque pixel snapped to its nearest swatch, in place. */
function toPalette(png: PNG): void {
  for (let i = 0; i < png.data.length; i += 4) {
    if ((png.data[i + 3] ?? 0) === 0) continue;
    const [r, g, b] = swatchRgb(nearestSwatch(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!));
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
  }
}

/** One seat's sheet: the base recoloured through its ramp. */
function recolourSeat(base: PNG, ramp: SwatchIndex[]): PNG {
  const out = new PNG({ width: base.width, height: base.height });
  for (let i = 0; i < base.data.length; i += 4) {
    const alpha = base.data[i + 3] ?? 0;
    out.data[i + 3] = alpha;
    if (alpha === 0) continue;
    // Read the source every time. A seat ramp may reuse a source swatch --
    // violet's shadow is the base's body -- and sampling the destination would
    // recolour those pixels twice.
    const swatch = nearestSwatch(base.data[i]!, base.data[i + 1]!, base.data[i + 2]!);
    const slot = SOURCE_RAMP.indexOf(swatch);
    const [r, g, b] = swatchRgb(slot >= 0 ? ramp[slot]! : swatch);
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
  }
  return out;
}

/**
 * A bust cropped from the racer's own standing pose.
 *
 * Generated separately in the first pass, which produced four faces that
 * matched no racer on screen. Cropping guarantees the badge beside a name is
 * the character that name belongs to, and it costs no quota.
 */
function portrait(seat: PNG): PNG {
  const standing = new PNG({ width: FRAME, height: FRAME });
  PNG.bitblt(seat, standing, 0, 0, FRAME, FRAME, 0, 0);

  const bounds = inkBounds(standing);
  if (bounds === null) throw new Error("a recoloured sheet is empty");
  // Head and shoulders: the top half of the standing pose's ink.
  const height = Math.ceil((bounds.bottom - bounds.top + 1) * 0.55);
  const width = bounds.right - bounds.left + 1;

  const out = new PNG({ width: FRAME, height: FRAME });
  PNG.bitblt(
    standing,
    out,
    bounds.left,
    bounds.top,
    width,
    height,
    Math.floor((FRAME - width) / 2),
    Math.floor((FRAME - height) / 2),
  );
  return out;
}

async function animationFrames(key: string, object: string): Promise<Map<string, string[]>> {
  const detail = await api(key, `/objects/${object}`);
  const rows = (detail["animations"] ?? []) as {
    display_name?: string;
    directions?: { storage_urls?: { frames?: string[] } }[];
  }[];

  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const frames = row.directions?.[0]?.storage_urls?.frames;
    if (row.display_name === undefined || frames === undefined) continue;
    byName.set(row.display_name, frames);
  }

  const missing = ANIMATIONS.filter((a) => !byName.has(a.name)).map((a) => a.name);
  if (missing.length > 0) {
    throw new Error(`object ${object} is missing animations: ${missing.join(", ")}`);
  }
  return byName;
}

async function main(): Promise<void> {
  const key = readApiKey(REPO_ROOT);
  if (SOURCE_OBJECT === undefined) {
    throw new Error(
      "SOURCE_OBJECT is unset. Create one with POST /create-1-direction-object " +
        `{ description: ${JSON.stringify(DESCRIPTION)}, size: 32, view: "sidescroller" }, ` +
        "promote the best of its 64 candidates with /select-frames, add the five " +
        `animations (${ANIMATIONS.map((a) => a.name).join(", ")}), then record the id here.`,
    );
  }

  process.stdout.write(`composing from PixelLab object ${SOURCE_OBJECT}:\n`);
  const frames = await animationFrames(key, SOURCE_OBJECT);

  const columns = Math.max(...Object.values(FRAME_PICKS).map((picks) => picks.length));
  const sheet = new PixelCanvas(FRAME * columns, FRAME * ANIMATIONS.length);

  for (const [row, animation] of ANIMATIONS.entries()) {
    const urls = frames.get(animation.name)!;
    const picks = FRAME_PICKS[animation.name]!;
    for (const [column, pick] of picks.entries()) {
      const url = urls[pick];
      if (url === undefined) throw new Error(`${animation.name} has no frame ${pick}`);
      blitFrame(sheet, await cached(url, `${animation.name}-${pick}.png`), column * FRAME, row * FRAME);
    }
    process.stdout.write(`  ${animation.name}: ${picks.length} frame(s)\n`);
  }

  // On-palette before the recolour, not after: the ramp match is exact, so a
  // body pixel one step off its swatch would silently keep the base colour.
  const base = PNG.sync.read(sheet.toBuffer());
  toPalette(base);

  for (const seat of Object.keys(PLAYER_COLORS) as PlayerColorName[]) {
    const recoloured = recolourSeat(base, SEAT_RAMPS[seat]);
    writeFileSync(resolve(OUT, `ninja-${seat}.png`), PNG.sync.write(recoloured));
    writeFileSync(resolve(OUT, `portrait-${seat}.png`), PNG.sync.write(portrait(recoloured)));
    process.stdout.write(`  wrote ninja-${seat}.png and portrait-${seat}.png\n`);
  }

  process.stdout.write(
    "\ndone. Everything else is drawn by `pnpm assets:placeholder` and `pnpm assets:city`.\n" +
      "Run `pnpm assets:check`, then review against docs/art/resurrect-arcade-brief.md.\n",
  );
}

await main();
