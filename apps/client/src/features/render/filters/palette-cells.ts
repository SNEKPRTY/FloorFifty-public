/**
 * The palette lock's cell table: which swatches can be nearest, per region of
 * the colour cube.
 *
 * The lock's answer is "the first swatch strictly nearer than every earlier
 * one", searched over all 64. Most of those 64 cannot win for a given colour:
 * a colour near the reds is never nearest a blue. So the cube is cut into
 * `CELLS_PER_AXIS`^3 cells, and each cell lists, in palette order, every swatch
 * that is nearest to *some* point in it. Searching only that list, in that
 * order, with the same distance and the same strict comparison, picks the
 * same swatch the full search does -- ties included, since a swatch that ties
 * for nearest at a point is nearest there and is listed.
 *
 * Membership is decided conservatively, from the cell's box: a swatch is
 * listed if its nearest possible distance to the box is no more than the
 * smallest farthest-distance any swatch has to it. That over-lists a little and
 * never under-lists. Each box is grown by `CELL_MARGIN` on every side, so a
 * colour a rounding step outside its cell, or a hair outside the cube, is still
 * covered; the shader searches all 64 for anything further out.
 *
 * Pure, and free of Pixi, so the shader bench can build the same table.
 */

export const CELLS_PER_AXIS = 16;
/** Candidate slots per cell: three per RGB texel. */
export const CELL_TEXELS = 5;
export const CELL_SLOTS = CELL_TEXELS * 3;
/** 16^3 cells of 5 texels each, row-major. */
export const CELL_TEXTURE = { width: 160, height: 128 } as const;
/** Ends a cell's list when it has fewer than `CELL_SLOTS` candidates. */
export const NO_CANDIDATE = 255;
/** How far each cell's box is grown on every side, in unit channels. */
export const CELL_MARGIN = 1 / 512;

/** The lock's distance weights, `2 r^2 + 4 g^2 + 3 b^2`. */
const WEIGHTS = [2, 4, 3] as const;

type Rgb = readonly [number, number, number];

/** The cell a colour falls in, clamped to the cube: what the shader computes. */
export function cellOf(colour: readonly number[]): number {
  const q = colour.slice(0, 3).map((channel) => Math.min(CELLS_PER_AXIS - 1, Math.max(0, Math.floor(channel * CELLS_PER_AXIS))));
  return (q[0]! * CELLS_PER_AXIS + q[1]!) * CELLS_PER_AXIS + q[2]!;
}

/**
 * The table, as RGBA bytes for a `CELL_TEXTURE`-sized texture: each cell's
 * candidates as swatch indices in the red, green and blue of its texels, then
 * `NO_CANDIDATE`. Alpha is 255, so an upload that premultiplies is a no-op.
 */
export function paletteCellTable(swatches: readonly Rgb[]): Uint8Array {
  const table = new Uint8Array(CELL_TEXTURE.width * CELL_TEXTURE.height * 4).fill(NO_CANDIDATE);
  const step = 1 / CELLS_PER_AXIS;
  // Per axis, per cell index along it, each swatch's weighted nearest and
  // farthest squared gap to that slab of the cube. A box's distance is the sum
  // over its three axes, so the 4096 boxes are built from 3 x 16 x 64 terms
  // rather than recomputing each: the stage builds this table at start-up,
  // on the phone it is slowest on.
  const near = [0, 1, 2].map(() => new Float64Array(CELLS_PER_AXIS * swatches.length));
  const far = [0, 1, 2].map(() => new Float64Array(CELLS_PER_AXIS * swatches.length));
  for (let c = 0; c < 3; c += 1) {
    for (let q = 0; q < CELLS_PER_AXIS; q += 1) {
      const lo = q * step - CELL_MARGIN;
      const hi = (q + 1) * step + CELL_MARGIN;
      swatches.forEach((swatch, s) => {
        const value = swatch[c]!;
        const gap = value < lo ? lo - value : value > hi ? value - hi : 0;
        const reach = Math.max(Math.abs(value - lo), Math.abs(value - hi));
        near[c]![q * swatches.length + s] = WEIGHTS[c]! * gap * gap;
        far[c]![q * swatches.length + s] = WEIGHTS[c]! * reach * reach;
      });
    }
  }
  for (let cell = 0; cell < CELLS_PER_AXIS ** 3; cell += 1) {
    const r = Math.floor(cell / CELLS_PER_AXIS ** 2) * swatches.length;
    const g = (Math.floor(cell / CELLS_PER_AXIS) % CELLS_PER_AXIS) * swatches.length;
    const b = (cell % CELLS_PER_AXIS) * swatches.length;
    let bound = Number.POSITIVE_INFINITY;
    for (let s = 0; s < swatches.length; s += 1) {
      bound = Math.min(bound, far[0]![r + s]! + far[1]![g + s]! + far[2]![b + s]!);
    }
    // The slack covers float32 rounding in the shader's own distances, which
    // run to 9 in these units.
    bound += 1e-5;
    let slot = 0;
    for (let s = 0; s < swatches.length; s += 1) {
      if (near[0]![r + s]! + near[1]![g + s]! + near[2]![b + s]! > bound) continue;
      if (slot === CELL_SLOTS) throw new RangeError(`cell ${cell} has more candidates than its ${CELL_SLOTS} slots`);
      table[(cell * CELL_TEXELS + Math.floor(slot / 3)) * 4 + (slot % 3)] = s;
      slot += 1;
    }
  }
  for (let alpha = 3; alpha < table.length; alpha += 4) table[alpha] = 255;
  return table;
}

/** A cell's candidates, read back out of the table in the order the shader reads them. */
export function cellCandidates(table: Uint8Array, cell: number): number[] {
  const candidates: number[] = [];
  for (let slot = 0; slot < CELL_SLOTS; slot += 1) {
    const value = table[(cell * CELL_TEXELS + Math.floor(slot / 3)) * 4 + (slot % 3)]!;
    if (value === NO_CANDIDATE) break;
    candidates.push(value);
  }
  return candidates;
}
