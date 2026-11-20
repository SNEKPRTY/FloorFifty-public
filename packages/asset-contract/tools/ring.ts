/**
 * The Diver's helmet ring, found so it can be painted back solid.
 *
 * The powdery finish broke the thin white rivet ring round the Diver's visor
 * into dashes, and on some busts the cut had already left it in two halves
 * where the source drew a seam. The owner's condition for the finish
 * (2026-10-01): the ring stays one solid ring. So it is found in the bust
 * before the finish, bridged, and painted back afterwards -- the same
 * restore-after-finish the eyes and the inner outline get.
 *
 * Found by shape rather than by position, because the cut puts each bust's
 * ring somewhere slightly different. The largest patch of the ring's colour is
 * always a large arc of it, so a circle is fitted to that patch; every patch
 * of the colour that lies mostly on that circle is ring. The eyes sit well
 * inside it, the straps and the helmet's crown well outside, and the collar,
 * which touches the ring's foot, runs away from the circle along most of its
 * width. Then the pieces are closed across gaps of a pixel or two until they
 * are one.
 */

import type { PNG } from "pngjs";

type Rgb = readonly [number, number, number];

/** 8-connected patches of `colour`. */
function patches(png: PNG, colour: Rgb): number[][] {
  const { width, height, data } = png;
  const is = (i: number): boolean =>
    data[i * 4 + 3] !== 0 && data[i * 4] === colour[0] && data[i * 4 + 1] === colour[1] && data[i * 4 + 2] === colour[2];
  const seen = new Uint8Array(width * height);
  const out: number[][] = [];
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || !is(start)) continue;
    const patch: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      patch.push(at);
      const x = at % width;
      const y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const k = ny * width + nx;
          if (!seen[k] && is(k)) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    out.push(patch);
  }
  return out;
}

/** The least-squares circle through a set of pixels (Kasa's algebraic fit). */
function fitCircle(points: readonly number[], width: number): { cx: number; cy: number; r: number } {
  // Minimise sum (x^2 + y^2 + D x + E y + F)^2: three normal equations.
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = points.length;
  for (const at of points) {
    const x = at % width;
    const y = Math.floor(at / width);
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [-sxz, -syz, -sz];
  const det = (a: number[][]): number =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  const solve = (column: number): number => det(m.map((row, i) => row.map((v, j) => (j === column ? rhs[i]! : v)))) / d;
  const D = solve(0);
  const E = solve(1);
  const F = solve(2);
  const cx = -D / 2;
  const cy = -E / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, cx * cx + cy * cy - F)) };
}

/** `mask` closed with a (2 * radius + 1) square: dilated, then eroded. */
function close(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const pass = (from: Uint8Array, dilate: boolean): Uint8Array => {
    const out = new Uint8Array(from.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let hit = !dilate;
        for (let dy = -radius; dy <= radius && hit !== dilate; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            // Off the image counts as "set" for an erosion, so a ring near the
            // edge is not eaten from outside.
            const on = nx < 0 || ny < 0 || nx >= width || ny >= height ? !dilate : from[ny * width + nx] === 1;
            if (on === dilate) {
              hit = dilate;
              break;
            }
          }
        }
        out[y * width + x] = hit ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** How many 8-connected pieces `mask` is in. */
function pieces(mask: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(mask.length);
  let count = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    count += 1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % width;
      const y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const k = ny * width + nx;
          if (mask[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
  }
  return count;
}

/** A patch smaller than this is a fleck. The eyes are larger, but lie well inside the circle. */
const MIN_PIECE = 3;
/**
 * The share of a patch that must lie on the fitted circle for it to be ring.
 * Half, because a circle through one half of a split ring still catches about
 * two thirds of the other half (64% on the cyan Diver); the eyes, straps,
 * crown and collar measure none.
 */
const ON_RING = 0.5;
/** The widest gap closed between two pieces of the ring, in pixels. */
const MAX_BRIDGE = 3;

/**
 * The ring of `colour` round the visor, as one 8-connected piece: 1 for ring,
 * 0 for everything else. Empty if no patch of the colour is large enough.
 */
export function ringMask(png: PNG, colour: Rgb): Uint8Array {
  const { width, height } = png;
  const mask = new Uint8Array(width * height);
  const found = patches(png, colour).filter((patch) => patch.length >= MIN_PIECE);
  if (found.length === 0) return mask;
  const largest = found.reduce((a, b) => (b.length > a.length ? b : a));
  // Fitted twice. Where the cut split the ring in halves, the largest patch is
  // one half, and a circle through a half sits off-centre -- far enough that
  // most of the other half misses it. The second fit is through every patch
  // the first one found, which is the whole ring.
  let ring: number[][] = [largest];
  let circle = fitCircle(largest, width);
  for (let pass = 0; pass < 2; pass += 1) {
    const { cx, cy, r } = circle;
    const off = (at: number): number => Math.abs(Math.hypot((at % width) - cx, Math.floor(at / width) - cy) - r);
    // The ring's half-thickness, from what the circle was fitted to.
    const spread = ring.flat().map(off).sort((a, b) => a - b);
    const band = spread[Math.floor(spread.length * 0.9)]! + 1;
    ring = found.filter((patch) => patch === largest || patch.filter((at) => off(at) <= band).length >= patch.length * ON_RING);
    circle = fitCircle(ring.flat(), width);
  }
  for (const at of ring.flat()) mask[at] = 1;
  const { cx, cy } = circle;
  // One piece is not enough: a ring broken at a single point is one piece
  // shaped like a C. It is whole when it is one piece and closes round its
  // own middle.
  const centre = Math.round(cy) * width + Math.round(cx);
  const whole = (m: Uint8Array): boolean => pieces(m, width, height) <= 1 && encloses(m, width, height, centre);
  for (let radius = 1; radius <= Math.ceil(MAX_BRIDGE / 2) + 1 && !whole(mask); radius += 1) {
    mask.set(close(mask, width, height, radius));
  }
  return mask;
}

/**
 * Whether `mask` closes round pixel `centre`: a 4-connected flood from the
 * image's border, through pixels off the mask, never reaches it. A closed
 * 8-connected ring stops a 4-connected flood, so a diagonal step still counts
 * as closed, as it reads on screen.
 */
function encloses(mask: Uint8Array, width: number, height: number, centre: number): boolean {
  if (centre < 0 || centre >= mask.length || mask[centre]) return false;
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const seed = (k: number): void => {
    if (!mask[k] && !outside[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length > 0) {
    const at = stack.pop()!;
    const x = at % width;
    const y = Math.floor(at / width);
    if (x > 0) seed(at - 1);
    if (x < width - 1) seed(at + 1);
    if (y > 0) seed(at - width);
    if (y < height - 1) seed(at + width);
  }
  return outside[centre] === 0;
}
