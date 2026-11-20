import { describe, expect, it } from "vitest";
import { LCD_PANEL } from "../../../../../apps/client/src/lib/constants";
import {
  derivePitch,
  panelOptionsFor,
  panelSuppressedFor,
  resolvePanelOptions,
} from "../../../../../apps/client/src/features/render/panel/panel-options";

describe("pitch derivation", () => {
  it("quantises the period to whole logical units at each viewport", () => {
    // `cells` is how many logical units one period spans. The period is then
    // never shorter than `minPitch` CSS pixels, which is the whole point of
    // the ceiling.
    expect(derivePitch(2.0, 3.0, 1).cells).toBe(2);
    expect(derivePitch(2.0, 3.0, 1).periodCssPx).toBeCloseTo(4.0, 6);

    expect(derivePitch(1.2, 3.0, 1).cells).toBe(3);
    expect(derivePitch(1.2, 3.0, 1).periodCssPx).toBeCloseTo(3.6, 6);

    expect(derivePitch(0.5, 3.0, 1).cells).toBe(6);
    expect(derivePitch(0.5, 3.0, 1).periodCssPx).toBeCloseTo(3.0, 6);
  });

  it("never lets a period fall below the minimum pitch", () => {
    for (const cellSize of [0.4, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0]) {
      expect(derivePitch(cellSize, 3.0, 1).periodCssPx).toBeGreaterThanOrEqual(3.0 - 1e-9);
    }
  });

  it("keeps at least one cell per period", () => {
    // A display dense enough that `minPitch` is under one logical unit must
    // still land on a whole cell, or the pattern stops being periodic on the
    // logical grid.
    expect(derivePitch(8.0, 3.0, 1).cells).toBe(1);
  });

  it("does not change the cell count on a denser display", () => {
    // `minPitch` is in CSS pixels on purpose: a 2x display draws the same
    // pattern at the same apparent size, with twice as many device pixels to
    // draw it with. Quantising on device pixels instead would halve the mesh
    // on every phone.
    for (const cellSize of [0.5, 1.2, 2.0]) {
      expect(derivePitch(cellSize, 3.0, 2).cells).toBe(derivePitch(cellSize, 3.0, 1).cells);
      expect(derivePitch(cellSize, 3.0, 2).periodCssPx).toBeCloseTo(
        derivePitch(cellSize, 3.0, 1).periodCssPx,
        6,
      );
    }
  });

  it("measures the frequency in device pixels, because that is what the shader samples", () => {
    // The fragment program runs once per device pixel, so `cyclesPerPixel` --
    // which drives the box filter's footprint and the Nyquist fade -- has to
    // be per device pixel, not per CSS pixel. Getting this backwards
    // band-limits the mesh for a footprint twice the real one.
    const one = derivePitch(1.333, 3.0, 1);
    const two = derivePitch(1.333, 3.0, 2);

    expect(two.periodDevicePx).toBeCloseTo(one.periodDevicePx * 2, 6);
    expect(two.cyclesPerPixel).toBeCloseTo(one.cyclesPerPixel / 2, 6);
  });

  it("fades on the minimum pitch, not on device density", () => {
    // This is the assertion that is easy to get backwards. Because `cells`
    // adapts, `cyclesPerPixel` is bounded by `1 / minPitch` at every viewport,
    // so density alone can never push the mesh past Nyquist.
    for (const cellSize of [0.5, 1.2, 2.0]) {
      expect(derivePitch(cellSize, 3.0, 1).fade).toBe(1);
      expect(derivePitch(cellSize, 3.0, 1).cyclesPerPixel).toBeLessThanOrEqual(1 / 3 + 1e-9);
    }

    // Lowered to the bottom of its range, the pattern is genuinely
    // unresolvable and is removed outright rather than left to alias.
    expect(derivePitch(2.0, 2.0, 1).cyclesPerPixel).toBeCloseTo(0.5, 6);
    expect(derivePitch(2.0, 2.0, 1).fade).toBe(0);

    // The same tuning on a 2x display resolves perfectly well, and the fade
    // correctly stays out of the way. A denser display never removes a mesh.
    expect(derivePitch(2.0, 2.0, 2).fade).toBe(1);
  });
});

describe("the dev override parser", () => {
  it("returns the defaults for an absent or empty parameter", () => {
    expect(resolvePanelOptions("")).toEqual(LCD_PANEL);
    expect(resolvePanelOptions("?other=1")).toEqual(LCD_PANEL);
    expect(resolvePanelOptions("?lcd=")).toEqual(LCD_PANEL);
  });

  it("overrides only the keys it is given", () => {
    const options = resolvePanelOptions("?lcd=grid:0.5,scanlines:0.35");
    expect(options.grid).toBe(0.5);
    expect(options.scanlines).toBe(0.35);
    expect(options.aberration).toBe(LCD_PANEL.aberration);
  });

  it("ignores unknown keys and unparseable values rather than passing NaN to a uniform", () => {
    const options = resolvePanelOptions("?lcd=nonsense:1,grid:banana,glow:0.4");
    expect(options.grid).toBe(LCD_PANEL.grid);
    expect(options.glow).toBe(0.4);
    expect(Number.isFinite(options.grid)).toBe(true);
  });

  it("rejects a non-finite value", () => {
    expect(resolvePanelOptions("?lcd=brightness:Infinity").brightness).toBe(LCD_PANEL.brightness);
  });

  it("tolerates whitespace and empty segments", () => {
    expect(resolvePanelOptions("?lcd= grid : 0.5 ,, ").grid).toBe(0.5);
  });
});

describe("the production gate", () => {
  it("reads the overrides in a dev build", () => {
    expect(panelOptionsFor("?lcd=grid:0.5", true).grid).toBe(0.5);
  });

  it("ignores them entirely in a production build", () => {
    // The gate, not the parser. A `?lcd=` in a shipped build must be inert
    // however well-formed it is, and that is the branch nothing exercised
    // while this lived as a ternary in the gameplay screen.
    expect(panelOptionsFor("?lcd=grid:0.5,scanlines:0.9", false)).toEqual(LCD_PANEL);
  });

  it("returns a copy rather than the constant itself", () => {
    // `LCD_PANEL` is frozen only by its type. A caller handed the object back
    // could mutate the defaults for every screen that follows.
    const options = panelOptionsFor("", false);
    expect(options).not.toBe(LCD_PANEL);
    expect(options).toEqual(LCD_PANEL);
  });
});

describe("the inspection-only panel switch", () => {
  it("turns the panel off only where inspection is allowed and asked for", () => {
    expect(panelSuppressedFor("?lcd=off", true)).toBe(true);
    expect(panelSuppressedFor("?lcd=off", false)).toBe(false);
    expect(panelSuppressedFor("?lcd=grid:0.5", true)).toBe(false);
    expect(panelSuppressedFor("", true)).toBe(false);
  });
});
