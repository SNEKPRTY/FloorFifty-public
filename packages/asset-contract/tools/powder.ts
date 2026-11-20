/**
 * The powdery finish.
 *
 * Ported from the AutomataEngine sprite pipeline (tools/sprite-morph.ts,
 * commit c55e74f, approved there as the built-in unfaker default), where it
 * replaced running the external Unfaker application.
 *
 * The finish is spatial, not a reduction in palette size. A 2x2 OPEN removes
 * small bright details; a 2x2 CLOSE fills small dark gaps. All four RGBA
 * channels take part, across colour boundaries: a mask per palette run would
 * keep precisely the details this pass exists to simplify (which is what this
 * repository's per-class `morphSimplify` does, and why it never looked like
 * this). Dilation reflects the erosion neighbourhood, so broad forms stay put
 * rather than sliding a pixel. Orphan diagonals are then deleted from a
 * snapshot, never from an evolving scan.
 *
 * The result leaves the palette -- a per-channel minimum of two swatches is
 * rarely a swatch -- so a caller re-locks it to its roles afterwards. It also
 * wipes one-pixel ordered dither, so it is for silhouettes and props, not for
 * a stippled sky.
 */

import { PNG } from "pngjs";

/** One erosion (`maximum` false) or dilation of every channel, within a cell. */
function morph(image: PNG, cell: number, maximum: boolean): PNG {
  const { width, height, data } = image;
  const output = new PNG({ width, height });
  const start = maximum ? 0 : -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x / cell) * cell;
      for (let channel = 0; channel < 4; channel += 1) {
        let value = maximum ? 0 : 255;
        for (let dy = start; dy <= start + 1; dy += 1) {
          for (let dx = start; dx <= start + 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < left || nx >= left + cell || ny < 0 || ny >= height) continue;
            const sample = data[(ny * width + nx) * 4 + channel] ?? 0;
            value = maximum ? Math.max(value, sample) : Math.min(value, sample);
          }
        }
        output.data[(y * width + x) * 4 + channel] = value;
      }
    }
  }
  return output;
}

/** Deletes pixels hanging on by one diagonal, judged against a snapshot. */
function clearOrphans(image: PNG, cell: number): PNG {
  const { width, height, data } = image;
  const output = new PNG({ width, height });
  data.copy(output.data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const left = Math.floor(x / cell) * cell;
      let orthogonal = 0;
      let diagonal = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < left || nx >= left + cell || ny < 0 || ny >= height) continue;
          if (data[(ny * width + nx) * 4 + 3] !== 255) continue;
          if (dx === 0 || dy === 0) orthogonal += 1;
          else diagonal += 1;
        }
      }
      if (data[offset + 3] === 0 || (orthogonal === 0 && diagonal === 1)) output.data.fill(0, offset, offset + 4);
    }
  }
  return output;
}

/**
 * Returns `image` with the powdery finish; the input is left untouched.
 *
 * `cell` is the width of one independent frame -- a sprite sheet's facing, or
 * the whole width for a strip -- and nothing is read across its edges. Alpha
 * must be binary, as every plate's is after keying.
 */
export function powderFinish(image: PNG, cell: number = image.width): PNG {
  if (!Number.isInteger(cell) || cell < 1 || image.width % cell !== 0 || image.width < 1 || image.height < 1) {
    throw new Error("powder: invalid image or cell dimensions");
  }
  for (let i = 3; i < image.data.length; i += 4) {
    const alpha = image.data[i]!;
    if (alpha !== 0 && alpha !== 255) throw new Error(`powder: alpha ${alpha} is not binary`);
  }
  let result = morph(image, cell, false);
  result = morph(result, cell, true);
  result = morph(result, cell, true);
  return clearOrphans(morph(result, cell, false), cell);
}

/**
 * The powdery finish in a plate's own art pixels.
 *
 * A plate snapped to a `grid` of output pixels draws one art pixel as a
 * grid x grid block, so a 2x2 finish over output pixels finds almost nothing
 * to simplify: every snapped feature is already 2x2. The unfaker worked in the
 * sprite's own pixels, and so does this -- shrink by the grid (exact, since
 * the plate is snapped), finish, and grow back. `width` and `height` must be
 * multiples of `grid`, which a snapped plate's are.
 */
