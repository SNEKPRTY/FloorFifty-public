import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { LETTERBOX_CROP_FRACTION } from "../../../../apps/client/src/lib/constants";
import { LetterboxFrame, PORTRAIT_FIELD_TOP, portraitFieldHeight } from "../../../../apps/client/src/features/platform/letterbox";
import { CompositeTarget } from "../../../../apps/client/src/features/render/render-target";
import { WorldCamera } from "../../../../apps/client/src/features/race/camera";
import { BOTTOM_BAND, BOTTOM_BAND_FOR } from "../../../../apps/client/src/features/race/race-hud.svelte";

/** A 16:9 desktop canvas: the logical world fits it exactly. */
const DESKTOP = { width: 1280, height: 720 };
/** A tall phone: the world is a band with bars above and below. */
const PORTRAIT = { width: 780, height: 1688 };
/** A short, wide phone: the world is a band with bars left and right. */
const LANDSCAPE = { width: 2216, height: 1024 };
/**
 * A canvas a little wider than 16:9 whose crop still lands on screen. Past
 * about 1.98:1 the field overflows the canvas by more than the 5% crop, so a
 * phone held sideways (LANDSCAPE, 844 x 390) shows no bar at all.
 */
const WIDE_BARRED = { width: 1400, height: 720 };

const maskBounds = (frame: LetterboxFrame): { x: number; y: number; width: number; height: number } => {
  const bounds = (frame.mask as Graphics).getLocalBounds();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
};

describe("letterbox geometry", () => {
  it("fills a 16:9 viewport exactly, leaving no bars", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(DESKTOP.width, DESKTOP.height);

    expect(box.scale).toBeCloseTo(DESKTOP.width / VIEWPORT.width);
    expect(box.width).toBeCloseTo(DESKTOP.width);
    expect(box.height).toBeCloseTo(DESKTOP.height);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });

  it("puts the field under the metric row and above the bottom band on a portrait canvas", () => {
    // Launch polish spec 2.5: a thumb on the swipe surface below must never
    // cover the field. D-R1 (responsive parity §6.2a) superseded D3's "upper
    // half" with the bottom band the thumbs actually use.
    const frame = new LetterboxFrame();
    const box = frame.layout(PORTRAIT.width, PORTRAIT.height);

    expect(box.scale).toBeCloseTo(PORTRAIT.width / VIEWPORT.width);
    expect(box.width).toBeCloseTo(PORTRAIT.width);
    expect(box.x).toBe(0);
    expect(box.y).toBe(PORTRAIT_FIELD_TOP);
    expect(box.y + box.height).toBeLessThanOrEqual(PORTRAIT.height - BOTTOM_BAND_FOR["tablet-portrait"]);
  });

  it("keeps a phone's portrait field clear of the thumbs at 390 x 844", () => {
    const box = new LetterboxFrame().layout(390, 844);
    expect(box.y).toBe(PORTRAIT_FIELD_TOP);
    expect(box.y + box.height).toBeLessThanOrEqual(844 - BOTTOM_BAND);
  });

  it("centres the field on a portrait canvas too short to lift it", () => {
    // Barely taller than wide: there is no upper half to speak of.
    const box = new LetterboxFrame().layout(600, 620);
    expect(box.y).toBe(Math.min(PORTRAIT_FIELD_TOP, Math.round((620 - box.height) / 2)));
  });

  it("overflows a wider viewport vertically rather than pillarboxing it", () => {
    // This used to pillarbox: the field was fitted inside the canvas and
    // centred, leaving scenery down each side. That gap is where the wrap seam
    // ended up, which is the one place it must not be.
    const frame = new LetterboxFrame();
    const box = frame.layout(LANDSCAPE.width, LANDSCAPE.height);

    expect(box.scale).toBeCloseTo(LANDSCAPE.width / VIEWPORT.width);
    expect(box.width).toBeCloseTo(LANDSCAPE.width);
    expect(box.x).toBe(0);
    // One wrap of the course, scaled to a canvas wider than 16:9, is taller
    // than that canvas has room for. The mask is what bounds the overflow.
    expect(box.height).toBeGreaterThan(LANDSCAPE.height);
    expect(box.y).toBeLessThan(0);
  });

  it("spans the canvas edge to edge at every aspect ratio", () => {
    // Horizontal clipping buys nothing here. The course wraps every
    // `VIEWPORT.width`, so a frame wider than that shows the same course again
    // rather than more of it -- there is no extra course to be unfair with. A
    // frame *narrower* than the canvas is what costs: the wrap seam lands
    // inside the picture, the player is cut short of the screen edge, and the
    // scenery carries on past them. The reference has no such gap because its
    // window is its play field.
    for (const view of [DESKTOP, PORTRAIT, LANDSCAPE, { width: 2560, height: 1080 }]) {
      const box = new LetterboxFrame().layout(view.width, view.height);

      expect(box.x).toBe(0);
      expect(box.width).toBeCloseTo(view.width, 3);
      expect(box.scale).toBeCloseTo(view.width / VIEWPORT.width, 5);
    }
  });

  it("never lets a player see past the canvas on either axis", () => {
    // The field may now be taller than the canvas, so the bound that matters
    // is the clip rather than the field: whatever shape the device is, nothing
    // is drawn outside it.
    const frame = new LetterboxFrame();
    for (const view of [DESKTOP, PORTRAIT, LANDSCAPE, { width: 320, height: 200 }]) {
      frame.layout(view.width, view.height);
      const mask = maskBounds(frame);

      expect(mask.x).toBe(0);
      expect(mask.width).toBeCloseTo(view.width, 3);
      expect(mask.y).toBeGreaterThanOrEqual(0);
      expect(mask.y + mask.height).toBeLessThanOrEqual(view.height + 1);
    }
  });
});

