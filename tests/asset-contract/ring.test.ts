/**
 * The Diver's helmet ring (`tools/ring.ts`): found in a bust before the
 * powdery finish, bridged where the cut left it in pieces, and painted back
 * afterwards so it reads as one solid ring (owner, 2026-10-01).
 */
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { ringMask } from "../../packages/asset-contract/tools/ring";

const WHITE = [255, 255, 255] as const;
const SIZE = 40;

/** A seat-coloured bust: a ring of white round a dark visor, with two eyes inside and a strap outside. */
function bust(gap: number): PNG {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - 20, y - 20);
      let rgb: readonly number[] = [77, 155, 230];
      if (d < 9) rgb = [46, 34, 47];
      else if (d < 12 && !(Math.abs(x - 20) < gap / 2 + 0.01 && gap > 0)) rgb = WHITE;
      png.data.set([...rgb, 255], (y * SIZE + x) * 4);
    }
  }
  // Two eyes inside the visor, a strap below the ring: white, but not the ring.
  for (const [x0, y0, w, h] of [[15, 18, 3, 3], [23, 18, 3, 3], [2, 2, 2, 12]] as const) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) png.data.set([...WHITE, 255], (y * SIZE + x) * 4);
  }
  return png;
}

/** How many 8-connected pieces the mask is in. */
function pieces(mask: Uint8Array): number {
  const seen = new Uint8Array(mask.length);
  let count = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    count++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % SIZE, y = Math.floor(c / SIZE);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const k = ny * SIZE + nx;
        if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
  }
  return count;
}

/** Whether a 4-connected flood from the border, through pixels off the mask, never reaches the middle. */
function encloses(mask: Uint8Array): boolean {
  const out = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let i = 0; i < SIZE; i++) for (const k of [i, (SIZE - 1) * SIZE + i, i * SIZE, i * SIZE + SIZE - 1]) if (!mask[k] && !out[k]) { out[k] = 1; stack.push(k); }
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % SIZE, y = Math.floor(c / SIZE);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const k = ny * SIZE + nx;
      if (!mask[k] && !out[k]) { out[k] = 1; stack.push(k); }
    }
  }
  return out[20 * SIZE + 20] === 0;
}

describe("the Diver's helmet ring", () => {
  it("finds the ring and only the ring: not the eyes inside it or a strap outside it", () => {
    const mask = ringMask(bust(0), WHITE);
    expect(mask[18 * SIZE + 15]).toBe(0);
    expect(mask[5 * SIZE + 2]).toBe(0);
    expect(mask[20 * SIZE + 30]).toBe(1);
    expect(pieces(mask)).toBe(1);
  });

  it("bridges a ring the cut left in two halves into one", () => {
    const png = bust(2);
    // The seam really does split it: top and bottom, two pixels wide.
    expect(png.data[(9 * SIZE + 20) * 4]).toBe(77);
    const mask = ringMask(png, WHITE);
    expect(pieces(mask)).toBe(1);
    expect(mask[9 * SIZE + 20]).toBe(1);
    expect(mask[30 * SIZE + 20]).toBe(1);
    // Bridged, not filled: the visor stays out.
    expect(mask[20 * SIZE + 20]).toBe(0);
  });

  it("closes a ring that is one piece but open at one point, like a C", () => {
    const png = bust(0);
    // A one-pixel break across the ring's whole width, on the left only.
    for (let x = 8; x <= 11; x++) png.data.set([77, 155, 230, 255], (20 * SIZE + x) * 4);
    expect(pieces(ringMask(png, WHITE))).toBe(1);
    const mask = ringMask(png, WHITE);
    expect(encloses(mask)).toBe(true);
    expect(mask[20 * SIZE + 9]).toBe(1);
  });
});
