/**
 * `pnpm assets:stills <stage-id>…`: the stage select's preview still,
 * composed from a stage's own layer list and a few platforms from its real
 * course.
 *
 * A stage is described by its TOML and drawn from the art the manifest holds
 * for it, so this needs no image API: a 960 x 540 frame of the sky, the
 * skylines and the props, three rising platforms from the course's own floors,
 * then a 640 x 240 preview of its middle band. Nearest-neighbour throughout keeps every pixel a swatch, and a
 * final pass moves any seam pixel onto the palette.
 *
 * It lives in `content` because of what it reads: the parser, the courses and
 * the manifest. `asset-contract` depends on none of the first two, and giving
 * it `content` would make a cycle. It reads the stage TOMLs, not the artifact,
 * because a new stage cannot join a pack until its still exists.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { allAssets, parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { nearestSwatch, swatchRgb } from "@floor-fifty/asset-contract/swatches";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { formatDiagnostic } from "../src/diagnostics";
import { parseSources } from "../src/parse";
import { readSources } from "../src/read-sources";

const ROOT = resolve(import.meta.dirname, "../../..");
const ASSETS = resolve(ROOT, "packages/asset-contract/assets");

const FRAME = { width: 960, height: 540 } as const;
/** The platform frame, the top of the sheet: `stationary` over `moving`. */
const PLATFORM = { width: 128, height: 32 } as const;
/** Where the three platforms' tops sit, low to high, so they read as a climb. */
const PLATFORM_TOPS = [400, 330, 260] as const;
/**
 * Where a layer with no sink would stand its foot, in frame pixels. Chosen by
 * eye against the before captures' teach phrase: the near rooftops' tops land
 * just above the frame's middle and the details run off its foot.
 */
const CITY_FOOT_LINE = 440;
/** The preview is the frame's middle band, where the platforms are. */
const PREVIEW_BAND = { top: 150, height: 360 } as const;

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error("usage: pnpm assets:stills <stage-id>…");

const manifest = parseArtManifest(JSON.parse(readFileSync(resolve(ASSETS, "art-manifest.json"), "utf8")));
const files = new Map(allAssets(manifest).map(({ asset }) => [asset.alias, asset.file]));

const parsed = parseSources(await readSources(resolve(ROOT, "content")));
if (!parsed.ok) {
  process.stderr.write(`${parsed.diagnostics.map(formatDiagnostic).join("\n")}\n`);
  process.exit(1);
}
const base = resolveTuning(parsed.parsed.tuning.value as Parameters<typeof resolveTuning>[0]);

const load = (alias: string): PNG => {
  const file = files.get(alias);
  if (file === undefined) throw new Error(`no asset in the manifest is aliased ${alias}`);
  return PNG.sync.read(readFileSync(resolve(ASSETS, file)));
};

/** Source-over of `source` onto `target` at (dx, dy), clipped to the target. */
function draw(target: PNG, source: PNG, dx: number, dy: number, scaleTo?: { width: number; height: number }): void {
  const width = scaleTo?.width ?? source.width;
  const height = scaleTo?.height ?? source.height;
  for (let y = 0; y < height; y += 1) {
    const ty = dy + y;
    if (ty < 0 || ty >= target.height) continue;
    const sy = scaleTo === undefined ? y : Math.floor(((y + 0.5) * source.height) / height);
    for (let x = 0; x < width; x += 1) {
      const tx = dx + x;
      if (tx < 0 || tx >= target.width) continue;
      const sx = scaleTo === undefined ? x : Math.floor(((x + 0.5) * source.width) / width);
      const from = (sy * source.width + sx) * 4;
      if (source.data[from + 3] === 0) continue;
      const to = (ty * target.width + tx) * 4;
      target.data[to] = source.data[from]!;
      target.data[to + 1] = source.data[from + 1]!;
      target.data[to + 2] = source.data[from + 2]!;
      target.data[to + 3] = 255;
    }
  }
}

