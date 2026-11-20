/**
 * The wrap streak (polish spec §4.2, D-P6): the course wraps and has no walls,
 * so where section 3.5 had wall sparks a wrap leaves a short afterimage at
 * both seams, the one left and the one entered. Each ghost is the racer's own
 * frame, fading out over a few rendered frames in steps.
 */

import { Container, Sprite, type Texture } from "pixi.js";

/** Ghosts alive at once: two per wrap, for four racers wrapping together. */
const CAPACITY = 8;
/** The ghost's opacity on its first frame. */
const START_ALPHA = 0.5;

export type WrapGhost = {
  readonly texture: Texture;
  /** The x the racer left, and the x it entered. */
  readonly fromX: number;
  readonly x: number;
  /** In the simulation's y-up space. */
  readonly y: number;
  readonly facingRight: boolean;
};

type Ghost = { readonly sprite: Sprite; step: number; frames: number };

export class WrapStreak {
  private readonly ghosts: Ghost[] = [];

  /**
   * `size` is the racer sprite's side and `feet` how far below its centre its
   * feet are, so a ghost stands where the racer stood.
   */
  constructor(
    private readonly layer: Container,
    private readonly figure: { readonly size: number; readonly feet: number },
  ) {}

  /** A ghost at each seam, fading over `frames` rendered frames. */
  show(wrap: WrapGhost, frames: number): void {
    if (frames <= 0) return;
    for (const x of [wrap.fromX, wrap.x]) {
      const ghost = this.take();
      ghost.sprite.texture = wrap.texture;
      ghost.sprite.width = this.figure.size;
      ghost.sprite.height = this.figure.size;
      // Set either way: a reused ghost must not keep the last racer's facing.
      ghost.sprite.scale.x = (wrap.facingRight ? 1 : -1) * Math.abs(ghost.sprite.scale.x);
      ghost.sprite.position.set(Math.round(x), Math.round(-wrap.y + this.figure.feet));
      ghost.sprite.alpha = START_ALPHA;
      ghost.sprite.visible = true;
      ghost.step = 0;
      ghost.frames = frames;
    }
  }

  /** One rendered frame: every ghost steps fainter, and a spent one is hidden. */
  update(): void {
    for (const ghost of this.ghosts) {
      if (!ghost.sprite.visible) continue;
      ghost.step += 1;
      if (ghost.step >= ghost.frames) {
        ghost.sprite.visible = false;
        continue;
      }
      ghost.sprite.alpha = START_ALPHA * (1 - ghost.step / ghost.frames);
    }
  }

  get live(): number {
    return this.ghosts.filter((ghost) => ghost.sprite.visible).length;
  }

  destroy(): void {
    for (const ghost of this.ghosts) ghost.sprite.destroy();
    this.ghosts.length = 0;
  }

  private take(): Ghost {
    const free = this.ghosts.find((ghost) => !ghost.sprite.visible);
    if (free !== undefined) return free;
    if (this.ghosts.length < CAPACITY) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      sprite.visible = false;
      this.layer.addChild(sprite);
      const ghost: Ghost = { sprite, step: 0, frames: 0 };
      this.ghosts.push(ghost);
      return ghost;
    }
    // Past capacity the faintest goes first: it was nearly gone anyway.
    return this.ghosts.reduce((faintest, ghost) => (ghost.step / ghost.frames > faintest.step / faintest.frames ? ghost : faintest));
  }
}