describe("clipping the world to the letterbox", () => {
  it("draws no spare mask over the field, upright or sideways", () => {
    // A mask graphic draws as a plain white shape whenever nothing uses it as a mask. Held
    // upright the fall lines run unclipped, so the effects' mask goes unused there, and a
    // white rectangle the size of the field covered the race on every upright phone.
    for (const view of [PORTRAIT, LANDSCAPE, DESKTOP]) {
      const frame = new LetterboxFrame();
      frame.layout(view.width, view.height);
      const masks = new Set(frame.scene.children.map((child) => child.mask).filter((mask) => mask !== null && mask !== undefined));
      const spare = frame.scene.children.filter(
        (child) => child instanceof Graphics && child.label.endsWith("mask") && !masks.has(child) && child.getLocalBounds().height > 0,
      );
      expect(spare.map((child) => child.label), `${view.width} x ${view.height}`).toEqual([]);
    }
  });

  it("masks the frame so nothing renders into the bars", () => {
    // Without a mask the world container is merely positioned, not bounded:
    // parallax, platforms, and players all draw straight through the bars, and
    // a tall phone sees several times the course a 16:9 screen does.
    const frame = new LetterboxFrame();
    frame.layout(PORTRAIT.width, PORTRAIT.height);

    expect(frame.root.mask).toBe(frame.mask);
  });

  it("clips to where the field and the canvas overlap", () => {
    // The two used to nest, so the clip was simply the field. They now cross:
    // the field is the canvas's width by construction and may be taller or
    // shorter than it, so the clip is the part they share.
    for (const view of [DESKTOP, PORTRAIT, LANDSCAPE]) {
      const frame = new LetterboxFrame();
      const box = frame.layout(view.width, view.height);
      const mask = maskBounds(frame);

      expect(mask.x).toBe(0);
      expect(mask.width).toBeCloseTo(box.width, 3);
      // Inside the canvas...
      expect(mask.y).toBeGreaterThanOrEqual(0);
      expect(mask.y + mask.height).toBeLessThanOrEqual(view.height + 1);
      // ...and inside the field.
      expect(mask.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(mask.y + mask.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
  });

  it("keeps the mask in step with a resize", () => {
    const frame = new LetterboxFrame();
    frame.layout(DESKTOP.width, DESKTOP.height);
    const box = frame.layout(PORTRAIT.width, PORTRAIT.height);

    expect(maskBounds(frame).height).toBeCloseTo(box.height);
  });

  it("parents the world and the HUD under the composite", () => {
    const frame = new LetterboxFrame();
    const composite = new CompositeTarget();
    composite.adopt(frame);

    expect(frame.world.parent).toBe(composite.stage);
    expect(frame.ui.parent).toBe(composite.stage);
    expect(composite.sprite.parent).toBe(frame.root);
    composite.destroy();
  });

  it("draws the HUD above the world", () => {
    const frame = new LetterboxFrame();
    const composite = new CompositeTarget();
    composite.adopt(frame);
    const children = composite.stage.children;

    expect(children.indexOf(frame.ui)).toBeGreaterThan(children.indexOf(frame.world));
    composite.destroy();
  });

  it("leaves the backdrop out of the composite so it can still fill the canvas", () => {
    // The reason the backdrop is unmasked is the reason it is uncomposited:
    // bounding it to 960 x 540 is bounding it to the rectangle it exists to
    // escape. See the class comment in `features/platform/letterbox.ts`.
    const frame = new LetterboxFrame();
    const composite = new CompositeTarget();
    composite.adopt(frame);

    expect(frame.backdrop.parent).toBe(frame.scene);
    composite.destroy();
  });
});

describe("the letterbox field", () => {
  it("leaves the backdrop unclipped so it can fill the canvas", () => {
    // Clipping the play area is what keeps the race fair; clipping the scenery
    // as well is what left a tall phone three quarters black.
    const frame = new LetterboxFrame();
    frame.layout(PORTRAIT.width, PORTRAIT.height);

    expect(frame.root.mask).toBe(frame.mask);
    // Pixi leaves an unset mask undefined rather than null; either means unclipped.
    expect(frame.backdrop.mask ?? null).toBeNull();
  });

  it("paints the field across the whole canvas, not just the logical viewport", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(PORTRAIT.width, PORTRAIT.height);
    const bounds = frame.field.getLocalBounds();

    // The canvas measured in logical units, which is what the backdrop spans.
    expect(bounds.width).toBeCloseTo(PORTRAIT.width / box.scale, 1);
    expect(bounds.height).toBeCloseTo(PORTRAIT.height / box.scale, 1);
    expect(bounds.y).toBeCloseTo(-box.y / box.scale, 1);
  });

  it("still covers exactly the canvas when there are no bars at all", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(DESKTOP.width, DESKTOP.height);
    const bounds = frame.field.getLocalBounds();

    expect(bounds.width).toBeCloseTo(VIEWPORT.width, 1);
    expect(bounds.height).toBeCloseTo(VIEWPORT.height, 1);
    expect(box.x).toBe(0);
  });

  it("gives the backdrop the same transform as the clipped frame", () => {
    // Both are in logical space, so a parallax layer and a platform at the same
    // logical y line up whether or not one of them is clipped.
    const frame = new LetterboxFrame();
    frame.layout(LANDSCAPE.width, LANDSCAPE.height);

    expect(frame.backdrop.position.x).toBeCloseTo(frame.root.position.x);
    expect(frame.backdrop.position.y).toBeCloseTo(frame.root.position.y);
    expect(frame.backdrop.scale.x).toBeCloseTo(frame.root.scale.x);
  });

  it("paints the field behind everything the backdrop holds", () => {
    const frame = new LetterboxFrame();
    expect(frame.backdrop.children.indexOf(frame.field)).toBe(0);
  });
});

describe("the letterbox bars", () => {
  it("crops a twentieth of the field, half the reference's tenth (UI layout system spec §1.2)", () => {
    expect(LETTERBOX_CROP_FRACTION).toBe(0.05);
  });

  const barBounds = (bar: Graphics) => {
    const bounds = bar.getLocalBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  };

  /** The canvases the bars are drawn on: anything at least as wide as it is tall. */
  const barred = [
    ["a 16:9 desktop", DESKTOP],
    ["a canvas a little wider than 16:9", WIDE_BARRED],
  ] as const;

  it("draws no bar where the field already overflows the canvas past the crop", () => {
    // A phone wider than about 2:1 scales the field to its width, and the
    // field then runs further off the top and bottom than the 5% crop reaches
    // (UI layout system spec §4.1). The crop is off screen: the bars are
    // empty rather than inside out, and the player sees the whole canvas.
    const frame = new LetterboxFrame();
    const box = frame.layout(LANDSCAPE.width, LANDSCAPE.height);
    expect(box.y + box.height * LETTERBOX_CROP_FRACTION).toBeLessThan(0);

    expect(barBounds(frame.topBar).height).toBe(0);
    expect(barBounds(frame.bottomBar).height).toBe(0);
    expect(box.gameplay).toEqual({ x: 0, y: 0, width: LANDSCAPE.width, height: LANDSCAPE.height });
  });

  it.each(barred)("reaches every canvas edge on %s", (_name, view) => {
    // The bars are the reference's crop of the play field, but they are drawn
    // in canvas space rather than logical space. Drawn logically they were the
    // *field's* rect, which equals the canvas only at exactly 16:9: a tall
    // phone left 312px of scenery above and below them and a wide one left
    // 75px at each side, so the crop read as two stripes floating in the
    // middle of the screen rather than as a letterbox.
    const frame = new LetterboxFrame();
    const box = frame.layout(view.width, view.height);

    const top = barBounds(frame.topBar);
    const bottom = barBounds(frame.bottomBar);

    // Full canvas width, from the very left edge.
    expect(top.x).toBe(0);
    expect(top.width).toBeCloseTo(view.width, 3);
    expect(bottom.x).toBe(0);
    expect(bottom.width).toBeCloseTo(view.width, 3);

    // Top bar runs from the canvas top down to the crop into the field.
    expect(top.y).toBe(0);
    expect(top.height).toBeCloseTo(box.y + box.height * LETTERBOX_CROP_FRACTION, 3);

    // Bottom bar runs from the crop above the field's foot to the canvas foot.
    expect(bottom.y).toBeCloseTo(box.y + box.height * (1 - LETTERBOX_CROP_FRACTION), 3);
    expect(bottom.y + bottom.height).toBeCloseTo(view.height, 3);
  });

  it("crops exactly the crop fraction of the play field on every canvas it is drawn on", () => {
    // The gameplay crop is the part that must not drift between the canvases
    // that have bars at all.
    for (const [, view] of barred) {
      const frame = new LetterboxFrame();
      const box = frame.layout(view.width, view.height);
      const top = barBounds(frame.topBar);

      const croppedFromField = top.height - box.y;
      expect(croppedFromField / box.height).toBeCloseTo(LETTERBOX_CROP_FRACTION, 6);
    }
  });

  it("draws above the play field rather than inside it", () => {
    // A child of the clipped root would be scaled with the field, which is
    // exactly what made the bars logical-sized in the first place.
    const frame = new LetterboxFrame();
    expect(frame.root.children).not.toContain(frame.bars);
    expect(frame.bars.children).toHaveLength(2);
  });

  it("drops the bars entirely on a portrait canvas", () => {
    // A phone held upright already gives the field only a quarter of its
    // height. Framing that band to the canvas edge left the screen more than
    // three quarters black, which reads as a fault rather than as a crop, so
    // portrait keeps the whole field and the scenery around it.
    const frame = new LetterboxFrame();
    frame.layout(PORTRAIT.width, PORTRAIT.height);
    expect(frame.bars.visible).toBe(false);
  });

  it("covers a phone held upright from where the scenery starts stretching", () => {
    // Below the lowest skyline's foot the scenery is its last row stretched
    // down. A race reports that line, and on a phone held upright the bar
    // covers from it to the canvas bottom -- nothing above it.
    const frame = new LetterboxFrame();
    const box = frame.layout(390, 844);
    frame.setSkirtLine(800);
    expect(frame.bars.visible).toBe(true);
    expect(frame.topBar.visible).toBe(false);
    const bottom = barBounds(frame.bottomBar);
    expect(bottom.y).toBeCloseTo(800, 3);
    expect(bottom.y + bottom.height).toBeCloseTo(844, 3);
    expect(bottom.width).toBeCloseTo(390, 3);
    expect(box.gameplay.y + box.gameplay.height).toBeCloseTo(box.y + box.height, 3);
  });

  it("follows the line as it moves, and drops the bar once it leaves the screen", () => {
    const frame = new LetterboxFrame();
    frame.layout(390, 844);
    frame.setSkirtLine(780);
    expect(barBounds(frame.bottomBar).y).toBeCloseTo(780, 3);
    frame.setSkirtLine(900);
    expect(frame.bars.visible).toBe(false);
  });

  it("never covers the play field, whatever line it is given", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(390, 844);
    frame.setSkirtLine(100);
    expect(barBounds(frame.bottomBar).y).toBeCloseTo(box.y + box.height, 3);
  });

  it("leaves a tablet held upright, and every landscape canvas, as they were", () => {
    const frame = new LetterboxFrame();
    frame.layout(820, 1180);
    frame.setSkirtLine(1100);
    expect(frame.bars.visible).toBe(false);
    const box = frame.layout(WIDE_BARRED.width, WIDE_BARRED.height);
    frame.setSkirtLine(900);
    expect(frame.topBar.visible).toBe(true);
    expect(barBounds(frame.bottomBar).y).toBeCloseTo(box.y + box.height * (1 - LETTERBOX_CROP_FRACTION), 3);
  });

  it("drops the bar when the race lets go of the line", () => {
    const frame = new LetterboxFrame();
    frame.layout(390, 844);
    frame.setSkirtLine(800);
    frame.setSkirtLine(undefined);
    expect(frame.bars.visible).toBe(false);
  });

  it("brings them back when the phone is turned", () => {
    // The hide is a property of the current canvas, never a latch: a rotation
    // is a plain resize and has to restore both the bars and their geometry.
    const frame = new LetterboxFrame();
    // A menu's canvas: a race's is barred from the start.
    frame.setCutLine(false);
    frame.layout(PORTRAIT.width, PORTRAIT.height);

    const box = frame.layout(WIDE_BARRED.width, WIDE_BARRED.height);
    // Hidden until the splash asks for its black: the strips show the scenery.
    expect(frame.bars.visible).toBe(false);
    frame.setBarBlack(1);
    expect(frame.bars.visible).toBe(true);

    const top = barBounds(frame.topBar);
    expect(top.width).toBeCloseTo(WIDE_BARRED.width, 3);
    expect(top.height).toBeCloseTo(box.y + box.height * LETTERBOX_CROP_FRACTION, 3);
  });
});

