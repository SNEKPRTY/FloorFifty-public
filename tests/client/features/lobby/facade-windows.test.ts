import { describe, expect, it } from "vitest";
import { tiledWindowIds } from "../../../../apps/client/src/features/lobby/facade-windows";

const KEY = [0xf7, 0x96, 0x17] as const;

/** A 6 x 2 tile: wall, with one 2 x 1 window at its right-hand end. */
function tile() {
  const width = 6;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set([0x32, 0x33, 0x53, 255], index * 4);
  for (const x of [4, 5]) data.set([...KEY, 255], x * 4);
  return { data, width, height };
}

describe("tiledWindowIds", () => {
  it("repeats the tile from the building's right-hand corner, as the CSS does", () => {
    // 9 wide: one whole tile on the right, three columns of the next on the left.
    const ids = tiledWindowIds(tile(), 9, 2, KEY);
    const row = Array.from(ids.subarray(0, 9), (id) => id >= 0);
    expect(row).toEqual([false, true, true, false, false, false, false, true, true]);
    // The tile's second row is wall.
    expect(Array.from(ids.subarray(9, 18)).every((id) => id === -1)).toBe(true);
  });

  it("names each window once, the same id on every pane of it", () => {
    const ids = tiledWindowIds(tile(), 9, 2, KEY);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[7]).toBe(ids[8]);
    for (const id of [ids[1]!, ids[7]!]) expect(id).toBeGreaterThanOrEqual(0);
  });
});
