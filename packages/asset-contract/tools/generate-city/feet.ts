import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../../src/roles";
import { swatchRgb } from "../../src/swatches";

/**
 * How many rows at the foot of a plate are replaced by an extrusion.
 *
 * Twenty-four is comfortably more than the encoder's fringe and comfortably
 * less than the `sink` that decides how much of the plate is ever on screen, so
 * the cost is detail nobody sees and the gain is a skirt that cannot tear.
 */
export const FOOT_ROWS = 24;
/** Replaces the foot of the plate with a copy of the row above it. */
export function extrudeFoot(png: PNG): void {
  const donor = png.height - FOOT_ROWS - 1;
  for (let y = donor + 1; y < png.height; y += 1) {
    png.data.copy(
      png.data,
      y * png.width * 4,
      donor * png.width * 4,
      (donor + 1) * png.width * 4,
    );
  }
}

/** Repaints `roles` as the wall colour in the extruded foot band; see `Plate.footQuiet`. */
export function quietFoot(png: PNG, roles: readonly RoleName[]): void {
  const quiet = roles.map((role) => swatchRgb(ROLES[role]));
  const wall = swatchRgb(ROLES.cityNear);
  for (let y = png.height - FOOT_ROWS - 1; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 3] === 0) continue;
      if (!quiet.some(([r, g, b]) => png.data[i] === r && png.data[i + 1] === g && png.data[i + 2] === b)) continue;
      png.data[i] = wall[0];
      png.data[i + 1] = wall[1];
      png.data[i + 2] = wall[2];
    }
  }
}

