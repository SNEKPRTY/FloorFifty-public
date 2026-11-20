import { describe, expect, it } from "vitest";
import type { Filter } from "pixi.js";
import { createPaletteLockFilter } from "../../../../apps/client/src/features/render/filters/palette-lock";
import {
  resolveCityFilters,
  resolveSkyFilters,
} from "../../../../apps/client/src/features/profile/quality";

/**
 * A real filter.
 *
 * `new Filter()` is not constructible without a program in Pixi 8, and a
 * resolver that only ever sees stand-ins would not prove it returns the
 * instances it was handed.
 */
const real = (): Filter => createPaletteLockFilter();

const LEVELS = ["high", "medium", "low"] as const;

describe("the sky plate's chain", () => {
  it("is sky, then refraction, then the lock, at every level", () => {
    // Low keeps the refraction: that level's variant is the static diffusion,
    // which is the same pass with its warp at zero rather than a different one.
    for (const level of LEVELS) {
      const sky = real();
      const refraction = real();
      const paletteLock = real();
      expect(resolveSkyFilters(level, { sky, refraction, paletteLock })).toEqual([
        sky,
        refraction,
        paletteLock,
      ]);
    }
  });

  it("omits only refraction when its shader will not compile", () => {
    const sky = real();
    const paletteLock = real();
    expect(resolveSkyFilters("high", { sky, refraction: undefined, paletteLock })).toEqual([
      sky,
      paletteLock,
    ]);
  });
});

describe("the city stack's chain", () => {
  it("runs the atmosphere, then its own lock, above low", () => {
    for (const level of ["high", "medium"] as const) {
      const city = real();
      const paletteLock = real();
      expect(resolveCityFilters(level, { city, paletteLock })).toEqual([city, paletteLock]);
    }
  });

  it("drops the atmosphere at low and keeps the lock", () => {
    const city = real();
    const paletteLock = real();
    expect(resolveCityFilters("low", { city, paletteLock })).toEqual([paletteLock]);
  });

  it("still draws the city when a filter cannot be built", () => {
    // A renderer that cannot compile a program must still render: the chain
    // degrades to the passes that exist rather than throwing out of the mount.
    const paletteLock = real();
    expect(resolveCityFilters("high", { city: undefined, paletteLock })).toEqual([paletteLock]);
    expect(resolveCityFilters("high", { city: undefined, paletteLock: undefined })).toEqual([]);
  });
});

describe("the city's refraction (spec §2.9)", () => {
  it("sits after the atmosphere and before the lock", () => {
    const [city, refraction, paletteLock] = [real(), real(), real()];
    expect(resolveCityFilters("high", { city, refraction, paletteLock })).toEqual([city, refraction, paletteLock]);
    expect(resolveCityFilters("low", { city, refraction, paletteLock })).toEqual([refraction, paletteLock]);
    expect(resolveCityFilters("high", { city, refraction: undefined, paletteLock })).toEqual([city, paletteLock]);
  });
});

describe("both chains", () => {
  it("keep the palette lock last at every level", () => {
    // The lock folds every off-palette blend above it back into the 64
    // swatches; anything after it would escape that guarantee.
    for (const level of LEVELS) {
      const skyLock = real();
      const cityLock = real();
      expect(resolveSkyFilters(level, { sky: real(), refraction: real(), paletteLock: skyLock }).at(-1)).toBe(skyLock);
      expect(resolveCityFilters(level, { city: real(), paletteLock: cityLock }).at(-1)).toBe(cityLock);
    }
  });
});
