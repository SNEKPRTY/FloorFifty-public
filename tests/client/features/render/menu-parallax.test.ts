// @vitest-environment node
/**
 * The menu's parallax (launch polish spec §2.9 item 2): a slow sway, and a
 * small offset toward the pointer where there is one, the nearer layers moving
 * most. Pure in its inputs, and still under reduced motion.
 */

import { describe, expect, it } from "vitest";
import { MENU_PARALLAX, MENU_TILT, menuParallax, tiltLean } from "../../../../apps/client/src/features/render/menu-parallax";

const size = (offset: { x: number; y: number }) => Math.hypot(offset.x, offset.y);

describe("the menu's parallax", () => {
  it("sways with time, with no pointer, the nearer layers furthest", () => {
    const at = menuParallax(6, undefined, false);
    expect(at).not.toEqual(menuParallax(0, undefined, false));
    expect(size(at.near)).toBeGreaterThanOrEqual(size(at.far));
    expect(size(at.far)).toBeGreaterThanOrEqual(size(at.clouds));
    expect(size(at.clouds)).toBeGreaterThanOrEqual(size(at.sky));
    expect(size(at.near)).toBeGreaterThan(0);
  });

  it("leans toward the pointer, the near layer by the full pointer reach", () => {
    const none = menuParallax(3, undefined, false);
    const right = menuParallax(3, { x: 1, y: 0 }, false);
    expect(right.near.x - none.near.x).toBeCloseTo(MENU_PARALLAX.pointerUnits * MENU_PARALLAX.depth.near, 6);
    expect(right.far.x - none.far.x).toBeCloseTo(MENU_PARALLAX.pointerUnits * MENU_PARALLAX.depth.far, 6);
  });

  it("holds every layer at rest under reduced motion", () => {
    for (const layer of Object.values(menuParallax(9, { x: 1, y: -1 }, true))) {
      expect(layer).toEqual({ x: 0, y: 0 });
    }
  });

  it("is pure in its inputs", () => {
    expect(menuParallax(4.2, { x: 0.3, y: 0.1 }, false)).toEqual(menuParallax(4.2, { x: 0.3, y: 0.1 }, false));
  });
});

describe("the device's tilt, standing in for the pointer", () => {
  const rest = { beta: 40, gamma: 0 };

  it("is centred where the device is held", () => {
    const lean = tiltLean(rest, rest, 0);
    expect(lean.x).toBeCloseTo(0, 9);
    expect(lean.y).toBeCloseTo(0, 9);
  });

  it("leans sideways with a sideways tilt, to the frame's edge at the full range", () => {
    expect(tiltLean({ beta: 40, gamma: MENU_TILT.rangeDegrees / 2 }, rest, 0).x).toBeCloseTo(0.5, 6);
    expect(tiltLean({ beta: 40, gamma: 90 }, rest, 0)).toEqual({ x: 1, y: 0 });
    expect(tiltLean({ beta: 40, gamma: -90 }, rest, 0).x).toBe(-1);
  });

  it("swaps the sensor's axes when the screen is turned", () => {
    const tipped = { beta: 40 + MENU_TILT.rangeDegrees, gamma: 0 };
    expect(tiltLean(tipped, rest, 0).y).toBe(1);
    expect(tiltLean(tipped, rest, 90).x).toBe(1);
    expect(tiltLean(tipped, rest, 270).x).toBe(-1);
  });
});
