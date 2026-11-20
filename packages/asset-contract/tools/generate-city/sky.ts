import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../../src/roles";
import { swatchRgb } from "../../src/swatches";
import { contentBounds, contentBox, crop, quantizeDithered, quantizeNearest, resample } from "../source-raster";
import { powderFinishAtGrid } from "../powder";
import { BAYER, clearAlphaIslands, coarsen, despeckle } from "./cleanup";

/**
 * The gradients the tutorial's dawn is stippled along (`dawn-concept.png`).
 *
 * The sky is not one ramp by value: it runs violet to grey-teal to the pale
 * glow at the sun, and grey-teal to teal down through the fog, so a rank by
 * luma put violet bands in the middle of it. Each pair here is a fade the
 * picture actually makes.
 */
export const DAWN_SKY_GRADIENTS: readonly (readonly [RoleName, RoleName])[] = [
  ["dawnHaze", "dawnHigh"],
  ["dawnHigh", "dawnGlow"],
  ["dawnGlow", "dawnSun"],
  // The glow fades out into the grey-teal around it, not only into the pale
  // haze. Not into the violet: that pair mixes to pink, a colour the dawn has not.
  ["dawnHigh", "dawnSun"],
  ["dawnSun", "dawnSunCore"],
  ["dawnHigh", "dawnTeal"],
  ["dawnGlow", "dawnTeal"],
  ["dawnTeal", "dawnFog"],
  ["dawnHigh", "dawnFog"],
];

/** The mist's: the paler half of the fog, so the hills stay behind the haze, not in front of it. */
export const DAWN_MIST_GRADIENTS: readonly (readonly [RoleName, RoleName])[] = [
  ["dawnGlow", "dawnHigh"],
  ["dawnGlow", "dawnTeal"],
  ["dawnHigh", "dawnTeal"],
];

/**
 * How much of each dawn gradient stipples: flat bands with dithered seams, so
 * the LCD mesh and the refraction have broad areas and edges to show on.
 */
export const DAWN_STIPPLE_SPREAD = 0.35;

/** How much of the mist plate the hills take, from its foot; the rest is headroom. */
export const DAWN_MIST_SHARE = 0.55;

/** The tutorial's sky (`IMAGE_PROMPTS["dawn-sky"]`): full frame at the source's aspect, opaque, stippled. */
export function dawnSky(source: PNG): PNG {
  const out = resample(source, 0, source.height - 1, 960, 640);
  quantizeDithered(out, DAWN_SKY_GRADIENTS, 2, DAWN_STIPPLE_SPREAD);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  return out;
}

/**
 * The tutorial's misty hills (`IMAGE_PROMPTS["dawn-mist"]`): keyed, cropped to
 * the hills, stippled like the sky they fade into. Not a skyline plate: those
 * are despeckled and snapped to a grid, which would strip the stipple.
 */
export function dawnMist(source: PNG): PNG {
  const { top, bottom } = contentBounds(source);
  // The hills keep their aspect and stand in the plate's lower part: filling
  // the whole strip put them over the pyramid, which is the picture's subject.
  const hills = resample(source, top, bottom, 960, Math.round(360 * DAWN_MIST_SHARE) & ~1);
  quantizeDithered(hills, DAWN_MIST_GRADIENTS, 2, DAWN_STIPPLE_SPREAD);
  clearAlphaIslands(hills, 64, true);
  const out = new PNG({ width: 960, height: 360 });
  hills.data.copy(out.data, (360 - hills.height) * 960 * 4);
  return out;
}

/**
 * Snow Shrine's night sky: navy through blue and lavender to a pale snow haze,
 * stippled along the fades the picture actually makes.
 */
export const SNOW_SHRINE_SKY_GRADIENTS: readonly (readonly [RoleName, RoleName])[] = [
  ["cityNear", "cityMid"],
  ["cityMid", "dawnHaze"],
  ["dawnHaze", "dawnHigh"],
  ["dawnHigh", "dawnGlow"],
];

/** Sunken Dome's water: deep teal to bright teal, and the pale light shafts. */
export const SUNKEN_DOME_SKY_GRADIENTS: readonly (readonly [RoleName, RoleName])[] = [
  ["cityNear", "dawnFog"],
  ["dawnFog", "dawnTeal"],
  ["dawnTeal", "skyHigh"],
  ["dawnFog", "cityMid"],
];

