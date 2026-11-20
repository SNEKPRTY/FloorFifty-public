import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../../src/roles";
import { swatchRgb } from "../../src/swatches";
import { contentBox, crop, quantizeNearest, resample } from "../source-raster";
import { powderFinishAtGrid, powderFinishTiled } from "../powder";
import { coarsen, despeckle } from "./cleanup";
import { lumaProfile, period } from "./analysis";

/**
 * Fits the keyed content of `source` to `width`, keeping its aspect, and sets
 * it on the bottom edge of a transparent `width x height` plate -- the shape
 * every standing subject (a skyline, a ledge) is drawn in.
 */
export function standOnBottom(
  source: PNG,
  width: number,
  height: number,
  ramp: readonly RoleName[],
  visible = height,
  powder = false,
): PNG {
  const box = contentBox(source, { x: 0, y: 0, width: source.width, height: source.height });
  const subject = crop(source, box.x, box.y, box.width, box.height);
  const naturalHeight = Math.round((box.height * width) / box.width);
  // Taller than it may stand: keep the top `visible` rows and let the bases
  // run on below the frame, rather than squashing the skyline to fit.
  const kept = Math.min(naturalHeight, visible);
  const whole = resample(subject, 0, subject.height - 1, width, naturalHeight);
  const fitted = crop(whole, 0, 0, width, kept);
  const fittedHeight = kept;
  quantizeNearest(fitted, ramp);
  coarsen(fitted, 2);
  despeckle(fitted);

  const out = new PNG({ width, height });
  // The powdery finish, as the stages' plates take it: in the art's own
  // 2-pixel grid, then back onto the ramp.
  if (powder) {
    const finished = powderFinishAtGrid(fitted, 2);
    quantizeNearest(finished, ramp);
    finished.data.copy(fitted.data);
  }
  for (let y = 0; y < fittedHeight; y += 1) {
    const from = y * width * 4;
    fitted.data.copy(out.data, (height - fittedHeight + y) * width * 4, from, from + width * 4);
  }
  return out;
}

/**
 * The menu's city as two layers (`IMAGE_PROMPTS.menuCity`), for parallax
 * (spec §2.9 item 2): the far roles to one plate and the near roles to the
 * other. The far plate is filled solid below each column's skyline, so when
 * the layers slide apart nothing shows through the gap behind the near one.
 */
export function menuCityLayers(source: PNG): { far: PNG; near: PNG } {
  const both = standOnBottom(source, 960, 540, ["cityFar", "cityMid", "cityNear", "cityNearEdge", "cityWindow"], 400, true);
  const farRoles = new Set([ROLES.cityFar, ROLES.cityMid].map((role) => swatchRgb(role).join()));
  const fill = swatchRgb(ROLES.cityMid);
  const far = new PNG({ width: both.width, height: both.height });
  const near = new PNG({ width: both.width, height: both.height });
  for (let x = 0; x < both.width; x += 1) {
    let started = false;
    for (let y = 0; y < both.height; y += 1) {
      const i = (y * both.width + x) * 4;
      if (both.data[i + 3] === 0 && !started) continue;
      started = true;
      const rgb = [both.data[i]!, both.data[i + 1]!, both.data[i + 2]!];
      const isFar = both.data[i + 3] !== 0 && farRoles.has(rgb.join());
      if (both.data[i + 3] !== 0 && !isFar) {
        near.data.set([...rgb, 255], i);
      }
      far.data.set([...(isFar ? rgb : fill), 255], i);
    }
  }
  return { far, near };
}

/** The rooftop ledge the menu's racers stand on (`IMAGE_PROMPTS.menuLedge`). */
export function menuLedgePlate(source: PNG): PNG {
  return standOnBottom(source, 480, 96, ["outline", "cityNear", "cityMid", "rooftopFoliage"], 96, true);
}

