/**
 * The only place Floor Fifty's units meet Planck's.
 *
 * Everything authored, stored, sent and drawn is in logical pixels. Planck
 * wants metres, and its solver is tuned for bodies roughly between 0.1 and 10
 * of them. Fifty pixels to the metre puts a racer at 1.18 m and a floor at
 * 2.4 m by 0.4 m, which is the middle of that range.
 *
 * The scale is pinned. Changing it changes every contact the solver resolves
 * and therefore invalidates every recorded trace, so it is a determinism
 * decision rather than a tunable.
 */

/** Pinned. See the module comment before changing it. */
export const PIXELS_PER_METER = 50;

export const toMeters = (pixels: number): number => pixels / PIXELS_PER_METER;

export const toPixels = (meters: number): number => meters * PIXELS_PER_METER;