describe("the published viewport rectangles", () => {
  it("crops the gameplay rectangle by exactly the bars that are drawn", () => {
    // The HUD anchors to this, so it has to be the region a player can actually
    // see: the clip minus the crop, which is a different rectangle from either.
    const box = new LetterboxFrame().layout(DESKTOP.width, DESKTOP.height);

    expect(box.gameplay.x).toBe(0);
    expect(box.gameplay.width).toBeCloseTo(DESKTOP.width, 3);
    expect(box.gameplay.y).toBeCloseTo(box.y + box.height * LETTERBOX_CROP_FRACTION, 3);
    expect(box.gameplay.height).toBeCloseTo(box.height * (1 - 2 * LETTERBOX_CROP_FRACTION), 3);
  });

  it("keeps the whole clip on portrait, where the bars are hidden", () => {
    // The existing orientation policy, stated once: portrait keeps the full
    // field rather than cropping a band out of a screen that is mostly machinery.
    const box = new LetterboxFrame().layout(PORTRAIT.width, PORTRAIT.height);

    expect(box.portrait).toBe(true);
    expect(box.gameplay.height).toBeCloseTo(box.height, 3);
  });

  it("reports the scenery's extent in logical units, covering the canvas", () => {
    // A bounded scenery target is fitted to this rectangle, so it is stated
    // here rather than recomputed by each caller -- which is how the two spaces
    // get mixed up in the first place.
    for (const view of [DESKTOP, PORTRAIT, LANDSCAPE]) {
      const box = new LetterboxFrame().layout(view.width, view.height);

      expect(box.scenery.x).toBeCloseTo(-box.x / box.scale, 3);
      expect(box.scenery.y).toBeCloseTo(-box.y / box.scale, 3);
      expect(box.scenery.width).toBeCloseTo(view.width / box.scale, 3);
      expect(box.scenery.height).toBeCloseTo(view.height / box.scale, 3);
    }
  });
});