/**
 * The ledge's slab alone: the plate between the 60 px pipe end and the 110 px
 * planter end, which the menu repeats to the ledge's length. Its own tile
 * because a background can only repeat a whole image, and the nine-slice
 * `border-image` that once repeated it inside the plate stops painting on
 * iPadOS Safari a few seconds after the menu appears.
 */
export function menuLedgeSlab(source: PNG): PNG {
  const plate = menuLedgePlate(source);
  return crop(plate, 60, 0, plate.width - 60 - 110, plate.height);
}

/**
 * The wall under the menu ledge, as one seamless tile (`IMAGE_PROMPTS.menuFacade`).
 *
 * The ledge alone read as a slab floating in the sky; this is the building it
 * is the parapet of, repeated down to the bottom of the screen at any size.
 * Two window columns by two storeys, because the source lights its windows in
 * a checkerboard and a one-by-one tile would light every window or none.
 *
 * The crop is exactly two measured periods on each axis, so its edges meet.
 * It starts in the wall between two columns and just under a storey band, so
 * the top of the tile -- the part right under the parapet -- is brick.
 */
export function menuFacadeTile(source: PNG): PNG {
  // A window column is about a quarter of the source's width and a storey
  // about a sixth of its height; search a band around each.
  const columnPitch = period(lumaProfile(source, 0), Math.round(source.width / 6), Math.round(source.width / 3));
  const storeyPitch = period(lumaProfile(source, 1), Math.round(source.height / 9), Math.round(source.height / 4));

  // Phase. The steadiest column in the first period is plain wall between two
  // windows -- a column through a window swings from frame to pane -- so the
  // tile's edges, and the building's corner, never cut a window. The
  // brightest row is a storey band.
  const rows = lumaProfile(source, 1);
  const argmax = (values: readonly number[], from: number, to: number): number => {
    let at = from;
    for (let i = from; i < to; i += 1) if (values[i]! > values[at]!) at = i;
    return at;
  };
  const spread = columnSpread(source);
  let x0 = 0;
  for (let x = 0; x < columnPitch; x += 1) if (spread[x]! < spread[x0]!) x0 = x;
  const y0 = argmax(rows, Math.round(storeyPitch / 2), Math.round(storeyPitch / 2) + storeyPitch);
  const width = columnPitch * 2;
  const height = storeyPitch * 2;
  const tile = crop(source, x0, y0 + 2, Math.min(width, source.width - x0), Math.min(height, source.height - y0 - 2));

  // At the ledge's own scale: a storey a little taller than a racer cell.
  const out = resample(tile, 0, tile.height - 1, FACADE_TILE.width, FACADE_TILE.height);
  // By colour, not by value rank. A ranked ramp splits the brick's grain
  // between two roles and the wall comes out mottled, as bright as the
  // parapet; nearest colour resolves the whole wall to `cityNear`, the near
  // skyline's own body, so the building sits with the city and the ledge
  // above it still reads as the lit edge of the roof.
  quantizeNearest(out, FACADE_ROLES);
  coarsen(out, 2);
  despeckle(out);
  // The powdery finish, judged across the tile's own repeat so it still meets
  // itself, then back onto its roles.
  const finished = powderFinishTiled(out, 2);
  quantizeNearest(finished, FACADE_ROLES);
  return finished;
}

/** The standard deviation of luma down each column. */
export function columnSpread(png: PNG): number[] {
  const mean = lumaProfile(png, 0);
  const out = new Array<number>(png.width).fill(0);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * 4;
      const luma = 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
      out[x]! += (luma - mean[x]!) ** 2 / png.height;
    }
  }
  return out.map(Math.sqrt);
}

/** The facade's roles: the near skyline's body, its ink, and the lit windows. */
export const FACADE_ROLES: readonly RoleName[] = ["outline", "cityNear", "cityMid", "cityWindow"];

/** The facade tile's size, in pixels at the ledge's 1x scale. Even, for the 2 px grid. */
export const FACADE_TILE = { width: 140, height: 144 } as const;

