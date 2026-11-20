/**
 * Pinned world configuration.
 *
 * Every value here is fixed rather than left to a library default, because a
 * default is a number that can change under us in a patch release and take a
 * recorded trace with it. Iteration counts are Box2D's own defaults, written
 * down so they are ours.
 */

import { TICK_SECONDS } from "../../common/constants";
import type { ResolvedTuning } from "../../common/tuning";

export const VELOCITY_ITERATIONS = 8;
export const POSITION_ITERATIONS = 3;

/** Collision categories. A racer's mask never includes `RACER_CATEGORY`. */
export const FLOOR_CATEGORY = 0x0001;
export const RACER_CATEGORY = 0x0002;
export const FOOT_SENSOR_CATEGORY = 0x0004;

/**
 * Materials.
 *
 * Restitution is zero on every solid fixture: the authored bounce is applied
 * by game logic, from `BOUNCE_VELOCITY`, so a material coefficient would
 * double it. Friction is zero because horizontal velocity is assigned outright
 * every tick and a floor that slowed a rider would be a rule nobody authored.
 */
export const RACER_DENSITY = 1;
export const RACER_FRICTION = 0;
export const RACER_RESTITUTION = 0;
export const FLOOR_FRICTION = 0;
export const FLOOR_RESTITUTION = 0;

/**
 * The fastest anything in a legal race moves, with headroom.
 *
 * A held fast fall is the ceiling, and the margin covers a tick in which the
 * solver has pushed a player out as well. Exceeding it is an invariant
 * violation rather than a clamp.
 */
export const maxSafeSpeedPixels = (tuning: ResolvedTuning): number =>
  Math.max(
    Math.abs(tuning.FAST_FALL_VELOCITY),
    Math.abs(tuning.BOUNCE_VELOCITY),
    tuning.MAX_MOVE_SPEED,
  ) * 2;

/**
 * The highest a legal race reaches, with headroom.
 *
 * The top floor plus one bounce apex, doubled. A body beyond it has escaped
 * the course rather than climbed it. Read against the course's current
 * height: an endless course's top moves (race-options spec §5.3).
 */
export const maxSafeAbsYPixels = (tuning: ResolvedTuning, floorCount: number): number =>
  (floorCount * tuning.FLOOR_GAP_MAX + tuning.DEATH_LINE_MARGIN) * 2;

/** One tick, in seconds. Re-exported so a Planck module imports one clock. */
export const STEP_SECONDS = TICK_SECONDS;

/**
 * How far below a face's normal a contact still counts as that face.
 *
 * `√½` is 45 degrees: a normal steeper than that is a top or an underside, and
 * anything shallower is a side. A box meets a box face-on, so in practice the
 * normals are axis-aligned and this only decides the rare corner manifold.
 */
export const TOP_NORMAL_MIN_Y = Math.SQRT1_2;

/**
 * How close to a face counts as touching it, outside the solver.
 *
 * Planck never lets a body reach a face: a held body rests inside the contact
 * skin -- Box2D's linear slop (0.005 m, a quarter of a logical pixel at fifty
 * pixels to the metre) plus a polygon's skin radius (twice the slop, half a
 * pixel). One pixel covers both with room for a tick of correction. Only code
 * that tests contact geometry by hand -- the reference controller -- uses it.
 */
export const CONTACT_TOLERANCE_PIXELS = 1;
