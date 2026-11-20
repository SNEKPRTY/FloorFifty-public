// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_RESOLUTION, SOFTWARE_RESOLUTION, canvasResolutionFor } from "../../../../apps/client/src/features/platform/canvas-resolution";

describe("canvasResolutionFor (responsive parity, the tablet frame budget)", () => {
  it("keeps the device's density, capped at 2, on phones and desktop", () => {
    expect(canvasResolutionFor("phone-portrait", 3)).toBe(MAX_RESOLUTION);
    expect(canvasResolutionFor("phone-landscape", 2.625)).toBe(MAX_RESOLUTION);
    expect(canvasResolutionFor("desktop", 2)).toBe(2);
    expect(canvasResolutionFor("desktop", 1)).toBe(1);
    expect(canvasResolutionFor("desktop", 0)).toBe(1);
  });

  it("draws a tablet held upright at one device pixel per CSS pixel", () => {
    // Four times a phone's CSS area: at 2x it is ~3.9M device pixels, which the
    // filter chain cannot hold to budget (plan Task 15).
    expect(canvasResolutionFor("tablet-portrait", 2)).toBe(1);
    expect(canvasResolutionFor("tablet-portrait", 1)).toBe(1);
  });

  it("draws a software renderer at half a device pixel per CSS pixel on every form factor", () => {
    // A CPU rasteriser pays for every device pixel of every pass: the bloom's
    // eight blurs alone were a third of a 1280 x 720 frame at 1x.
    expect(SOFTWARE_RESOLUTION).toBeLessThan(1);
    expect(canvasResolutionFor("phone-portrait", 2.625, true)).toBe(SOFTWARE_RESOLUTION);
    expect(canvasResolutionFor("tablet-portrait", 2, true)).toBe(SOFTWARE_RESOLUTION);
    expect(canvasResolutionFor("desktop", 1, true)).toBe(SOFTWARE_RESOLUTION);
    expect(canvasResolutionFor("phone-landscape", 2.625, false)).toBe(MAX_RESOLUTION);
  });
});
