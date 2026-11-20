import { PNG } from "pngjs";

/**
 * The strongest repeat in a luminance profile, between `min` and `max`.
 *
 * The facade is drawn to a regular grid, but not an exact one, so the period
 * is measured rather than assumed: the lag at which the profile best matches
 * itself shifted.
 */
export function period(profile: readonly number[], min: number, max: number): number {
  const mean = profile.reduce((sum, value) => sum + value, 0) / profile.length;
  let best = min;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = min; lag <= max; lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < profile.length; i += 1) score += (profile[i]! - mean) * (profile[i + lag]! - mean);
    score /= profile.length - lag;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/** Mean luma per column (`axis` 0) or per row (`axis` 1). */
export function lumaProfile(png: PNG, axis: 0 | 1): number[] {
  const length = axis === 0 ? png.width : png.height;
  const across = axis === 0 ? png.height : png.width;
  const out = new Array<number>(length).fill(0);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * 4;
      const luma = 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
      out[axis === 0 ? x : y]! += luma / across;
    }
  }
  return out;
}

