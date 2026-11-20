/**
 * The bounded scenery target.
 *
 * Scenery is the one layer that is deliberately unclipped -- see the class
 * comment in `features/platform/letterbox.ts` -- so it cannot go through the 960 x 540
 * composite the world and HUD use. On a tall phone it is several times that
 * area. Adding refraction and bloom to a chain that already runs at device
 * resolution is how a phone loses its frame budget, so the scenery gets a
 * target of its own, bounded by area rather than by shape.
 *
 * The arrangement, and why the source is not in the display tree:
 *
 *   scenery container (not parented) -> bounded target
 *       -> output sprite, parented in the backdrop, stretched back over the
 *          same logical rectangle with linear sampling
 *
 * The source is rendered *only* into the target. If a screen also added it to
 * the stage it would be drawn a second time at device resolution, which would
 * both cost the frame it was bounded to save and draw the scenery twice.
 */

import { Container, Graphics, RenderTexture, Sprite, Rectangle } from "pixi.js";
import type { ViewRect } from "./stage-port";

/**
 * The largest active shaded area any backdrop pass may have, in pixels.
 *
 * 960 x 540, the same budget the composite works in: the pass costs the same on
 * every device, and a device that would have shaded four times this pays for
 * the cap instead.
 */
export const BACKDROP_AREA_CAP = 518_400;

/**
 * The largest pooled capacity one intermediate surface may occupy.
 *
 * An allocator rounds a texture up to the next power of two on each axis, so a
 * 489 x 1059 surface really reserves 512 x 2048 -- more than twice its active
 * area. This is the cap on what is actually reserved, and it is deliberately
 * separate from the area cap above: the two are different numbers, and equating
 * them is how a bounded pass turns out to be unbounded in memory.
 */
export const BACKDROP_POOL_CAP = 2_097_152;

/** The rounder this module models: Pixi allocates pooled textures in powers of two. */
function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/**
 * What an allocator reserves for a surface of this size, in pixels.
 *
 * Exported because it is a different number from the surface's area and a
 * caller that treats them as one is the caller this exists to correct.
 */
export function pooledCapacity(width: number, height: number): number {
  return nextPowerOfTwo(width) * nextPowerOfTwo(height);
}

/**
 * The target size for a scenery rectangle measured in logical units.
 *
 * Fitted by area rather than by shape, so a tall phone and a wide monitor get
 * the same pixel budget and neither is squeezed by the other's aspect ratio.
 * Scale is never above 1: a small scenery rectangle is drawn at its own size,
 * because upscaling it here and then upscaling it again at the letterbox would
 * cost two resamples to arrive at the same pixels.
 *
 * Rejects a non-finite or non-positive extent rather than returning a nonsense
 * size for it. A zero-height canvas is a real thing to see during a resize, and
 * the failure it should produce is a clear one.
 */
export function backdropSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`backdrop extent must be finite and positive, got ${width}x${height}`);
  }

  const scale = Math.min(1, Math.sqrt(BACKDROP_AREA_CAP / (width * height)));
  let fitWidth = Math.max(1, Math.floor(width * scale));
  let fitHeight = Math.max(1, Math.floor(height * scale));

  // Rounding a subpixel edge up to 1 can push the product back over the cap, so
  // the longer axis gives way until it fits. A subpixel edge only occurs on an
  // extent below one logical unit in that axis, which is a degenerate layout
  // rather than a device anyone plays on.
  while (fitWidth * fitHeight > BACKDROP_AREA_CAP || pooledCapacity(fitWidth, fitHeight) > BACKDROP_POOL_CAP) {
    if (fitWidth >= fitHeight) fitWidth = Math.max(1, fitWidth - 1);
    else fitHeight = Math.max(1, fitHeight - 1);
    if (fitWidth === 1 && fitHeight === 1) break;
  }

  return { width: fitWidth, height: fitHeight };
}

/**
 * What the target needs from a renderer.
 *
 * Narrow on purpose: this module's job is the arrangement, and the arrangement
 * is testable without a GPU. A real `Renderer` satisfies this already.
 */
export interface BackdropRenderer {
  render(options: { container: Container; target: RenderTexture }): void;
}

export class BackdropTarget {
  /** The container that is rendered, and the one a screen attaches filters to. */
  readonly filterRoot: Container;
  /** The softened result. The app parents this where the scenery used to sit. */
  readonly output: Sprite;

  private texture: RenderTexture;
  private readonly source: Container;
  /**
   * Fits the scenery rectangle onto the target. Its own container, never the
   * source: the source is the owner's -- the gameplay sky is the camera's --
   * and a transform written onto it is overwritten on the owner's next frame.
   * That is what drew the sky twice too large on a tall phone, the one frame
   * whose target is downscaled, while a 16:9 target (fit = identity) hid it.
   */
  private readonly frame = new Container();
  private readonly coverage: Graphics;
  private size: { width: number; height: number };
  private rect: ViewRect;
  private destroyed = false;

