/**
 * Seeded course generation.
 *
 * A course is the fixed starting floor plus `COURSE_FLOOR_COUNT - 1` generated
 * floors, numbered upward from zero. Generation is a pure function of the room
 * seed and the resolved tuning; client randomness never reaches it.
 */

import { VIEWPORT } from "../common/constants";
import type { ResolvedTuning } from "../common/tuning";
import { createRng, deriveSeed } from "./rng";

export type FloorKind = "stationary" | "moving";

export type Floor = {
  /** Stable across regeneration of the same seed; snapshots address floors by it. */
  readonly id: string;
  /** Zero is the fixed starting floor. */
  readonly index: number;
  /** Centre of the floor in logical world units, y up. */
  readonly x: number;
  readonly y: number;
  readonly kind: FloorKind;
  /** Units per second; zero for a stationary floor. */
  readonly speed: number;
  /** Initial travel direction of a moving floor. */
  readonly direction: 1 | -1;
};

export type Course = {
  readonly seed: number;
  readonly floorCount: number;
  readonly floors: readonly Floor[];
  /** Inclusive horizontal range a floor centre may occupy. */
  readonly bounds: { readonly left: number; readonly right: number };
  /** Falling below this respawns a player at their current lap start. */
  readonly deathLineY: number;
};

/**
 * Horizontal travel limits for a floor centre.
 *
 * Insetting by the full floor width rather than half of it reproduces the
 * reference build's bounds, which keep a moving floor clear of the wrap seam so
 * a player never lands on a floor that is halfway off one edge.
 */
export function courseBounds(tuning: ResolvedTuning): { left: number; right: number } {
  const limit = VIEWPORT.width / 2 - tuning.FLOOR_WIDTH;
  return { left: -limit, right: limit };
}

const UINT32_SPAN = 0x100000000;

/**
 * Which ramp band a floor is in (race-options spec §5.1): 0 below the ramp,
 * then 1, 2, … every `DEMAND_RAMP_BAND_FLOORS`. A function of the index and
 * tuning alone, so a ramped course is as prefix-stable as any other.
 */
export function rampBand(index: number, tuning: ResolvedTuning): number {
  if (index < tuning.DEMAND_RAMP_FROM_FLOOR) return 0;
  return Math.floor((index - tuning.DEMAND_RAMP_FROM_FLOOR) / tuning.DEMAND_RAMP_BAND_FLOORS) + 1;
}

/** The starting floor is fixed rather than generated, so every race begins alike. */
function startingFloor(): Floor {
  return { id: "floor-0", index: 0, x: 0, y: 0, kind: "stationary", speed: 0, direction: 1 };
}

/**
 * Generates one floor, a fixed gap above the one below it.
 *
 * Horizontal placement is an independent draw across the course bounds rather
 * than a step from the floor below, which is what the reference does and what
 * makes wall-riding necessary: consecutive floors stack often, and a stacked
 * floor roofs the column a climber rises in. Contact lifts a player whichever
 * face they touch, so the roof is a route rather than a barrier.
 *
 * Deriving the stream from `(seed, index)` keeps prefix stability intact: the
 * chain depends only on the seed and the indices below, so the first `n` floors
 * of a tall course are identical to a course of exactly `n` floors.
 */
function generateFloor(
  seed: number,
  index: number,
  previous: Floor,
  tuning: ResolvedTuning,
): Floor {
  const rng = createRng(deriveSeed(seed, index));
  const bounds = courseBounds(tuning);

  // Min and max are equal under parity, so this is the reference's uniform
  // ladder rather than a draw. It stayed a `nextInt` call through the constant
  // adoption only by luck: `nextInt` is `min + floor(rand * (max - min + 1))`,
  // which reduces to `min` when the two are equal, so it happened to return
  // the float `540 / 4.2` intact. An integer helper that returns a
  // non-integer is an accident waiting to be tidied into a bug, and the draw
  // it consumed is gone here, which changes the stream either way.
  const gap = tuning.FLOOR_GAP_MIN;

  // Drawn across the full bounds with no reference to the floor below, exactly
  // as `platforms.rs:108` does. Floors therefore stack, and a stacked pair is
  // an opportunity rather than a wall: contact with any face lifts a player, so
  // a climber rides the side of the floor that roofs them.
  const x = rng.nextRange(bounds.left, bounds.right);

  // Band 0 is the reference's coin and range, exactly. A ramped band makes the
  // same three draws in the same order, so it consumes the floor's stream as
  // band 0 does, and reads them against a share and a range that rise per band.
  const band = rampBand(index, tuning);
  const movingDraw = rng.nextUint32();
  const moving =
    band === 0
      ? movingDraw % 2 === 0
      : movingDraw / UINT32_SPAN < Math.min(0.5 + band * tuning.MOVING_SHARE_STEP, tuning.MOVING_SHARE_MAX);
  const speed =
    band === 0
      ? rng.nextRange(tuning.MOVING_FLOOR_SPEED_MIN, tuning.MOVING_FLOOR_SPEED_MAX)
      : rng.nextRange(
          Math.min(tuning.MOVING_FLOOR_SPEED_MIN + band * tuning.MOVING_SPEED_STEP, tuning.MOVING_FLOOR_SPEED_CAP),
          Math.min(tuning.MOVING_FLOOR_SPEED_MAX + band * tuning.MOVING_SPEED_STEP, tuning.MOVING_FLOOR_SPEED_CAP),
        );

  return {
    id: `floor-${index}`,
    index,
    x,
    y: previous.y + gap,
    kind: moving ? "moving" : "stationary",
    speed: moving ? speed : 0,
    // Every moving floor begins rightward in the reference (`platforms.rs:130`).
    direction: 1,
  };
}

/**
 * Appends floors up to index `toIndex`, from the same `generateFloor`, each a
 * gap above the one below (race-options spec §5.3). Returns the course itself
 * when it is already that tall. Prefix stability is what makes this safe: a
 * floor depends only on `(seed, index)` and tuning, so a grown course is the
 * course a taller `createCourse` would have built.
 */
export function extendCourse(course: Course, tuning: ResolvedTuning, toIndex: number): Course {
  if (toIndex < course.floorCount) return course;
  const floors = [...course.floors];
  for (let index = floors.length; index <= toIndex; index += 1) {
    floors.push(generateFloor(course.seed, index, floors[index - 1]!, tuning));
  }
  return { ...course, floorCount: floors.length, floors };
}

/**
 * Builds the course for a room.
 *
 * `tuning.COURSE_FLOOR_COUNT` decides the height; nothing else about the
 * generator changes between a twenty-floor race and a hundred-floor climb.
 */
export function createCourse(seed: number, tuning: ResolvedTuning): Course {
  const floors: Floor[] = [startingFloor()];

  for (let index = 1; index < tuning.COURSE_FLOOR_COUNT; index += 1) {
    floors.push(generateFloor(seed, index, floors[index - 1]!, tuning));
  }

  return {
    seed,
    floorCount: floors.length,
    floors,
    bounds: courseBounds(tuning),
    deathLineY: floors[0]!.y - tuning.DEATH_LINE_MARGIN,
  };
}
