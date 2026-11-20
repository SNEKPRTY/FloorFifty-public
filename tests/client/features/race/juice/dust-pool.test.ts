import { type Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { DustPool } from "../../../../../apps/client/src/features/race/juice/dust-pool";

const PUFF = { count: 3, spread: 10, rise: 4, lifeMs: 180 };
const visible = (pool: DustPool) => pool.root.children.filter((child) => child.visible);

describe("DustPool", () => {
  it("lives for lifeMs, on whole logical units, and is then returned", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit(PUFF, 10, 20, [0xffffff], 0, false);
    expect(pool.live).toBe(3);
    pool.update(90);
    for (const child of visible(pool)) {
      expect(Number.isInteger(child.x)).toBe(true);
      expect(Number.isInteger(child.y)).toBe(true);
    }
    pool.update(181);
    expect(pool.live).toBe(0);
  });

  it("draws in the world's y-down space, above where it was thrown", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit({ ...PUFF, count: 1, spread: 0 }, 0, 100, [0xffffff], 0, false);
    pool.update(170);
    expect(visible(pool)[0]!.y).toBeLessThan(-100);
  });

  it("moves in steps, not a glide", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit({ ...PUFF, count: 1 }, 0, 0, [0xffffff], 0, false);
    pool.update(1);
    const first = [visible(pool)[0]!.x, visible(pool)[0]!.y];
    pool.update(2);
    expect([visible(pool)[0]!.x, visible(pool)[0]!.y]).toEqual(first);
  });

  it("tints each particle from the swatches it is handed, in turn", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit({ ...PUFF, count: 3 }, 0, 0, [0x111111, 0x222222], 0, false);
    expect(visible(pool).map((sprite) => (sprite as unknown as { tint: number }).tint)).toEqual([
      0x111111, 0x222222, 0x111111,
    ]);
  });

  it("never exceeds its limit, and recycles the oldest first", () => {
    const pool = new DustPool(Texture.WHITE, () => 8);
    pool.emit({ ...PUFF, count: 6, spread: 0 }, 0, 0, [0xffffff], 0, false);
    pool.emit({ ...PUFF, count: 6, spread: 0 }, 100, 0, [0xffffff], 10, false);
    expect(pool.live).toBe(8);
    expect(pool.root.children.length).toBe(8);
    expect(visible(pool).filter((child) => child.x === 100)).toHaveLength(6);
  });

  it("a still puff is one frame that does not move", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit(PUFF, 0, 0, [0xffffff], 0, true);
    const before = visible(pool).map((child) => [child.x, child.y]);
    pool.update(100);
    expect(visible(pool).map((child) => [child.x, child.y])).toEqual(before);
  });

  it("clear and destroy leave nothing behind", () => {
    const pool = new DustPool(Texture.WHITE, () => 96);
    pool.emit(PUFF, 0, 0, [0xffffff], 0, false);
    pool.clear();
    expect(pool.live).toBe(0);
    pool.destroy();
    expect(pool.root.destroyed).toBe(true);
  });

  it("throws sparks with the dust: smaller, shorter-lived, in the spark tint, inside the limit (Wonder spec §4.3)", () => {
    const pool = new DustPool(Texture.WHITE, () => 40);
    pool.emit({ count: 10, spread: 20, rise: 4, lifeMs: 400, sparks: 6 }, 0, 0, [0x111111], 0, false, 0xfbff86);
    const sprites = visible(pool) as Sprite[];
    expect(sprites).toHaveLength(16);
    const sparks = sprites.filter((sprite) => sprite.tint === 0xfbff86);
    expect(sparks).toHaveLength(6);
    const dust = sprites.find((sprite) => sprite.tint === 0x111111)!;
    expect(sparks[0]!.width).toBeLessThan(dust.width);
    pool.update(0.7 * 400);
    expect(pool.live).toBe(10); // the sparks are gone at 0.6 of the life
  });

  it("throws sparks alone when the count is zero", () => {
    const pool = new DustPool(Texture.WHITE, () => 40);
    pool.emit({ count: 0, spread: 8, rise: 2, lifeMs: 240, sparks: 4 }, 0, 0, [0x111111], 0, false, 0xfbff86);
    expect(pool.live).toBe(4);
  });
});