  constructor(
    private readonly renderer: BackdropRenderer,
    source: Container,
    logicalRect: ViewRect,
  ) {
    this.source = source;
    this.filterRoot = new Container();
    this.filterRoot.label = "backdrop-filter-root";
    // A filter only shades the bounds of its input. Scenery is intentionally
    // sparse, while the first pass creates an opaque sky from transparent
    // pixels, so the chain needs a transparent primitive covering the whole
    // target. Without it Pixi crops the input to the skyline and the untouched
    // part of the render texture stays black.
    this.coverage = new Graphics();
    this.coverage.label = "backdrop-filter-coverage";
    this.frame.label = "backdrop-frame";
    this.frame.addChild(source);
    this.filterRoot.addChild(this.coverage, this.frame);
    this.rect = logicalRect;
    this.size = backdropSize(logicalRect.width, logicalRect.height);

    // `linear` on this texture alone. Everything else in the client is
    // nearest-neighbour, because everything else is pixel art sampled 1:1. This
    // surface is a bounded, softened render being stretched back over a larger
    // rectangle, and sampling that nearest would reintroduce exactly the hard
    // edges the bound exists to avoid. The world and the sprites keep `nearest`.
    this.texture = RenderTexture.create({
      width: this.size.width,
      height: this.size.height,
      resolution: 1,
      scaleMode: "linear",
    });
    this.output = new Sprite(this.texture);
    this.output.label = "backdrop-output";
    this.place(logicalRect);
  }

  get logicalRect(): ViewRect {
    return this.rect;
  }

  get targetSize(): Readonly<{ width: number; height: number }> {
    return this.size;
  }

  /** The pooled capacity this target reserves, which is not its active area. */
  get pooledCapacity(): number {
    return pooledCapacity(this.size.width, this.size.height);
  }

  /**
   * Draws the source into the bounded target.
   *
   * The source is rendered here and nowhere else -- see the module comment. The
   * app calls this at its own ticker priority, so the frame the app renders
   * afterwards already contains this result.
   */
  render(): void {
    if (this.destroyed) return;
    this.constrainFilters();
    this.renderer.render({ container: this.filterRoot, target: this.texture });
  }

  /**
   * Re-fits the target to a new scenery rectangle.
   *
   * The source container and the output sprite are reused; only the texture is
   * replaced, and the old one is destroyed with it rather than left for the
   * allocator to find later.
   */
  resize(logicalRect: ViewRect): void {
    if (this.destroyed) return;
    this.rect = logicalRect;
    const next = backdropSize(logicalRect.width, logicalRect.height);

    if (next.width !== this.size.width || next.height !== this.size.height) {
      const previous = this.texture;
      this.size = next;
      this.texture = RenderTexture.create({
        width: next.width,
        height: next.height,
        resolution: 1,
        scaleMode: "linear",
      });
      this.output.texture = this.texture;
      previous.destroy(true);
    }

    this.place(logicalRect);
  }

  /**
   * Releases the texture the target owns.
   *
   * Idempotent: a screen that exits twice, or exits after a failed entry, must
   * not double-destroy a texture. Nothing borrowed -- the source container, the
   * sprite's parent -- is touched here; the app unwinds those.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.output.removeFromParent();
    this.output.destroy();
    this.texture.destroy(true);
    this.source.removeFromParent();
    this.coverage.destroy();
    this.filterRoot.destroy();
  }

  /**
   * Maps the scenery rectangle onto the target, and pins the filter area to it.
   *
   * Two transforms, for two different reasons. The frame is moved so that the
   * rectangle fills the target exactly -- without it the target would show the
   * scenery's origin rather than the part of it the player is looking at. The
   * sprite does the inverse on the way back out, so the result covers the same
   * logical rectangle the source occupied.
   */
  private place(logicalRect: ViewRect): void {
    const scale = this.size.width / logicalRect.width;
    this.frame.scale.set(scale);
    this.frame.position.set(-logicalRect.x * scale, -logicalRect.y * scale);

    this.coverage.clear().rect(0, 0, this.size.width, this.size.height).fill({ color: 0xffffff, alpha: 0 });

    this.output.position.set(logicalRect.x, logicalRect.y);
    this.output.width = logicalRect.width;
    this.output.height = logicalRect.height;
  }

  /**
   * Holds every pass in the chain to the bounded surface.
   *
   * Left alone, a filter's area is the container's own bounds, which move as
   * the scenery scrolls -- so a sky pass that paints where nothing has been
   * drawn would slide around instead of covering the frame. Zero padding
   * because the area is already the whole shaded surface; the default padding
   * would grow it back past the cap this module exists to enforce.
   */
  private constrainFilters(): void {
    this.filterRoot.filterArea = new Rectangle(
      0,
      0,
      this.size.width,
      this.size.height,
    );

    const filters = this.filterRoot.filters;
    if (filters === undefined || filters === null) return;
    for (const filter of Array.isArray(filters) ? filters : [filters]) {
      filter.resolution = 1;
      filter.padding = 0;
    }
  }
}
