// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyFormFactor } from "../../../../apps/client/src/features/platform/form-factor";

describe("classifyFormFactor (responsive parity spec §2.1)", () => {
  it.each([
    // The reference viewports.
    [360, 640, "phone-portrait"],
    [375, 667, "phone-portrait"],
    [390, 844, "phone-portrait"],
    [430, 932, "phone-portrait"],
    [667, 375, "phone-landscape"],
    [844, 390, "phone-landscape"],
    [932, 430, "phone-landscape"],
    [1280, 720, "desktop"],
    [1440, 900, "desktop"],
    [1180, 820, "desktop"],
    [744, 1133, "tablet-portrait"],
    [820, 1180, "tablet-portrait"],
    [1024, 1366, "tablet-portrait"],
    // The boundaries.
    [599, 900, "phone-portrait"],
    [600, 900, "tablet-portrait"],
    [1000, 499, "phone-landscape"],
    [1000, 500, "desktop"],
    // A short desktop window is phone landscape (Review focus 4).
    [1280, 480, "phone-landscape"],
    // Square is landscape, matching the letterbox's strict `height > width`.
    [400, 400, "phone-landscape"],
    [600, 600, "desktop"],
  ] as const)("%i x %i is %s", (width, height, expected) => {
    expect(classifyFormFactor(width, height)).toBe(expected);
  });
});
