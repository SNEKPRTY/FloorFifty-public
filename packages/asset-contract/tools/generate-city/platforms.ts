import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../../src/roles";
import { swatchRgb } from "../../src/swatches";
import { contentBounds, crop, drawn, quantizeNearest, resample } from "../source-raster";
import { powderFinishAtGrid } from "../powder";
import { coarsen, despeckle, openShapes, quantize, quantizeScene } from "./cleanup";

/**
 * The lantern accents, scattered over the near skyline's own mass.
 *
 * A separate layer rather than more windows in the plate, because it draws at
 * the same parallax factor but tiles downward instead of skirting: repeated
 * below the strip it reads as more lit storeys, which is what a taller building
 * has. Restricted to the roofline band, since below it the plate is the same
 * columns continued down and an accent there would sit on a wall nobody sees.
 *
 * Seeded, so a regeneration is byte-identical and never shows up as a diff.
 */
export function lanterns(near: PNG, roofBand: number): PNG {
  const out = new PNG({ width: near.width, height: near.height });
  let state = 0x1a2148;
  const random = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  };

  const [wr, wg, wb] = swatchRgb(ROLES.cityWindow);

  // Two-pixel panes, and very few of them.
  //
  // The plate already carries its own lit windows, so this layer is an accent
  // on top of one -- and a per-pixel scatter at any density that showed up at
  // all came out as dust across every facade, which is the glitter the brief
  // rejects arriving one layer later. A pane reads as a window; a pixel reads
  // as a speck.
  const PANE = 2;
  const DENSITY = 0.00018;

  for (let y = 0; y < roofBand - PANE; y += 1) {
    for (let x = 0; x < near.width - PANE; x += 1) {
      if (random() > DENSITY) continue;
      const anchor = (y * near.width + x) * 4;
      if (near.data[anchor + 3] === 0) continue;

      for (let dy = 0; dy < PANE; dy += 1) {
        for (let dx = 0; dx < PANE; dx += 1) {
          const i = ((y + dy) * near.width + (x + dx)) * 4;
          if (near.data[i + 3] === 0) continue;
          out.data[i] = wr;
          out.data[i + 1] = wg;
          out.data[i + 2] = wb;
          out.data[i + 3] = 255;
        }
      }
    }
  }
  return out;
}

/**
 * A platform slab's four roles, darkest first, the last being its top face.
 * Rooftops' are the grass-topped concrete slab; each other stage draws its own.
 */
export const ROOFTOP_PLATFORM_ROLES: readonly RoleName[] = ["platformOutline", "platformBody", "platformGlow", "platformTop"];
/** Snow Shrine's stone under snow: ink, a cool stone, pale stone, white. */
export const SNOW_SHRINE_PLATFORM_ROLES: readonly RoleName[] = ["outline", "uiMuted", "cityFar", "cloud"];
/** Sunken Dome's glass: ink, deep teal, teal, pale glass. */
export const SUNKEN_DOME_PLATFORM_ROLES: readonly RoleName[] = ["outline", "dawnFog", "dawnTeal", "dawnGlow"];

/**
 * The platform sheet: two 128x32 frames cut from one generated slab.
 *
 * The slab is drawn once and recoloured for the moving frame, so both faces
 * are the same object under a different light rather than two drawings that
 * have to be kept in step. Inset by two pixels, because the asset validator
 * checks that a cut-out sprite's corners are transparent.
 */
/**
 * A slab source cropped to the slab's own width. `platformSheet` crops rows
 * only, which suits a source drawn edge to edge; a slab generated in the
 * middle of a square canvas would otherwise ship two-thirds as wide as its
 * frame, with its ends transparent.
 */