/** Nearest-neighbour crop and scale, so no new colour is made. */
function sample(from: PNG, crop: { top: number; height: number }, size: { width: number; height: number }): PNG {
  const out = new PNG({ width: size.width, height: size.height });
  for (let y = 0; y < size.height; y += 1) {
    const sy = crop.top + Math.floor(((y + 0.5) * crop.height) / size.height);
    for (let x = 0; x < size.width; x += 1) {
      const sx = Math.floor(((x + 0.5) * from.width) / size.width);
      const source = (sy * from.width + sx) * 4;
      const to = (y * size.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) out.data[to + channel] = from.data[source + channel]!;
    }
  }
  return out;
}

/** Moves every opaque pixel onto the palette, as `quantizeFile` does; written out because `tools/` is not exported. */
function lockToPalette(png: PNG): void {
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 3] === 0) continue;
    const [r, g, b] = swatchRgb(nearestSwatch(png.data[index]!, png.data[index + 1]!, png.data[index + 2]!));
    png.data[index] = r;
    png.data[index + 1] = g;
    png.data[index + 2] = b;
    png.data[index + 3] = 255;
  }
}

for (const id of ids) {
  const stage = parsed.parsed.stages.map((located) => located.value).find((candidate) => candidate.id === id);
  if (stage === undefined) throw new Error(`no stage file declares ${id}`);
  const { theme } = stage;

  const frame = new PNG({ width: FRAME.width, height: FRAME.height });
  // The stage's layers, back to front, as the race draws them at the start of
  // the climb (`theme.layers`). A sky plate is stretched to the frame; every
  // other layer stands at native size with its foot `sink` below one shared
  // line, the way a larger sink stands a strip lower in the race, and a strip
  // that ends above the frame's foot continues its last row down, as the
  // race's skirt does. The line stands the skylines in the lower half, so the
  // still keeps the sky above them that the race's opening floors show.
  const footLine = CITY_FOOT_LINE;
  for (const layer of theme.layers) {
    const plate = load(layer.alias);
    if (layer.extend === "plate") {
      draw(frame, plate, 0, 0, FRAME);
      continue;
    }
    const foot = footLine + layer.sink;
    draw(frame, plate, 0, foot - plate.height);
    if (layer.extend === "skirt") {
      const lastRow = new PNG({ width: plate.width, height: 1 });
      plate.data.copy(lastRow.data, 0, (plate.height - 1) * plate.width * 4);
      draw(frame, lastRow, 0, foot, { width: plate.width, height: Math.max(0, FRAME.height - foot) });
    }
  }

  // Three floors of the stage's real course, the sheet's `stationary` frame at each.
  const sheet = load(stage.platformAlias);
  const platform = new PNG({ width: PLATFORM.width, height: PLATFORM.height });
  for (let y = 0; y < PLATFORM.height; y += 1) {
    for (let x = 0; x < PLATFORM.width; x += 1) {
      const from = (y * sheet.width + x) * 4;
      const to = (y * PLATFORM.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) platform.data[to + channel] = sheet.data[from + channel]!;
    }
  }
  if (stage.course === undefined) throw new Error(`${id} freezes no course; its still needs one`);
  if (Object.keys(stage.courseTuning).length > 0) throw new Error(`${id} tunes its course; compose-stills reads the base tuning only`);
  const course = createCourse(stage.course.seed, base);
  const span = course.bounds.right - course.bounds.left;
  course.floors.slice(1, 4).forEach((floor, index) => {
    const centre = ((floor.x - course.bounds.left) / span) * FRAME.width;
    draw(frame, platform, Math.round(centre - PLATFORM.width / 2), PLATFORM_TOPS[index]!);
  });

  const preview = sample(frame, PREVIEW_BAND, { width: 640, height: 240 });
  lockToPalette(preview);
  writeFileSync(resolve(ASSETS, `production/still-${id}-preview.png`), PNG.sync.write(preview));
  process.stdout.write(`  still-${id}-preview.png\n`);
}