describe("where the wrap seam lands", () => {
  /**
   * The canvas pixel a world x is drawn at.
   *
   * Composed from the two transforms that actually place it -- the camera's own
   * `logicalToScreen`, then the letterbox's scale and offset -- rather than
   * from a third copy of the arithmetic, so a change to either shows up here.
   */
  const seamPixels = (view: { width: number; height: number }) => {
    const frame = new LetterboxFrame();
    const box = frame.layout(view.width, view.height);
    const camera = new WorldCamera();
    // Settled at the widest the camera ever opens up, which is where the seam
    // comes closest to the middle of the picture.
    camera.update({ moving: true, targetY: 0 }, 100);

    const atCanvas = (worldX: number): number =>
      box.x + box.scale * camera.logicalToScreen({ x: worldX, y: 0 }).x;

    return { left: atCanvas(-VIEWPORT.width / 2), right: atCanvas(VIEWPORT.width / 2) };
  };

  it("is exactly the canvas edge, at every aspect ratio", () => {
    // The whole point. A player crossing the seam is cut by the true edge of
    // the screen and continues out of the opposite one; there is no band of
    // course past the seam for a second copy of them to stand in, and no gap
    // between where they are cut and where the picture stops.
    for (const view of [DESKTOP, PORTRAIT, LANDSCAPE, { width: 2560, height: 1080 }]) {
      const { left, right } = seamPixels(view);

      expect(left).toBeCloseTo(0, 3);
      expect(right).toBeCloseTo(view.width, 3);
    }
  });
});

