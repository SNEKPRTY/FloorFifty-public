/** Small numeric helpers shared by the simulation, the course generator and the client. */

/** Clamps `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation; `t` is not clamped. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Interpolation evenly in ratios rather than steps: a cutoff swept in octaves,
 * as pitch is heard. `t` is clamped to [0, 1], and the ends are exact, so a
 * filter asked for `to` lands on it rather than a rounding error beside it.
 */
export function logLerp(from: number, to: number, t: number): number {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return from * (to / from) ** t;
}

/**
 * Wraps `value` into the half-open range `[-half, half)` by whole widths.
 *
 * Subtracting a full width rather than snapping to the opposite edge keeps a
 * wrapping player's sub-pixel offset intact, so the crossing reads as
 * continuous motion instead of a jump.
 */
export function wrapSymmetric(value: number, half: number): number {
  const width = half * 2;
  let wrapped = value;
  while (wrapped > half) wrapped -= width;
  while (wrapped < -half) wrapped += width;
  return wrapped;
}

/**
 * Shortest signed distance from `from` to `to` on a course that wraps.
 *
 * A point a little way off one edge is nearer through the seam than across the
 * whole width, and anything that measures the plain difference will always take
 * the long way round: a bot steers away from the floor it wants, and a client
 * predicting its own movement drags itself backwards across the screen.
 */
export function shortestWrappedOffset(from: number, to: number, width: number): number {
  const half = width / 2;
  let offset = to - from;
  if (offset > half) offset -= width;
  if (offset < -half) offset += width;
  return offset;
}
