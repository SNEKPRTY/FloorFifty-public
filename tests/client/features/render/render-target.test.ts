import { Sprite, Texture, type Filter } from "pixi.js";
import { describe, expect, it } from "vitest";
import { LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";
import { LetterboxFrame } from "../../../../apps/client/src/features/platform/letterbox";
import { CompositeTarget } from "../../../../apps/client/src/features/render/render-target";

describe("the composite target", () => {
  it("is exactly the logical viewport", () => {
    const target = new CompositeTarget();
    expect(target.sprite.texture.width).toBe(LOGICAL_VIEWPORT.width);
    expect(target.sprite.texture.height).toBe(LOGICAL_VIEWPORT.height);
    target.destroy();
  });

  it("grows to the form factor's field and back (D-R1)", () => {
    const target = new CompositeTarget();
    target.resize(720);
    expect(target.sprite.texture.width).toBe(LOGICAL_VIEWPORT.width);
    expect(target.sprite.texture.height).toBe(720);
    target.resize(LOGICAL_VIEWPORT.height);
    expect(target.sprite.texture.height).toBe(LOGICAL_VIEWPORT.height);
    target.destroy();
  });

  it("tells its sprite to redraw its quad when it resizes (a rotation)", () => {
    // Without this the sprite keeps the quad from its first frame, and a 540
    // composite is stretched over a 720 quad after the phone turns.
    const target = new CompositeTarget();
    const sprite = target.sprite as unknown as { didViewUpdate: boolean };
    sprite.didViewUpdate = false;
    target.resize(720);
    expect(sprite.didViewUpdate).toBe(true);
    target.destroy();
  });

  it("renders at resolution one regardless of device pixel ratio", () => {
    const target = new CompositeTarget();
    expect(target.sprite.texture.source.resolution).toBe(1);
    target.destroy();
  });

  it("never smooths its own upscale", () => {
    const target = new CompositeTarget();
    expect(target.sprite.texture.source.scaleMode).toBe("nearest");
    target.destroy();
  });

  it("holds the filters it is given", () => {
    const target = new CompositeTarget();
    expect(target.stage.filters).toEqual([]);
    target.destroy();
  });

  it("pins filterArea to target dimensions to avoid recursive getBounds calculations", () => {
    const target = new CompositeTarget();
    expect(target.stage.filterArea).toEqual(expect.objectContaining({
      x: 0,
      y: 0,
      width: LOGICAL_VIEWPORT.width,
      height: LOGICAL_VIEWPORT.height,
    }));
    target.resize(720);
    expect(target.stage.filterArea).toEqual(expect.objectContaining({
      x: 0,
      y: 0,
      width: LOGICAL_VIEWPORT.width,
      height: 720,
    }));
    target.destroy();
  });

  it("keeps a refracted UI child inside the palette-locked composite", () => {
    const frame = new LetterboxFrame();
    const target = new CompositeTarget();
    const filtered = new Sprite(Texture.EMPTY);
    const refraction = { label: "refraction" } as unknown as Filter;
    const paletteLock = { label: "palette-lock" } as unknown as Filter;
    filtered.filters = [refraction];
    frame.ui.addChild(filtered);

    target.adopt(frame);
    target.setFilters([paletteLock]);

    expect(filtered.parent).toBe(frame.ui);
    expect(frame.ui.parent).toBe(target.stage);
    expect(filtered.filters).toEqual([refraction]);
    expect(target.stage.filters).toEqual([paletteLock]);
    target.destroy();
    frame.destroy();
  });
});
