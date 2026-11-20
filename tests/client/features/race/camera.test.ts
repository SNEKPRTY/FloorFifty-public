import { describe, expect, it } from "vitest";
import { CAMERA, LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { courseBounds } from "@floor-fifty/shared/level/course";
import {
  CONTENT_FIT_MARGIN,
  DANGER_ZOOM,
  visibleField,
  contentFitZoom,
  PORTRAIT_RACER_HEIGHT,
  WorldCamera,
} from "../../../../apps/client/src/features/race/camera";
import { INDICATOR_WIDTH_SCALE } from "../../../../apps/client/src/features/race/platform-view";

describe("the visible part of the field (review I1)", () => {
  it("is the gameplay rectangle in field units", () => {
    // 1280x720: scale 4/3, field at y 0, bars of 48 px over its top and bottom.
    expect(
      visibleField({ canvasCss: { width: 1280 }, gameplayCss: { y: 48, height: 624 }, sceneryLogical: { y: 0 } }),
    ).toEqual({ top: 36, bottom: 504 });
    // 844x390 (wider than 16:9): the field overflows the canvas, 42 px above.
    const wide = visibleField({ canvasCss: { width: 844 }, gameplayCss: { y: 0, height: 390 }, sceneryLogical: { y: 47.8 } });
    expect(wide.top).toBeCloseTo(47.8, 6);
    expect(wide.bottom).toBeCloseTo(47.8 + 390 / (844 / 960), 6);
  });
});

describe("the camera's field reading (lava spec §5)", () => {
  it("reads back the logical y drawn at a field y", () => {
    for (const portrait of [false, true]) {
      const camera = new WorldCamera();
      camera.setField(portrait, portrait ? 900 : 540);
      camera.cutTo(1000);
      const screen = camera.logicalToScreen({ x: 0, y: 1234 }).y;
      expect(camera.logicalYAtScreen(screen)).toBeCloseTo(1234, 6);
    }
  });

  it("measures the visible field's bottom, not the field's (review I1)", () => {
    const camera = new WorldCamera();
    camera.setField(false, 540);
    expect(camera.visibleBottom()).toBe(540);
    camera.setVisible(40, 492);
    expect(camera.visibleBottom()).toBe(492);
  });

  it("tightens by at most DANGER_ZOOM at full danger", () => {
    const camera = new WorldCamera();
    const calm = camera.transform().scale;
    camera.setDanger(1);
    expect(camera.transform().scale / calm).toBeCloseTo(1 / (1 - DANGER_ZOOM), 6);
    camera.setDanger(5);
    expect(camera.transform().scale / calm).toBeCloseTo(1 / (1 - DANGER_ZOOM), 6);
    expect(DANGER_ZOOM).toBe(0.04);
  });
});

describe("the world camera", () => {
  it("shows less than the logical viewport when settled", () => {
    // The reference's stationary zoom is 0.8 of an orthographic projection,
    // which shows 0.8x the extent. A container scale is that value's
    // reciprocal, and copying the number across without inverting it is what
    // made the port's settled camera show 1.25x instead.
    const camera = new WorldCamera();
    camera.update({ moving: false, targetY: 0 }, 5);

    const visibleWidth = LOGICAL_VIEWPORT.width / camera.transform().scale;
    expect(visibleWidth).toBeCloseTo(LOGICAL_VIEWPORT.width * CAMERA.stationaryZoom, 3);
    expect(visibleWidth).toBeLessThan(LOGICAL_VIEWPORT.width);
  });

  it("widens while moving, but never past one wrap of the course", () => {
    // This used to assert the frame grew *past* the logical viewport, because
    // the reference's motion zoom is 1.1. It is 1.0 here: the course wraps
    // every viewport width, and a frame wider than the wrap shows the far side
    // of the course beside the near side. The zoom still opens up while
    // moving, it just stops where the course starts repeating.
    const camera = new WorldCamera();
    camera.update({ moving: true, targetY: 0 }, 5);

    const visibleWidth = LOGICAL_VIEWPORT.width / camera.transform().scale;
    expect(visibleWidth).toBeCloseTo(LOGICAL_VIEWPORT.width * CAMERA.motionZoom, 3);
    expect(visibleWidth).toBeGreaterThan(LOGICAL_VIEWPORT.width * CAMERA.stationaryZoom);
    expect(visibleWidth).toBeLessThanOrEqual(LOGICAL_VIEWPORT.width);
  });
});

describe("the phone-portrait zoom", () => {
  const tuning = resolveTuning();

  it("shows the outermost floor marker and nothing wider, so no platform is ever cut", () => {
    // Floor centres stop a floor's width short of the wrap seam, and a floor's
    // marker is its widest drawn part; the camera may crop only the empty
    // band between that edge and the seam.
    const zoom = contentFitZoom(tuning);
    const visibleHalf = (LOGICAL_VIEWPORT.width / 2) * zoom;
    const outermostEdge = courseBounds(tuning).right + (tuning.FLOOR_WIDTH * INDICATOR_WIDTH_SCALE) / 2;
    expect(visibleHalf).toBeGreaterThanOrEqual(outermostEdge);
    expect(visibleHalf - outermostEdge).toBeLessThanOrEqual(CONTENT_FIT_MARGIN + 1e-9);
    expect(zoom).toBeLessThan(1);
  });

  it("is used while moving, and never widens the settled zoom", () => {
    const camera = new WorldCamera();
    const zoom = contentFitZoom(tuning);
    camera.setField(true, 1400, zoom);
    camera.update({ moving: true, targetY: 0 }, 5);
    expect(LOGICAL_VIEWPORT.width / camera.transform().scale).toBeCloseTo(LOGICAL_VIEWPORT.width * zoom, 3);

    camera.update({ moving: false, targetY: 0 }, 5);
    expect(LOGICAL_VIEWPORT.width / camera.transform().scale).toBeCloseTo(
      LOGICAL_VIEWPORT.width * Math.min(CAMERA.stationaryZoom, zoom),
      3,
    );
  });

  it("never zooms out past the course, whatever the tuning", () => {
    expect(contentFitZoom({ ...tuning, FLOOR_WIDTH: 64 })).toBeLessThanOrEqual(1);
    expect(contentFitZoom({ ...tuning, FLOOR_WIDTH: 256 })).toBeLessThanOrEqual(1);
  });
});

describe("the portrait anchor (spec 2.5, D3)", () => {
  it("holds the local racer at the field's vertical centre in landscape", () => {
    const camera = new WorldCamera();
    camera.update({ moving: false, targetY: 500 }, 60);
    const t = camera.transform();

    // Where the racer at y = 500 lands in the field, y down.
    expect(t.y - 500 * t.scale).toBeCloseTo(LOGICAL_VIEWPORT.height / 2, 3);
  });

  it("holds the local racer at the middle of the field in portrait, clear of the thumbs", () => {
    const camera = new WorldCamera();
    camera.setField(true, LOGICAL_VIEWPORT.height);
    camera.update({ moving: false, targetY: 500 }, 60);
    const t = camera.transform();

    expect(t.y - 500 * t.scale).toBeCloseTo(LOGICAL_VIEWPORT.height * (1 - PORTRAIT_RACER_HEIGHT), 3);
    expect(PORTRAIT_RACER_HEIGHT).toBe(0.5);
  });

  it.each([
    [true, 720, 360],
    [true, 1487, 743.5],
    [false, 540, 270],
  ])("portrait %s with a %i-unit field holds the racer %s units down (D-R1)", (portrait, field, down) => {
    // The racer stays at the field's middle however tall the field is, so a
    // taller phone moves it up and away from the thumbs.
    const camera = new WorldCamera();
    camera.setField(portrait, field);
    camera.update({ moving: false, targetY: 500 }, 60);
    const t = camera.transform();

    expect(t.y - 500 * t.scale).toBeCloseTo(down, 3);
  });
});

describe("the camera's punch and look-ahead (A/V polish plan, G5)", () => {
  it("punches the zoom in by its share, and keeps the followed height where it was on screen", () => {
    const camera = new WorldCamera();
    camera.setField(false, 540);
    camera.cutTo(1000);
    const calm = camera.transform().scale;
    const held = camera.logicalToScreen({ x: 0, y: 1000 }).y;
    camera.setPunch(0.04);
    expect(camera.transform().scale).toBeCloseTo(calm * 1.04, 9);
    expect(camera.logicalToScreen({ x: 0, y: 1000 }).y).toBeCloseTo(held, 6);
    camera.setPunch(0);
    expect(camera.transform().scale).toBeCloseTo(calm, 9);
  });

  it("never punches out: a negative punch is none", () => {
    const camera = new WorldCamera();
    const calm = camera.transform().scale;
    camera.setPunch(-0.5);
    expect(camera.transform().scale).toBe(calm);
  });

  it("knows which heights are on screen, through its zoom and the visible field", () => {
    const camera = new WorldCamera();
    camera.setField(false, 540);
    camera.setVisible(40, 500);
    camera.cutTo(1000);
    expect(camera.showsY(1000)).toBe(true);
    const half = 230 / camera.transform().scale;
    expect(camera.showsY(1000 + half * 0.9)).toBe(true);
    expect(camera.showsY(1000 - half * 0.9)).toBe(true);
    expect(camera.showsY(1000 + half * 1.2)).toBe(false);
    expect(camera.showsY(1000 - half * 1.2)).toBe(false);
    // A punch shows less.
    camera.setPunch(0.1);
    expect(camera.showsY(1000 + half * 0.95)).toBe(false);
  });

  it("leads the follow by the look-ahead, toward where the racer is falling", () => {
    const plain = new WorldCamera();
    const leading = new WorldCamera();
    for (let i = 0; i < 600; i += 1) {
      plain.update({ moving: false, targetY: 1000 }, 1 / 60);
      leading.update({ moving: false, targetY: 1000, lead: -60 }, 1 / 60);
    }
    expect(plain.y).toBeCloseTo(1000, 3);
    expect(leading.y).toBeCloseTo(940, 3);
  });
});
