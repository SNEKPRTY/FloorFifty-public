/**
 * The uniforms a set piece drives (Wonder spec §6.4): a mood tinted before the
 * palette lock snaps, and a lights-out wave in the city's windows.
 */
import type { Filter } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SET_PIECE_MOODS } from "@floor-fifty/shared/content/game-content";
import { createCityFilter, setCityLightsOut } from "../../../../../apps/client/src/features/render/filters/city-atmosphere";
import {
  MOOD_TINTS,
  brightestPixel,
  createPaletteLockFilter,
  setPaletteMood,
} from "../../../../../apps/client/src/features/render/filters/palette-lock";

const moodOf = (filter: Filter) =>
  (filter.resources["moodUniforms"] as { uniforms: { uMoodTint: Float32Array; uMoodMix: number; uMoodCeil: Float32Array } }).uniforms;
const fragmentOf = (filter: Filter): string => (filter.glProgram as unknown as { fragment: string }).fragment;

describe("the palette lock's mood (Wonder spec §6.4)", () => {
  it("starts neutral: no tint, no mix", () => {
    const lock = createPaletteLockFilter();
    expect([...moodOf(lock).uMoodTint]).toEqual([1, 1, 1]);
    expect(moodOf(lock).uMoodMix).toBe(0);
  });

  it("writes a mood's tint and mix", () => {
    const lock = createPaletteLockFilter();
    setPaletteMood(lock, MOOD_TINTS.sunset, 0.5);
    expect([...moodOf(lock).uMoodTint].map((value) => Number(value.toFixed(3)))).toEqual([...MOOD_TINTS.sunset]);
    expect(moodOf(lock).uMoodMix).toBe(0.5);
  });

  it("tints before the swatch search, so the lock snaps the mood onto the palette", () => {
    const fragment = fragmentOf(createPaletteLockFilter());
    expect(fragment.indexOf("uMoodMix")).toBeGreaterThan(-1);
    expect(fragment.indexOf("uMoodMix", fragment.indexOf("void main"))).toBeLessThan(fragment.indexOf("for (int i = 0"));
  });

  it("names a tint for every mood a stage may author", () => {
    expect(Object.keys(MOOD_TINTS).sort()).toEqual([...SET_PIECE_MOODS].sort());
  });

  it("leaves a filter without the mood alone", () => {
    const plain = createCityFilter({ window: 0xffffff, ramp: { dim: 0, bright: 0, hot: 0 }, coded: false });
    expect(() => setPaletteMood(plain, MOOD_TINTS.night, 1)).not.toThrow();
  });
});

describe("the city's lights-out wave (Wonder spec §6.4)", () => {
  const cityOf = (filter: Filter) =>
    (filter.resources["cityUniforms"] as { uniforms: { uLightsOut: Float32Array } }).uniforms;

  it("starts with every light on, and writes the wave's height and whether it blazes", () => {
    const city = createCityFilter({ window: 0xffffff, ramp: { dim: 0, bright: 0, hot: 0 }, coded: false });
    expect([...cityOf(city).uLightsOut]).toEqual([0, 0, 0]);
    setCityLightsOut(city, 0.5, true);
    expect([...cityOf(city).uLightsOut]).toEqual([0.5, 1, 0]);
    setCityLightsOut(city, 1, false, 0.25);
    expect([...cityOf(city).uLightsOut]).toEqual([1, 0, 0.25]);
    expect(fragmentOf(city)).toContain("uLightsOut");
  });

  it("holds a flash under a ceiling: no tinted colour brighter than the plate's brightest (audit)", () => {
    const lock = createPaletteLockFilter();
    const fragment = fragmentOf(lock);
    expect(fragment).toContain("uMoodCeil");
    expect([...moodOf(lock).uMoodCeil]).toEqual([1, 1, 1]);
    setPaletteMood(lock, [1.6, 1.6, 1.7], 1, [0.8, 0.7, 0.6]);
    expect([...moodOf(lock).uMoodCeil].map((value) => Number(value.toFixed(3)))).toEqual([0.8, 0.7, 0.6]);
    setPaletteMood(lock, MOOD_TINTS.night, 1);
    expect([...moodOf(lock).uMoodCeil]).toEqual([1, 1, 1]);
  });

  it("finds a plate's brightest pixel by luma", () => {
    const data = new Uint8ClampedArray([10, 10, 10, 255, 250, 20, 20, 255, 200, 200, 200, 255, 255, 255, 255, 0]);
    expect(brightestPixel(data)).toEqual([200 / 255, 200 / 255, 200 / 255]); // a transparent texel never counts
  });
});
