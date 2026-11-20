import { PNG } from "pngjs";

/**
 * Makes a source tile horizontally, by wrap quilting.
 *
 * The last `overlap` columns are laid over the first `overlap`, and a
 * vertical cut runs through that band where the two agree best (the cheapest
 * top-to-bottom path, moving at most one column per row). Left of the cut the
 * picture is its own right end; right of it, its left start. The result drops
 * the first `overlap` columns, so its last column is followed, on wrapping,
 * by the column that originally came after it: the join is the picture's own.
 */
export function wrapSeamless(source: PNG, overlap: number): PNG {
  const width = source.width - overlap;
  const height = source.height;
  const at = (x: number, y: number): number => (y * source.width + x) * 4;
  // The cost of cutting at band column c in row y: how far the right end and
  // the left start disagree there.
  const cost = (c: number, y: number): number => {
    const a = at(source.width - overlap + c, y);
    const b = at(c, y);
    let sum = 0;
    for (let channel = 0; channel < 3; channel += 1) sum += Math.abs(source.data[a + channel]! - source.data[b + channel]!);
    return sum;
  };
  const total = new Float64Array(overlap * height);
  const from = new Int32Array(overlap * height);
  for (let c = 0; c < overlap; c += 1) total[c] = cost(c, 0);
  for (let y = 1; y < height; y += 1) {
    for (let c = 0; c < overlap; c += 1) {
      let best = c;
      for (const d of [c - 1, c + 1]) if (d >= 0 && d < overlap && total[(y - 1) * overlap + d]! < total[(y - 1) * overlap + best]!) best = d;
      total[y * overlap + c] = total[(y - 1) * overlap + best]! + cost(c, y);
      from[y * overlap + c] = best;
    }
  }
  const cut = new Int32Array(height);
  let end = 0;
  for (let c = 1; c < overlap; c += 1) if (total[(height - 1) * overlap + c]! < total[(height - 1) * overlap + end]!) end = c;
  for (let y = height - 1; y >= 0; y -= 1) {
    cut[y] = end;
    end = from[y * overlap + end]!;
  }

  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Output column x is source column x + overlap, except in the final band,
      // where columns right of the cut come from the left start instead.
      const band = x - (width - overlap);
      const sx = band >= 0 && band >= cut[y]! ? band : x + overlap;
      source.data.copy(out.data, (y * width + x) * 4, at(sx, y), at(sx, y) + 4);
    }
  }
  return out;
}

/** The band a seamless plate overlaps, in source pixels: a few buildings wide. */
export const SEAM_OVERLAP = 320;

/** How much of its other end a seamless plate borrows each side while it is cleaned up. Even, for the grid. */
export const SEAM_MARGIN = 32;

/**
 * A seamless plate turned sideways so its join lands where its two edge
 * columns agree.
 *
 * Rotating a tile that already meets itself changes nothing on screen -- the
 * strip repeats -- but a tower whose edge happens to fall on the join reads,
 * to the asset contract's seam check, exactly like a break. Moved, by whole
 * grid cells, to the column pair that agrees best, the join is honest to the
 * check and identical to the eye.
 */
export function quietJoin(png: PNG, grid: number): PNG {
  const opaque = (x: number, y: number): boolean => png.data[(y * png.width + x) * 4 + 3]! > 0;
  let best = 0;
  let bestRows = Number.POSITIVE_INFINITY;
  for (let k = 0; k < png.width; k += grid) {
    const before = (k - 1 + png.width) % png.width;
    let rows = 0;
    for (let y = 0; y < png.height; y += 1) if (opaque(before, y) !== opaque(k, y)) rows += 1;
    if (rows < bestRows) {
      bestRows = rows;
      best = k;
    }
  }
  if (best === 0) return png;
  const out = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y += 1) {
    const row = y * png.width * 4;
    png.data.copy(out.data, row, row + best * 4, row + png.width * 4);
    png.data.copy(out.data, row + (png.width - best) * 4, row, row + best * 4);
  }
  return out;
}

/** `png` with `margin` columns of its own right end before it and of its left start after it. */
export function wrapPad(png: PNG, margin: number): PNG {
  const out = new PNG({ width: png.width + margin * 2, height: png.height });
  for (let y = 0; y < png.height; y += 1) {
    const row = y * png.width * 4;
    const to = y * out.width * 4;
    png.data.copy(out.data, to, row + (png.width - margin) * 4, row + png.width * 4);
    png.data.copy(out.data, to + margin * 4, row, row + png.width * 4);
    png.data.copy(out.data, to + (margin + png.width) * 4, row, row + margin * 4);
  }
  return out;
}

