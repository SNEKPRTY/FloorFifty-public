import { describe, expect, it } from "vitest";
import { drawUniform, rouletteRng } from "@floor-fifty/shared/room/roulette";

describe("the roulette", () => {
  it("draws the same item for the same seed, round and step", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(drawUniform(rouletteRng(7, 2, "stage"), items)).toBe(drawUniform(rouletteRng(7, 2, "stage"), items));
  });

  it("draws independently per step and per round", () => {
    const items = Array.from({ length: 1000 }, (_unused, index) => index);
    const stage = drawUniform(rouletteRng(7, 0, "stage"), items);
    expect(drawUniform(rouletteRng(7, 0, "song"), items)).not.toBe(stage);
    expect(drawUniform(rouletteRng(7, 1, "stage"), items)).not.toBe(stage);
  });

  it("reaches every item", () => {
    const seen = new Set<string>();
    for (let round = 0; round < 200; round += 1) seen.add(drawUniform(rouletteRng(1, round, "character"), ["x", "y", "z"]));
    expect([...seen].sort()).toEqual(["x", "y", "z"]);
  });

  it("refuses an empty draw", () => {
    expect(() => drawUniform(rouletteRng(1, 0, "stage"), [])).toThrow();
  });
});
