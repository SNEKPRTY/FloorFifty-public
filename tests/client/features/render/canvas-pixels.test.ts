// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { describeCoverage, edgeSharpness, isBlank, maxProbeLineShift } from "../../../e2e/support/pixels";

/** An image of exactly one colour, which is what a failed render looks like. */
function flat(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = rgb[0];
    png.data[index + 1] = rgb[1];
    png.data[index + 2] = rgb[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** A flat field with `count` pixels of a second colour painted into it. */
function flatWithSpecks(width: number, height: number, count: number): Buffer {
  const png = PNG.sync.read(flat(width, height, [26, 33, 72]));
  for (let speck = 0; speck < count; speck += 1) {
    const index = speck * 4;
    png.data[index] = 255;
    png.data[index + 1] = 210;
    png.data[index + 2] = 127;
  }
  return PNG.sync.write(png);
}

/** Something that looks like a rendered scene: a gradient, many colours. */
function gradient(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      png.data[index] = (x * 3) % 256;
      png.data[index + 1] = (y * 5) % 256;
      png.data[index + 2] = ((x + y) * 7) % 256;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("deciding whether a canvas actually drew anything", () => {
  it("calls a single-colour image blank", () => {
    // A renderer that fails after clearing produces exactly this: the clear
    // colour, edge to edge, and nothing else. The old check passed it.
    expect(isBlank(flat(200, 120, [26, 33, 72]))).toBe(true);
  });

  it("calls a black image blank", () => {
    expect(isBlank(flat(200, 120, [0, 0, 0]))).toBe(true);
  });

  it("calls a drawn scene not blank", () => {
    expect(isBlank(gradient(200, 120))).toBe(false);
  });

  it("is not fooled by a handful of stray pixels", () => {
    // Antialiasing, a cursor, or one stray sprite is not a rendered scene.
    expect(isBlank(flatWithSpecks(200, 120, 4))).toBe(true);
  });

  it("accepts a field that is mostly background but genuinely drawn on", () => {
    // The course is sparse: sky, a few platforms, a small ninja. Most of the
    // frame really is background, so the threshold has to allow for that.
    expect(isBlank(flatWithSpecks(200, 120, 200 * 120 * 0.05))).toBe(false);
  });

  it("reports what it measured, so a failure says why", () => {
    const description = describeCoverage(flat(200, 120, [26, 33, 72]));

    expect(description).toMatch(/1 distinct/);
    expect(description).toMatch(/200x120/);
  });

  it("counts the colours it found in a drawn scene", () => {
    expect(describeCoverage(gradient(64, 64))).toMatch(/distinct colour/);
  });
});

/**
 * A refraction probe drawn at `scale` screenshot pixels per logical unit, with
 * every line moved `shift` logical units off where the probe draws it.
 */
function probe(axis: "vertical" | "horizontal", scale: number, shift: number): Buffer {
  const width = 960 * scale;
  const height = 540 * scale;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const across = Math.floor((axis === "vertical" ? x : y) / scale) - shift;
      const lit = across % 32 === 16;
      png.data[index] = lit ? 255 : 0;
      png.data[index + 1] = lit ? 255 : 0;
      png.data[index + 2] = lit ? 255 : 0;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("measuring a refraction probe", () => {
  it("finds no shift in an unwarped probe", () => {
    expect(maxProbeLineShift(probe("vertical", 2, 0), "vertical", { along: [60, 480] })).toBeCloseTo(0, 5);
    expect(maxProbeLineShift(probe("horizontal", 1, 0), "horizontal", { along: [60, 900] })).toBeCloseTo(0, 5);
  });

  it("reports a shift in logical units whatever the pixel density", () => {
    expect(maxProbeLineShift(probe("vertical", 2, 3), "vertical", { along: [60, 480] })).toBeCloseTo(3, 5);
    expect(maxProbeLineShift(probe("horizontal", 1, 3), "horizontal", { along: [60, 900] })).toBeCloseTo(3, 5);
  });
});

/** Dark above, light below, with the change spread over `ramp` rows. */
function edgeImage(ramp: number): Buffer {
  const width = 8;
  const height = 40;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const t = ramp === 0 ? (y < 20 ? 0 : 1) : Math.min(1, Math.max(0, (y - 20 + 1) / (ramp + 1)));
    const value = Math.round(40 + t * 160);
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      png.data[index] = value;
      png.data[index + 1] = value;
      png.data[index + 2] = value;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("measuring edge sharpness", () => {
  const all = { x: 0, y: 0, width: 8, height: 40 };

  it("calls a one-pixel step crisp", () => {
    expect(edgeSharpness(edgeImage(0), all)).toEqual({ edges: 8, crisp: 8 });
  });

  it("counts only edges that involve a named colour when asked", () => {
    // The edge image's dark side is rgb(40,40,40).
    expect(edgeSharpness(edgeImage(0), all, { involving: ["#282828"] }).edges).toBe(8);
    expect(edgeSharpness(edgeImage(0), all, { involving: ["#123456"] }).edges).toBe(0);
    expect(edgeSharpness(edgeImage(0), all, { excluding: ["#282828"] }).edges).toBe(0);
    // The light side is rgb(200,200,200).
    expect(edgeSharpness(edgeImage(0), all, { within: ["#282828", "#c8c8c8"] }).edges).toBe(8);
    expect(edgeSharpness(edgeImage(0), all, { within: ["#282828"] }).edges).toBe(0);
  });

  it("calls an edge spread over several pixels soft", () => {
    const soft = edgeSharpness(edgeImage(3), all);
    expect(soft.edges).toBe(8);
    expect(soft.crisp).toBe(0);
  });
});
