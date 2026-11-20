import { describe, expect, it } from "vitest";
import {
  bandHeight,
  classifyHeightTier,
  COMPACT_MAX_HEIGHT,
  SHORT_MAX_HEIGHT,
} from "../../../../apps/client/src/features/platform/height-tier";

describe("classifyHeightTier (UI layout system spec §3.2)", () => {
  it.each([
    // Every SWEEP size, tests/e2e/support/layout.ts, plus the 900 x 600 window Task 0 adds.
    [360, 640, undefined],
    [375, 667, undefined],
    [390, 844, undefined],
    [430, 932, undefined],
    [667, 375, "short"],
    [844, 390, "short"],
    [932, 430, "short"],
    [780, 270, "compact"],
    [844, 340, "short"],
    [667, 320, "compact"],
    [1280, 480, "short"],
    [1280, 720, undefined],
    [1440, 900, undefined],
    // A tablet held sideways: its band, between the letterbox bars, is a
    // short desktop's (598 px of 820), and it is tiered by that.
    [1180, 820, "short"],
    [1133, 744, "short"],
    [1024, 768, "short"],
    [1366, 1024, undefined],
    [744, 1133, undefined],
    [820, 1180, undefined],
    [1024, 1366, undefined],
    [900, 600, "short"],
    // The boundaries: short is at or below 600 (a 900 x 600 window is short,
    // spec §3.2); compact is strictly below 340, so 844 x 340 Safari stays short.
    // Wide enough that the band is not what decides.
    [1400, 601, undefined],
    [1400, 600, "short"],
    [1000, 339, "compact"],
    [1000, 340, "short"],
  ] as const)("%i x %i is %s", (width, height, expected) => {
    expect(classifyHeightTier(bandHeight(width, height, "field"))).toBe(expected);
  });

  it("measures a landscape screen by its band, never by more than the window", () => {
    // 1180 wide: a 664 px field, less a 5 % bar top and bottom.
    expect(bandHeight(1180, 820, "field")).toBe(597);
    // Wider than the band's 16:9 less its bars, the window is what limits.
    expect(bandHeight(1600, 700, "field")).toBe(700);
    // A phone held sideways is tiered by its window, as it was drawn.
    expect(bandHeight(667, 375, "field")).toBe(375);
    expect(bandHeight(1280, 480, "field")).toBe(480);
    // Portrait draws no bars: the band is the whole height.
    expect(bandHeight(820, 1180, "field")).toBe(1180);
  });

  it("tiers iPad sideways by the window in menu mode and by the field in a race", () => {
    // 1080 x 810: a menu has the whole window, so it is not short and takes the
    // desktop zoom; the race's field is 547 px of it, which is.
    expect(classifyHeightTier(bandHeight(1080, 810, "menu"))).toBeUndefined();
    expect(classifyHeightTier(bandHeight(1080, 810, "field"))).toBe("short");
  });

  it("is the window's height for every form factor in menu mode", () => {
    expect(bandHeight(1440, 900, "menu")).toBe(900);
    expect(bandHeight(1180, 820, "menu")).toBe(820);
    expect(bandHeight(667, 375, "menu")).toBe(375);
  });

  it("names its thresholds", () => {
    expect(SHORT_MAX_HEIGHT).toBe(600);
    expect(COMPACT_MAX_HEIGHT).toBe(340);
  });
});
