/**
 * The fixed-resolution composite.
 *
 * Everything the world draws lands here first, at resolution 1 and exactly the
 * play field's size -- 960 wide, and as tall as the field (540 in landscape;
 * down to the bottom band in portrait, D-R1) -- and the result is
 * nearest-upscaled into the letterbox.
 *
 * Two reasons, and the second one is the durable one. Filters cost per pixel,
 * and a device-resolution frame on a phone is several times the work; bounding
 * the chain to 518,400 pixels makes the cost the same everywhere. More
 * importantly, pixel art sampled at a fractional device scale is pixel art with
 * torn edges, so compositing at 1:1 and upscaling by whole pixels is correct
 * whatever the cost.
 */

import { Container, Rectangle, RenderTexture, Sprite, type Filter } from "pixi.js";
import { LOGICAL_VIEWPORT } from "../../lib/constants";
import type { LetterboxFrame } from "../platform/letterbox";

export class CompositeTarget {
  /** What the world and the HUD draw into. Not the backdrop -- see `adopt`. */
  readonly stage = new Container();
  /** What the letterbox displays. */
  readonly sprite: Sprite;

  private readonly texture: RenderTexture;

  constructor() {
    this.stage.label = "composite";
    // Pin filterArea to the logical target size so Pixi skips recursively
    // computing getBounds() across the entire world on every frame.
    this.stage.filterArea = new Rectangle(0, 0, LOGICAL_VIEWPORT.width, LOGICAL_VIEWPORT.height);
    this.texture = RenderTexture.create({
      width: LOGICAL_VIEWPORT.width,
      height: LOGICAL_VIEWPORT.height,
      resolution: 1,
      scaleMode: "nearest",
      // Resized when a rotation changes the field (D-R1). A dynamic texture is
      // what makes the sprite listen for that and rebuild its quad; without it
      // the sprite keeps the first frame's quad and stretches the new size.
      dynamic: true,
    });
    this.sprite = new Sprite(this.texture);
    this.sprite.label = "composite-sprite";
    this.stage.filters = [];
  }

  /**
   * Re-parents a frame's play layers into the target, and puts the target's
   * sprite where they were.
   *
   * Here rather than in `app.ts` so the arrangement is reachable from a unit
   * test without a renderer, and so the one thing that is easy to get wrong is
   * written once.
   *
   * `backdrop` is deliberately left where it is. It is the only layer that is
   * not masked, because clipping the scenery is what left a tall phone three
   * quarters black -- see the class comment in `features/platform/letterbox.ts` -- and
   * a 960 x 540 target would bound it to exactly the rectangle it exists to
   * escape. It keeps its own chain at device resolution instead.
   *
   * `root` keeps its mask. It is redundant now that its only child is a sprite
   * the same size as the clip, and it is kept because it costs nothing and
   * because removing the clip that bounds the play area is not a change this
   * task should be making on the side.
   */
  adopt(frame: LetterboxFrame): void {
    this.stage.addChild(frame.world, frame.ui);
    frame.root.addChild(this.sprite);
  }

  /**
   * Resizes the target to a field `height` logical units tall. Called by
   * every layout; a no-op when the height has not changed, so a landscape
   * resize never reallocates the texture. A portrait field follows the
   * screen's height (D-R1), so there a resize that changes the height does.
   */
  resize(height: number): void {
    this.stage.filterArea = new Rectangle(0, 0, LOGICAL_VIEWPORT.width, height);
    if (this.texture.height === height) return;
    this.texture.resize(LOGICAL_VIEWPORT.width, height);
  }

  /** Replaces the filter chain. Order is the caller's, and it matters. */
  setFilters(filters: Filter[]): void {
    this.stage.filters = filters;
  }

  destroy(): void {
    this.sprite.destroy();
    this.texture.destroy(true);
    this.stage.destroy({ children: true });
  }
}