describe("D-R1: the taller portrait field (responsive parity spec §6.2a)", () => {
  const TABLET_BAND = BOTTOM_BAND_FOR["tablet-portrait"];

  it.each([
    [360, 640, BOTTOM_BAND],
    [375, 667, BOTTOM_BAND],
    [390, 844, BOTTOM_BAND],
    [430, 932, BOTTOM_BAND],
    [744, 1133, TABLET_BAND],
    [820, 1180, TABLET_BAND],
    [1024, 1366, TABLET_BAND],
  ])("%i x %i: the field fills the screen from the HUD band to the bottom band", (width, height, band) => {
    const frame = new LetterboxFrame();
    const box = frame.layout(width, height);

    expect(box.fieldHeight).toBe(portraitFieldHeight(height, box.scale, band));
    expect(box.height).toBeCloseTo(box.fieldHeight * box.scale, 6);
    expect(box.y).toBe(PORTRAIT_FIELD_TOP);
    // Reaches the band, less the floor to a whole logical unit: no empty
    // scenery between the course and the thumbs (the 2026-09-23 device gate).
    expect(box.y + box.height, "the field runs into the thumbs").toBeLessThanOrEqual(height - band);
    expect(box.y + box.height, "the field stops short of the band").toBeGreaterThan(height - band - box.scale);
    expect(maskBounds(frame).height).toBeCloseTo(box.height, 6);
  });

  it("is never shorter than the landscape field", () => {
    // A squat portrait canvas, where the space above the band is under 540
    // units: the floor holds, and the field is centred as before.
    expect(portraitFieldHeight(400, 0.375, BOTTOM_BAND)).toBe(540);
    expect(new LetterboxFrame().layout(360, 400).fieldHeight).toBe(540);
  });

  // Captured from the code before D-R1 (plan Task 10, Step 1): landscape and
  // desktop geometry must not move. The gameplay rects follow the 5% crop
  // (UI layout system spec §4.1); at 844 x 390 the crop is off screen.
  it.each([
    [1280, 720, { scale: 1.3333333333333333, x: 0, y: 0, width: 1280, height: 720, gameplay: { x: 0, y: 36, width: 1280, height: 648 }, scenery: { x: 0, y: 0, width: 960, height: 540 }, portrait: false }],
    [844, 390, { scale: 0.8791666666666667, x: 0, y: -42, width: 844, height: 474.75, gameplay: { x: 0, y: 0, width: 844, height: 390 }, scenery: { x: 0, y: 47.77251184834123, width: 960, height: 443.6018957345972 }, portrait: false }],
    [1440, 900, { scale: 1.5, x: 0, y: 45, width: 1440, height: 810, gameplay: { x: 0, y: 85.5, width: 1440, height: 729 }, scenery: { x: 0, y: -30, width: 960, height: 600 }, portrait: false }],
  ] as const)("%i x %i keeps its geometry and the 540-unit field", (width, height, before) => {
    const box = new LetterboxFrame().layout(width, height);
    // Through JSON, as the literals were captured: it drops the sign of a
    // zero (`-0 / scale`), which is the same geometry.
    const { fieldHeight, ...geometry } = box;
    expect(JSON.parse(JSON.stringify(geometry))).toEqual(before);
    expect(fieldHeight).toBe(540);
  });
});

