/**
 * The bounded scenery target.
 *
 * Two things are asserted here, and they fail in different ways. The allocation
 * is arithmetic and can be checked exactly: a scenery rectangle that is not
 * bounded makes every pass downstream cost whatever the device happens to be.
 * The lifecycle is ownership, and it fails quietly -- a texture replaced on
 * resize and not destroyed leaks a surface the size of the screen, and a source
 * that is rendered twice is drawn at device resolution behind the bounded copy
 * of itself.
 *
 * No GPU is involved: the target's job is the arrangement, and the rendering is
 * behind a one-method interface for exactly this reason.
 */

import { Container, Point, RenderTexture, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  BACKDROP_AREA_CAP,
  BACKDROP_POOL_CAP,
  BackdropTarget,
  backdropSize,
  pooledCapacity,
} from "../../../../apps/client/src/features/render/backdrop-target";
import { LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";

/** Records what it was asked to render, and renders nothing. */
class RecordingRenderer {
  readonly renders: { container: Container; target: RenderTexture }[] = [];

  render(options: { container: Container; target: RenderTexture }): void {
    this.renders.push(options);
  }
}

const rect = (width: number, height: number, x = 0, y = 0) => ({ x, y, width, height });

describe("fitting a scenery rectangle into a bounded target", () => {
  it("never exceeds the area cap, and never collapses to nothing", () => {
    // The four shapes that matter: the exact budget, a tall phone, a wide
    // monitor, and the degenerate one a mid-resize layout can briefly produce.
    for (const [width, height] of [
      [960, 540],
      [960, 2078],
      [2200, 540],
      [1, 1],
    ] as const) {
      const size = backdropSize(width, height);

      expect(size.width * size.height).toBeLessThanOrEqual(BACKDROP_AREA_CAP);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });

  it("leaves a rectangle that already fits exactly alone", () => {
    // No needless resample: a target that upscaled here and again at the
    // letterbox would pay two resamples to arrive at the same pixels.
    expect(backdropSize(960, 540)).toEqual({ width: 960, height: 540 });
    expect(backdropSize(960, 540)).toEqual({ width: LOGICAL_VIEWPORT.width, height: LOGICAL_VIEWPORT.height });
  });

  it("fits by area rather than by shape", () => {
    // Both of these are twice the budget's area and neither is the other's
    // aspect ratio, so neither may be squeezed by the other's proportions.
    const tall = backdropSize(960, 2078);
    const wide = backdropSize(2200, 540);

    for (const size of [tall, wide]) {
      const area = size.width * size.height;
      expect(area).toBeGreaterThan(BACKDROP_AREA_CAP * 0.9);
      expect(area).toBeLessThanOrEqual(BACKDROP_AREA_CAP);
    }
    // Same budget, different shape: neither is square, and neither is stretched.
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
  });

  it("refuses an extent that is not finite and positive", () => {
    // A zero height is a real thing to see for a frame during a resize. The
    // failure it should produce is a clear one, not a silent 0x1 texture.
    for (const [width, height] of [
      [0, 540],
      [960, 0],
      [-960, 540],
      [Number.NaN, 540],
      [960, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => backdropSize(width, height)).toThrow(RangeError);
    }
  });

  it("accounts for the allocator's rounding separately from the area", () => {
    // A pooled texture is rounded up to a power of two per axis, so what is
    // reserved is not what is shaded. Equating the two is how a bounded pass
    // turns out to be unbounded in memory.
    const size = backdropSize(960, 2078);
    const reserved = pooledCapacity(size.width, size.height);

    expect(reserved).toBeGreaterThan(size.width * size.height);
    expect(reserved).toBeLessThanOrEqual(BACKDROP_POOL_CAP);
  });
});

describe("a mounted target", () => {
  it("renders its source once, and only into its own target", () => {
    const renderer = new RecordingRenderer();
    const source = new Container();
    const target = new BackdropTarget(renderer, source, rect(960, 540));

    target.render();

    expect(renderer.renders).toHaveLength(1);
    expect(renderer.renders[0]?.container).toBe(target.filterRoot);
    expect(target.filterRoot).not.toBe(source);
    expect(source.parent?.parent).toBe(target.filterRoot);
    expect(renderer.renders[0]?.target).toBe(target.output.texture);

    // The source is rendered by the target and nowhere else. Were it also a
    // child of the stage it would be drawn a second time at device resolution,
    // which is both the cost this bounds and a second copy of the scenery.
    let root: Container | null = source;
    while (root?.parent) root = root.parent;
    expect(root).toBe(target.filterRoot);

    target.destroy();
  });

  it("shows one output, over exactly the rectangle it was given", () => {
    const renderer = new RecordingRenderer();
    const source = new Container();
    const target = new BackdropTarget(renderer, source, rect(960, 2078, -40, -120));

    expect(target.output).toBeInstanceOf(Sprite);
    expect(target.output.width).toBeCloseTo(960);
    expect(target.output.height).toBeCloseTo(2078);
    expect(target.output.position.x).toBeCloseTo(-40);
    expect(target.output.position.y).toBeCloseTo(-120);

    target.destroy();
  });

  it("softens its own upscale and nothing else", () => {
    // The one linear surface in the client. Everything else is pixel art
    // sampled 1:1; this is a bounded render stretched back over a larger
    // rectangle, where nearest would reintroduce the hard edges the bound
    // exists to avoid.
    const target = new BackdropTarget(new RecordingRenderer(), new Container(), rect(960, 540));
    expect(target.output.texture.source.scaleMode).toBe("linear");
    expect(target.output.texture.source.resolution).toBe(1);
    target.destroy();
  });

  it("replaces its texture on resize and destroys the one it replaced", () => {
    const renderer = new RecordingRenderer();
    const target = new BackdropTarget(renderer, new Container(), rect(960, 540));
    const before = target.output.texture;

    target.resize(rect(960, 2078));

    expect(target.output.texture).not.toBe(before);
    expect(target.output.texture.width).toBe(backdropSize(960, 2078).width);
    expect(target.targetSize).toEqual(backdropSize(960, 2078));
    // A replaced surface that is not destroyed is a screen-sized leak per
    // rotation.
    expect(before.destroyed).toBe(true);

    target.destroy();
  });

  it("keeps its texture when a resize does not change the fitted size", () => {
    // A few sub-unit pixels of window drag should not churn a texture. The
    // fitted size floors, so a change smaller than one target pixel resolves to
    // the same surface. The rectangle is deliberately under the area cap: at
    // exactly the cap any increase at all is rescaled to fit.
    const target = new BackdropTarget(new RecordingRenderer(), new Container(), rect(800, 450));
    const before = target.output.texture;

    target.resize(rect(800.4, 450.4));

    expect(target.output.texture).toBe(before);
    target.destroy();
  });

  it("re-survives repeated destruction", () => {
    // A screen that exits twice, or exits after a failed entry, must not
    // double-destroy a texture or a sprite.
    const target = new BackdropTarget(new RecordingRenderer(), new Container(), rect(960, 540));
    target.destroy();

    expect(() => target.destroy()).not.toThrow();
    expect(() => target.render()).not.toThrow();
    expect(target.output.destroyed).toBe(true);
  });

  it("fits its rectangle onto the target and pins the filter area to it", () => {
    const renderer = new RecordingRenderer();
    const source = new Container();
    // The owner's own transform, as a camera writes one every frame.
    source.position.set(10, 20);
    source.scale.set(2);
    const filtered = { resolution: 0, padding: 8 };
    const target = new BackdropTarget(renderer, source, rect(480, 270, 240, 135));
    target.filterRoot.filters = [filtered as never];

    target.render();

    // The rectangle's corners land on the target's, through the owner's transform...
    const corner = (x: number, y: number) => source.toGlobal(new Point((x - 10) / 2, (y - 20) / 2));
    expect(corner(240, 135).x).toBeCloseTo(0);
    expect(corner(240, 135).y).toBeCloseTo(0);
    expect(corner(720, 405).x).toBeCloseTo(target.targetSize.width);
    expect(corner(720, 405).y).toBeCloseTo(target.targetSize.height);
    // ...and its passes are held to that surface, with room to spare removed.
    expect(target.filterRoot.filterArea?.x).toBe(0);
    expect(target.filterRoot.filterArea?.y).toBe(0);
    expect(target.filterRoot.filterArea?.width).toBeCloseTo(target.targetSize.width);
    expect(target.filterRoot.filterArea?.height).toBeCloseTo(target.targetSize.height);
    expect(filtered.resolution).toBe(1);
    expect(filtered.padding).toBe(0);

    target.destroy();
  });

  it("never writes the source's own transform, which its owner drives", () => {
    // The gameplay sky is the camera's container. Fitting it by rewriting its
    // scale and position lost every frame to the camera, so on a tall phone --
    // the one frame that is downscaled -- the sky was drawn twice too large.
    const source = new Container();
    source.position.set(10, 20);
    source.scale.set(2);
    const target = new BackdropTarget(new RecordingRenderer(), source, rect(960, 2078, 0, -148));
    target.render();
    target.resize(rect(960, 1800, 0, -100));
    target.render();

    expect(source.position.x).toBe(10);
    expect(source.position.y).toBe(20);
    expect(source.scale.x).toBe(2);
    target.destroy();
  });

  it("leaves a borrowed container alone when it is released", () => {
    // The screen owns its scenery. The target owns the texture it renders into.
    const source = new Container();
    const child = new Sprite(Texture.EMPTY);
    source.addChild(child);

    const target = new BackdropTarget(new RecordingRenderer(), source, rect(960, 540));
    target.destroy();

    expect(source.destroyed).toBe(false);
    expect(source.children).toContain(child);
    expect(child.destroyed).toBe(false);
    source.destroy({ children: true });
  });

  it("gives a sky filter a full target-sized transparent input", () => {
    const source = new Container();
    const target = new BackdropTarget(new RecordingRenderer(), source, rect(960, 540));

    expect(target.filterRoot.children).toHaveLength(2);
    expect(target.filterRoot.getLocalBounds().rectangle.width).toBeCloseTo(960);
    expect(target.filterRoot.getLocalBounds().rectangle.height).toBeCloseTo(540);

    target.destroy();
  });
});