/**
 * A sky plate whose top and bottom bands repeat.
 *
 * The renderer continues a sky plate beyond its edges by repeating its top
 * and bottom 16 rows (`StageLayers.buildSkyBand`), which a tall phone sees a
 * lot of. A generated sky never repeats on its own, so each edge band is
 * rewritten as two copies of the 8-row period at that edge, which the asset
 * contract's `bandRepeats` check then holds (`skyPlate` rows).
 */
export const SKY_BAND_ROWS = 16;
export function withRepeatingBands(build: (source: PNG) => PNG): (source: PNG) => PNG {
  return (source) => {
    const out = build(source);
    const row = out.width * 4;
    const half = SKY_BAND_ROWS / 2;
    out.data.copy(out.data, half * row, 0, half * row);
    out.data.copy(out.data, (out.height - SKY_BAND_ROWS) * row, (out.height - half) * row, out.height * row);
    return out;
  };
}

/**
 * Rooftops' dawn (extended-stage.png): cyan-blue down through pink to peach,
 * with the white cirrus streaks stippled into each.
 */
export const ROOFTOPS_SKY_GRADIENTS: readonly (readonly [RoleName, RoleName])[] = [
  ["skyHigh", "skyMid"],
  ["skyMid", "skyLow"],
  ["skyHigh", "cloud"],
  ["skyLow", "cloud"],
];

/** A stage's full-frame sky: 960 x 640, opaque, stippled like the dawn's. */
export function stageSky(gradients: readonly (readonly [RoleName, RoleName])[]): (source: PNG) => PNG {
  return (source) => {
    const out = resample(source, 0, source.height - 1, 960, 640);
    quantizeDithered(out, gradients, 2, DAWN_STIPPLE_SPREAD);
    for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
    return out;
  };
}

/**
 * Sunken Dome's drift: fish and mantas across the band. Fitted inside a
 * transparent margin at both ends so the band tiles without a seam, as the
 * clouds are, and coloured by nearest role because the fish differ in hue.
 */
export const DRIFT_ROLES: readonly RoleName[] = ["cityNear", "cityMid", "skyHigh", "cityWindowBright", "cityWindowDim", "cloud"];
export function fishPlate(source: PNG): PNG {
  const box = contentBox(source, { x: 0, y: 0, width: source.width, height: source.height });
  const band = crop(source, box.x, box.y, box.width, box.height);
  const width = 960 - CLOUD_MARGIN * 2;
  const height = Math.min(140, Math.round((box.height * width) / box.width));
  const fitted = resample(band, 0, band.height - 1, width, height);
  quantizeNearest(fitted, DRIFT_ROLES);
  coarsen(fitted, 2);
  despeckle(fitted);
  const finished = powderFinishAtGrid(fitted, 2);
  quantizeNearest(finished, DRIFT_ROLES);
  finished.data.copy(fitted.data);

  const out = new PNG({ width: 960, height: 140 });
  for (let y = 0; y < height; y += 1) {
    const from = y * width * 4;
    fitted.data.copy(out.data, ((Math.floor((140 - height) / 2) + y) * 960 + CLOUD_MARGIN) * 4, from, from + width * 4);
  }
  return out;
}

/**
 * The sun, from the generated disc (`IMAGE_PROMPTS.sun`).
 *
 * A low warm disc behind the city, as both boards draw it (spec §2.8 item 7).
 * Its glow is stepped bands of solid swatches, and its alpha is hard -- the
 * box resample writes 0 or 255 and nothing between. The drafted sun it
 * replaces faded out through partial alpha, and the palette lock folded that
 * fade over the blue sky into a mint ring.
 */