describe("D-R1 on a 4:3 tablet (final review)", () => {
  it.each([[810, 1080], [768, 1024]])("%i x %i: the field stops above the roster band", (width, height) => {
    const box = new LetterboxFrame().layout(width, height);
    expect(box.y + box.height).toBeLessThanOrEqual(height - BOTTOM_BAND_FOR["tablet-portrait"] + 0.5);
    expect(box.fieldHeight).toBeGreaterThanOrEqual(540);
  });
});

describe("the bars' black", () => {
  it("goes from the palette's black to true black and back on a phone held upright", () => {
    const frame = new LetterboxFrame();
    frame.layout(390, 844);
    expect([frame.topBar.tint, frame.bottomBar.tint]).toEqual([0xffffff, 0xffffff]);
    frame.setBarBlack(1);
    expect([frame.topBar.tint, frame.bottomBar.tint]).toEqual([0x000000, 0x000000]);
    frame.setBarBlack(0.5);
    expect(frame.topBar.tint).toBe(0x808080);
    frame.setBarBlack(0);
    expect(frame.topBar.tint).toBe(0xffffff);
    frame.destroy();
  });

  it("still frames the splash in black, and fades it", () => {
    // Landscape strips show the scenery; the splash asks for true black over
    // them and fades it, as it did when the bars were always drawn.
    const frame = new LetterboxFrame();
    frame.setCutLine(false);
    const box = frame.layout(DESKTOP.width, DESKTOP.height);
    expect(frame.bars.visible).toBe(false);
    frame.setBarBlack(1);
    expect(frame.bars.visible).toBe(true);
    expect([frame.topBar.tint, frame.bottomBar.tint]).toEqual([0x000000, 0x000000]);
    expect([frame.topBar.alpha, frame.bottomBar.alpha]).toEqual([1, 1]);
    // Outside the field the player sees, not inside it.
    const top = frame.topBar.getLocalBounds();
    expect(top.y + top.height).toBeCloseTo(box.gameplay.y, 3);
    frame.setBarBlack(0.5);
    expect(frame.topBar.alpha).toBe(0.5);
    frame.setBarBlack(0);
    expect(frame.bars.visible).toBe(false);
    frame.destroy();
  });

  it("keeps the black through a resize", () => {
    const frame = new LetterboxFrame();
    frame.setBarBlack(1);
    frame.layout(DESKTOP.width, DESKTOP.height);
    expect(frame.bars.visible).toBe(true);
    frame.layout(WIDE_BARRED.width, WIDE_BARRED.height);
    expect(frame.topBar.alpha).toBe(1);
    frame.destroy();
  });
});