export function slabWidth(source: PNG): PNG {
  // A column counts only once enough of it is drawn: the encoder leaves stray
  // non-key pixels along the edges, and one of those would hold the crop open
  // to the canvas's full width.
  const MINIMUM_RUN = 8;
  const filled = (x: number): boolean => {
    let count = 0;
    for (let y = 0; y < source.height; y += 1) if (drawn(source, x, y)) count += 1;
    return count >= MINIMUM_RUN;
  };
  let left = 0;
  while (left < source.width - 1 && !filled(left)) left += 1;
  let right = source.width - 1;
  while (right > left && !filled(right)) right -= 1;
  return crop(source, left, 0, right - left + 1, source.height);
}

/**
 * A slab source cropped down to its lip: the first row drawn across most of
 * its width. A racer lands on the frame's top edge, so anything standing
 * proud of the lip (Sunken Dome's coral tufts) would put the visible landing
 * edge below the one the course uses; the stage-ascent plan asks for a solid
 * lip across the top and 75% cover in the top 32 rows.
 */
export function fromLip(source: PNG): PNG {
  const LIP_SHARE = 0.75;
  let top = 0;
  for (; top < source.height - 1; top += 1) {
    let count = 0;
    for (let x = 0; x < source.width; x += 1) if (drawn(source, x, top)) count += 1;
    if (count >= source.width * LIP_SHARE) break;
  }
  return crop(source, 0, top, source.width, source.height - top);
}

export function platformSheet(source: PNG, roles: readonly RoleName[] = ROOFTOP_PLATFORM_ROLES): PNG {
  const FRAME = 32;
  const INSET = 2;
  const width = 128 - INSET * 2;
  const height = FRAME - INSET * 2;

  const { top, bottom } = contentBounds(source);
  let slab = resample(source, top, bottom, width, height);
  quantize(slab, roles, false);
  despeckle(slab);
  // A two-pixel grid on a 28-pixel-tall slab, so its grassy lip is drawn in
  // the same units as the city behind it.
  coarsen(slab, 2);
  // The stages' slabs take the powdery finish like the scenery behind them.
  slab = powderFinishAtGrid(slab, 2);
  quantizeNearest(slab, roles);
  openShapes(slab, 4);

  const sheet = new PNG({ width: 128, height: 64 });
  // The last role is the slab's top face, and the moving frame re-tints it in
  // the one moving-top colour every stage shares: a moving floor reads the same
  // whatever the stage is drawn in.
  const staticTop = swatchRgb(ROLES[roles[roles.length - 1]!]);
  const movingTop = swatchRgb(ROLES.platformMovingTop);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      if (slab.data[from + 3] === 0) continue;
      const rgb: [number, number, number] = [
        slab.data[from]!,
        slab.data[from + 1]!,
        slab.data[from + 2]!,
      ];
      const isFace =
        rgb[0] === staticTop[0] && rgb[1] === staticTop[1] && rgb[2] === staticTop[2];

      for (const [frame, face] of [
        [0, rgb],
        [FRAME, isFace ? movingTop : rgb],
      ] as [number, readonly [number, number, number]][]) {
        const to = ((frame + INSET + y) * 128 + INSET + x) * 4;
        sheet.data[to] = face[0]!;
        sheet.data[to + 1] = face[1]!;
        sheet.data[to + 2] = face[2]!;
        sheet.data[to + 3] = 255;
      }
    }
  }
  return sheet;
}

/**
 * The reviewed menu backdrop at the full 960x540 logical frame.
 *
 * Opaque rather than keyed: it is a whole scene with its own sky, which is the
 * one plate that is allowed to be. Its ramp is the world's, so the menu and the
 * race are lit by the same palette rather than by two that merely resemble each
 * other.
 *
 * The conversion is `quantizeScene`, and the reason it is not the nearest-role
 * search this plate first shipped with is written up there: over a smooth sky
 * a nearest-colour search flips between the two tones either side of every
 * pixel's value, so the dawn field came out as a white-and-peach chequerboard
 * -- noise, read at review, in place of a gradient.
 */
export function menuBackdrop(source: PNG): PNG {
  const out = resample(source, 0, source.height - 1, 960, 540);
  quantizeScene(out);
  for (let i = 0; i < out.data.length; i += 4) out.data[i + 3] = 255;
  return out;
}

