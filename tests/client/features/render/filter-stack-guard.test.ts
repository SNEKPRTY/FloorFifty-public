// @vitest-environment node
import { FilterSystem, RenderTexture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { dropStaleFilterInputs } from "../../../../apps/client/src/features/render/filter-stack-guard";

type StackInternals = {
  _filterStack: { skip: boolean; inputTexture: RenderTexture | null }[];
  _filterStackIndex: number;
  _findFilterResolution(rootResolution: number): number;
};

/**
 * A filter system in the state a resize leaves it: the slot the next push
 * reuses still points at last frame's input, which the pool has destroyed.
 */
function staleFilterSystem(): { renderer: { filter: FilterSystem }; internals: StackInternals } {
  const filter = new FilterSystem({} as never);
  const internals = filter as unknown as StackInternals;
  const stale = RenderTexture.create({ width: 4, height: 4, resolution: 2 });
  stale.destroy(true);
  internals._filterStack = [
    { skip: false, inputTexture: null },
    { skip: false, inputTexture: stale },
  ];
  // As `push` leaves it: the second slot has just been claimed for the new
  // filter, before `_setupFilterTextures` refills its input.
  internals._filterStackIndex = 2;
  return { renderer: { filter }, internals };
}

describe("the filter stack guard", () => {
  it("reproduces Pixi reading a destroyed texture off the slot being pushed", () => {
    // If this stops throwing, Pixi has fixed the lookup and the guard can go.
    const { internals } = staleFilterSystem();
    expect(() => internals._findFilterResolution(2)).toThrow(/_resolution/);
  });

  it("clears the stale inputs, so the lookup falls back to the root resolution", () => {
    const { renderer, internals } = staleFilterSystem();
    dropStaleFilterInputs(renderer);
    expect(internals._filterStack.every((entry) => entry.inputTexture === null)).toBe(true);
    expect(internals._findFilterResolution(2)).toBe(2);
  });

  it("is a no-op on a renderer without a filter system", () => {
    expect(() => dropStaleFilterInputs({})).not.toThrow();
  });
});
