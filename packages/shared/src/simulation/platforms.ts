/**
 * Moving floor motion.
 *
 * A floor's generated `x` is its spawn position; its live position lives in
 * `state.movingFloors` so the generator stays a pure function of the seed.
 */

import { TICK_SECONDS } from "../common/constants";
import { clamp } from "../common/math";
import type { RaceState } from "../common/state";

/**
 * Advances every moving floor and reverses it at the course bounds.
 *
 * Clamping before reversing is what stops a floor from creeping past the bound
 * by one tick's travel and drifting further out on each bounce.
 */
export function advancePlatforms(state: RaceState): void {
  const { left, right } = state.course.bounds;

  for (const floor of Object.values(state.movingFloors)) {
    floor.x += floor.speed * floor.direction * TICK_SECONDS;

    if (floor.x >= right) {
      floor.direction = -1;
    } else if (floor.x <= left) {
      floor.direction = 1;
    }
    floor.x = clamp(floor.x, left, right);
  }
}