describe("the play field's own clip in landscape (the bars show the city)", () => {
  const FOUR_THREE = { width: 1024, height: 768 };
  const SIXTEEN_TEN = { width: 1440, height: 900 };

  it.each([
    ["4:3", FOUR_THREE],
    ["16:10", SIXTEEN_TEN],
    ["16:9", DESKTOP],
  ] as const)("clips the play layer to the field less its crop, at %s", (_name, view) => {
    const frame = new LetterboxFrame();
    const box = frame.layout(view.width, view.height);
    expect(maskBounds(frame)).toEqual({ x: box.gameplay.x, y: box.gameplay.y, width: box.gameplay.width, height: box.gameplay.height });
    frame.destroy();
  });

  it("shows no bars on a menu in landscape: the scenery fills them", () => {
    const frame = new LetterboxFrame();
    frame.setCutLine(false);
    for (const view of [DESKTOP, WIDE_BARRED, FOUR_THREE, SIXTEEN_TEN]) {
      frame.layout(view.width, view.height);
      expect(frame.bars.visible).toBe(false);
    }
    frame.destroy();
  });

  it("frames a race in landscape with solid bars in the palette's black (Owner, 2026-11-20)", () => {
    const frame = new LetterboxFrame();
    frame.setCutLine(true);
    for (const view of [DESKTOP, WIDE_BARRED, FOUR_THREE, SIXTEEN_TEN]) {
      const box = frame.layout(view.width, view.height);
      expect(frame.bars.visible, `${view.width}x${view.height}`).toBe(true);
      expect(frame.topBar.visible).toBe(true);
      expect([frame.topBar.alpha, frame.bottomBar.alpha]).toEqual([1, 1]);
      // White tint: the bars' own fill, the palette's plum-tinted black, unchanged.
      expect([frame.topBar.tint, frame.bottomBar.tint]).toEqual([0xffffff, 0xffffff]);
      // They cover the strips and stop at the field the player sees.
      const top = frame.topBar.getLocalBounds();
      const bottom = frame.bottomBar.getLocalBounds();
      expect(top.y + top.height).toBeCloseTo(box.gameplay.y, 3);
      expect(bottom.y).toBeCloseTo(box.gameplay.y + box.gameplay.height, 3);
    }
    frame.destroy();
  });

  it("keeps a race's bars when a menu takes the canvas back off them", () => {
    const frame = new LetterboxFrame();
    frame.setCutLine(true);
    frame.layout(DESKTOP.width, DESKTOP.height);
    frame.setCutLine(false);
    frame.layout(DESKTOP.width, DESKTOP.height);
    expect(frame.bars.visible).toBe(false);
    frame.destroy();
  });

  it("draws the 2 px edge on the crop line", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(SIXTEEN_TEN.width, SIXTEEN_TEN.height);
    const edges = frame.edges.getLocalBounds();
    // A line just outside the field's cut, above and below, so the course a player sees is unchanged.
    expect(edges.y).toBeCloseTo(box.gameplay.y - 2, 3);
    expect(edges.y + edges.height).toBeCloseTo(box.gameplay.y + box.gameplay.height + 2, 3);
    expect(edges.width).toBeCloseTo(SIXTEEN_TEN.width, 3);
    expect(frame.edges.visible).toBe(true);
    frame.destroy();
  });

  it("draws no edge line in menu mode, where the window is whole", () => {
    const frame = new LetterboxFrame();
    frame.setCutLine(false);
    frame.layout(SIXTEEN_TEN.width, SIXTEEN_TEN.height);
    expect(frame.edges.visible).toBe(false);
    frame.setCutLine(true);
    frame.layout(SIXTEEN_TEN.width, SIXTEEN_TEN.height);
    expect(frame.edges.visible).toBe(true);
    frame.destroy();
  });

  it("draws no edge where the crop is off the canvas, or on a phone held upright", () => {
    const frame = new LetterboxFrame();
    frame.layout(LANDSCAPE.width, LANDSCAPE.height);
    expect(frame.edges.visible).toBe(false);
    frame.layout(PORTRAIT.width, PORTRAIT.height);
    expect(frame.edges.visible).toBe(false);
    frame.destroy();
  });

  it("leaves a phone held upright as it was", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(PORTRAIT.width, PORTRAIT.height);
    // The clip is still the whole field the canvas shows, and the effects are unmasked.
    expect(maskBounds(frame).height).toBeCloseTo(box.gameplay.height, 3);
    expect(frame.effects.mask).toBeFalsy();
    frame.destroy();
  });

  it("clips the fall lines to the field, and leaves the impact flash whole", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(SIXTEEN_TEN.width, SIXTEEN_TEN.height);
    const clip = (frame.effects.mask as Graphics).getLocalBounds();
    expect({ y: clip.y, height: clip.height }).toEqual({ y: box.gameplay.y, height: box.gameplay.height });
    expect(frame.front.mask).toBeFalsy();
    // A mask has to be in the rendered subtree it clips.
    expect(frame.scene.children).toContain(frame.effects.mask);
    frame.destroy();
  });
});

describe("the unclipped effects layer", () => {
  it("carries the same transform as the play field and backdrop, but without a mask", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(820, 1180);

    expect(frame.effects).toBeDefined();
    expect(frame.effects.mask).toBeFalsy();
    expect(frame.effects.scale.x).toBeCloseTo(box.scale);
    expect(frame.effects.scale.y).toBeCloseTo(box.scale);
    expect(frame.effects.position.x).toBe(box.x);
    expect(frame.effects.position.y).toBe(box.y);
    expect(frame.scene.children.indexOf(frame.effects)).toBeGreaterThan(frame.scene.children.indexOf(frame.root));
    frame.destroy();
  });
});

describe("the front layer", () => {
  it("carries the field's transform, unmasked, and is drawn after the bars", () => {
    const frame = new LetterboxFrame();
    const box = frame.layout(390, 844);
    expect(frame.front.mask).toBeFalsy();
    expect(frame.front.scale.x).toBeCloseTo(box.scale);
    expect(frame.front.position.y).toBe(box.y);
    // Not in the scene: a sibling the stage adds after the bars (app.ts).
    expect(frame.scene.children).not.toContain(frame.front);
    expect(frame.bars.children).not.toContain(frame.front);
    frame.destroy();
  });
});