export function sunPlate(source: PNG): PNG {
  const box = contentBox(source, { x: 0, y: 0, width: source.width, height: source.height });
  const side = Math.max(box.width, box.height);
  const square = crop(
    source,
    Math.max(0, Math.round(box.x + box.width / 2 - side / 2)),
    Math.max(0, Math.round(box.y + box.height / 2 - side / 2)),
    Math.min(side, source.width),
    Math.min(side, source.height),
  );
  const out = resample(square, 0, square.height - 1, 256, 256);
  // By distance from the centre rather than by colour: every tone in a sun is
  // light, and nearest-colour sends the pale core to peach and the glow to
  // amber, while a value split follows the source's noise. The generated disc
  // gives the shape; the core is white out to `SUN_CORE_RADIUS` of the disc
  // and the rest is the peach glow the halo has always been drawn in.
  const [core, glow] = [swatchRgb(ROLES.cloud), swatchRgb(ROLES.skyLow)];
  const centre = (out.width - 1) / 2;
  const radius = out.width / 2;
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const i = (y * out.width + x) * 4;
      if (out.data[i + 3] === 0) continue;
      // The core and the glow weave into each other, and the glow into the
      // sky, through the same 2-pixel ordered dither the skies use: a soft
      // sun in a limited palette, where two hard edges read as a disc inside
      // a ring (stage ascent spec §5.3, against extended-stage.png).
      const d = Math.hypot(x - centre, y - centre) / radius;
      const t = BAYER[(y >> 1) & 3]![(x >> 1) & 3]! + 0.5;
      const coreShare = (SUN_CORE_RADIUS + SUN_WEAVE / 2 - d) / SUN_WEAVE;
      const glowShare = (1 - d) / SUN_FADE;
      if (t >= glowShare) {
        out.data[i + 3] = 0;
        continue;
      }
      const [r, g, b] = t < coreShare ? core : glow;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/** How far out, as a share of the disc's radius, the white core reaches. */
export const SUN_CORE_RADIUS = 0.62;
/** The width of the band where the core weaves into the glow, as a share of the radius. */
export const SUN_WEAVE = 0.18;
/** The width of the glow's dithered fade into the sky, as a share of the radius. */
export const SUN_FADE = 0.3;

/** Transparent columns kept at each end of the cloud band, in output pixels. */
export const CLOUD_MARGIN = 10;

/**
 * The cloud band, from the generated streaks (`IMAGE_PROMPTS.clouds`).
 *
 * Fitted inside a transparent margin at both ends, so the band tiles across
 * the course without a seam: the wrap always meets empty sky on both sides.
 * Scaled to fit the width and, if it is shallower than the strip, sat on the
 * strip's bottom edge, where the drafted puffs sat.
 */
/**
 * One of Rooftops' three cloud bands: every third cloud of the full band,
 * counted largest first, starting at `which`.
 *
 * One band of every cloud read as a row: it drifts at the sky's near-zero
 * parallax, so it held one height for the whole climb, and high up it crossed
 * the plain top of the sky plate as a lone stripe (owner, 2026-10-01). Split
 * three ways, the bands stand at three heights and drift at three speeds, and
 * no height carries more than a few clouds. A cloud is a connected run of
 * opaque pixels, eight-way, so a wisp keeps its tail.
 */
export function cloudBand(full: PNG, which: number): PNG {
  const { width, height } = full;
  const label = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < width * height; start += 1) {
    if (label[start] !== -1 || full.data[start * 4 + 3] === 0) continue;
    const id = sizes.length;
    const stack = [start];
    label[start] = id;
    let size = 0;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % width;
      const y = (at - x) / width;
      size += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (label[next] !== -1 || full.data[next * 4 + 3] === 0) continue;
          label[next] = id;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  // Dealt out largest first, so each band gets one of the big clouds and its
  // share of the wisps, rather than one band holding every large one.
  const rank = new Map(sizes.map((size, id) => [id, size] as const).sort((a, b) => b[1] - a[1]).map(([id], index) => [id, index]));
  const out = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const id = label[i]!;
    if (id === -1 || rank.get(id)! % 3 !== which) continue;
    full.data.copy(out.data, i * 4, i * 4, i * 4 + 4);
  }
  return out;
}

export function cloudPlate(source: PNG): PNG {
  const box = contentBox(source, { x: 0, y: 0, width: source.width, height: source.height });
  const band = crop(source, box.x, box.y, box.width, box.height);
  const width = 960 - CLOUD_MARGIN * 2;
  const height = Math.min(140, Math.round((box.height * width) / box.width));
  const fitted = resample(band, 0, band.height - 1, width, height);
  // White tops and peach undersides only. The lilac swatch is left out on
  // purpose: the chroma key's pink fringe snaps onto it, and a lilac rim on
  // every cloud is exactly the fringe a key exists to remove.
  quantizeNearest(fitted, ["cloud", "skyLow"]);
  // On the same two-pixel grid as the city, so the wisps are drawn in the
  // units everything else is rather than as single-pixel glitter.
  coarsen(fitted, 2);
  despeckle(fitted);
  const finished = powderFinishAtGrid(fitted, 2);
  quantizeNearest(finished, ["cloud", "skyLow"]);
  finished.data.copy(fitted.data);

  const out = new PNG({ width: 960, height: 140 });
  for (let y = 0; y < height; y += 1) {
    const from = y * width * 4;
    fitted.data.copy(out.data, ((140 - height + y) * 960 + CLOUD_MARGIN) * 4, from, from + width * 4);
  }
  return out;
}