export function powderFinishAtGrid(image: PNG, grid: number): PNG {
  if (grid <= 1) return powderFinish(image);
  if (image.width % grid !== 0 || image.height % grid !== 0) throw new Error("powder: image is not on its grid");
  const small = new PNG({ width: image.width / grid, height: image.height / grid });
  for (let y = 0; y < small.height; y += 1) {
    for (let x = 0; x < small.width; x += 1) {
      const from = (y * grid * image.width + x * grid) * 4;
      image.data.copy(small.data, (y * small.width + x) * 4, from, from + 4);
    }
  }
  const finished = powderFinish(small);
  const out = new PNG({ width: image.width, height: image.height });
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const from = (Math.floor(y / grid) * finished.width + Math.floor(x / grid)) * 4;
      finished.data.copy(out.data, (y * out.width + x) * 4, from, from + 4);
    }
  }
  return out;
}

/** A pixel the finish must hand back as it was, judged on its colour before the finish. */
export type KeepPixel = (r: number, g: number, b: number, x: number, y: number) => boolean;

/**
 * The powdery finish over a sprite sheet, one `frame` x `frame` cell at a time.
 *
 * `powderFinish`'s `cell` bounds a frame across but not down, and a racer
 * sheet stacks its animations in rows, so a pose's head would be read against
 * the feet of the pose above it. Each frame is finished alone instead.
 *
 * `keep` names the pixels a sprite cannot lose: at 32 pixels an eye is one or
 * two pixels and a mouth is a one-pixel line, which is exactly what a 2x2 open
 * and close exist to delete. Those are put back as they were once the frame is
 * finished, so the silhouette, the suit and its shading take the finish and
 * the face still reads. The rest leaves the palette as the plain finish does,
 * and the caller re-locks it.
 */
export function powderFinishFrames(image: PNG, frame: number, keep?: KeepPixel): PNG {
  if (!Number.isInteger(frame) || frame < 1 || image.width % frame !== 0 || image.height % frame !== 0) {
    throw new Error("powder: frame does not divide the sheet");
  }
  const out = new PNG({ width: image.width, height: image.height });
  const cut = new PNG({ width: frame, height: frame });
  for (let top = 0; top < image.height; top += frame) {
    for (let left = 0; left < image.width; left += frame) {
      for (let y = 0; y < frame; y += 1) {
        const from = ((top + y) * image.width + left) * 4;
        image.data.copy(cut.data, y * frame * 4, from, from + frame * 4);
      }
      const finished = powderFinish(cut);
      for (let y = 0; y < frame; y += 1) {
        finished.data.copy(out.data, ((top + y) * image.width + left) * 4, y * frame * 4, (y + 1) * frame * 4);
      }
    }
  }
  if (keep !== undefined) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const i = (y * image.width + x) * 4;
        if (image.data[i + 3] === 0) continue;
        if (keep(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, x, y)) image.data.copy(out.data, i, i, i + 4);
      }
    }
  }
  return out;
}

/**
 * The powdery finish on a tile that repeats in both directions, at its grid.
 *
 * At a bare edge the finish reads nothing beyond it, so a speck in a corner is
 * sheltered and a bar the edge cuts in half is two slivers. A tile's edge is
 * not an edge on screen: the finish runs over the tile laid out three by
 * three and the middle copy is kept, so every pixel is judged against the
 * neighbours it is drawn beside and the tile still meets itself.
 */
export function powderFinishTiled(image: PNG, grid: number): PNG {
  const { width, height } = image;
  const laid = new PNG({ width: width * 3, height: height * 3 });
  for (let y = 0; y < laid.height; y += 1) {
    const from = (y % height) * width * 4;
    for (let copy = 0; copy < 3; copy += 1) {
      image.data.copy(laid.data, (y * laid.width + copy * width) * 4, from, from + width * 4);
    }
  }
  const finished = powderFinishAtGrid(laid, grid);
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const from = ((height + y) * laid.width + width) * 4;
    finished.data.copy(out.data, y * width * 4, from, from + width * 4);
  }
  return out;
}
