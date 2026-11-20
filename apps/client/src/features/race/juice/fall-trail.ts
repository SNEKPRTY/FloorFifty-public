/**
 * The fast-fall's trail (A/V polish plan, G4): speed lines and afterimages.
 *
 * Once a fast fall passes its threshold (`fallShare`), thin lines rise up the
 * field -- the world rushing past a racer dropping through it, the anime and
 * Sonic shorthand for speed -- and a few afterimages of the racer hang where
 * it just was. Both are as strong as the fall is fast, and both are gone the
 * frame it ends, so a landing never leaves a ghost behind.
 *
 * The lines live in field space (a layer over the world, like the beat
 * stamps), so the camera's follow does not drag them; the afterimages live in
 * the world, behind the racers, where the wrap streak's do. Pooled: nothing is
 * made after the first fall. Reduced motion never asks for any of it.
 */

import { Container, Sprite, Texture } from "pixi.js";

export type FallTrailFrame = {
  readonly nowMs: number;
  /** How far into the fast fall, 0 (none) to 1; see `fallShare`. */
  readonly share: number;
  /** The local racer as drawn, in the simulation's y-up space; undefined with none. */
  readonly racer: { readonly x: number; readonly y: number; readonly texture: Texture; readonly facingRight: boolean } | undefined;
  /** The field the lines fill, in field units. */
  readonly field: { readonly width: number; readonly top: number; readonly bottom: number };
  readonly tuning: FallTrailTuning;
};

/** How many lines and afterimages, and how strong at full fall: `feel.fall` in `juice.toml`. */
export type FallTrailTuning = {
  readonly lines: number;
  readonly alpha: number;
  readonly afterimages: number;
  readonly afterimageAlpha: number;
};

/** A line's width, and the range of its length, in field units. */
const LINE_WIDTH = 2;
const LINE_MIN = 40;
const LINE_MAX = 140;
/** How fast the lines rise at full fall, in field units a millisecond. */
const LINE_SPEED = 1.8;
/** Frames between two afterimages: far enough apart to read as separate figures. */
const GHOST_SPACING = 3;

/** A stable pseudo-random number in [0, 1) for a line's index and a salt: the same lines every fall. */
function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

export class FallTrail {
  private readonly lines = new Container({ label: "fall-lines" });
  private readonly ghosts = new Container({ label: "fall-ghosts" });
  /** Where the racer was on recent frames, newest first. */
  private history: { x: number; y: number; texture: Texture; facingRight: boolean }[] = [];

  /**
   * `figure` is the racer sprite's side and how far below its centre its feet
   * are, so a ghost stands where the racer stood; `tint` colours the lines.
   */
  constructor(
    screenLayer: Container,
    worldLayer: Container,
    private readonly figure: { readonly size: number; readonly feet: number },
    private readonly tint: number,
  ) {
    screenLayer.addChild(this.lines);
    worldLayer.addChild(this.ghosts);
  }

  update(frame: FallTrailFrame): void {
    const { share, tuning } = frame;
    if (share <= 0 || frame.racer === undefined) {
      this.hide();
      return;
    }
    this.drawLines(frame);
    this.history.unshift({ ...frame.racer });
    this.history.length = Math.min(this.history.length, (tuning.afterimages + 1) * GHOST_SPACING);
    this.drawGhosts(frame);
  }

  destroy(): void {
    this.lines.destroy({ children: true });
    this.ghosts.destroy({ children: true });
    this.history = [];
  }

  private drawLines({ nowMs, share, field, tuning }: FallTrailFrame): void {
    const height = field.bottom - field.top;
    const span = height + LINE_MAX;
    for (let i = 0; i < tuning.lines; i += 1) {
      const line = this.child(this.lines, i, () => {
        const sprite = new Sprite(Texture.WHITE);
        sprite.tint = this.tint;
        return sprite;
      });
      const length = LINE_MIN + (LINE_MAX - LINE_MIN) * hash(i, 2);
      line.width = LINE_WIDTH;
      line.height = length;
      line.x = Math.round(hash(i, 1) * field.width);
      // Each rises at its own pace, wrapping from the bottom back in, so the
      // field never empties and never pulses in step.
      const rise = nowMs * LINE_SPEED * (0.75 + 0.5 * hash(i, 3));
      const travelled = (((hash(i, 4) * span - rise) % span) + span) % span;
      line.y = Math.round(field.top - LINE_MAX + travelled);
      line.alpha = tuning.alpha * share;
      line.visible = true;
    }
    for (let i = tuning.lines; i < this.lines.children.length; i += 1) this.lines.children[i]!.visible = false;
  }

  private drawGhosts({ share, tuning }: FallTrailFrame): void {
    for (let i = 0; i < tuning.afterimages; i += 1) {
      const ghost = this.child(this.ghosts, i, () => {
        const sprite = new Sprite();
        sprite.anchor.set(0.5, 1);
        return sprite;
      });
      const past = this.history[(i + 1) * GHOST_SPACING];
      if (past === undefined) {
        ghost.visible = false;
        continue;
      }
      ghost.texture = past.texture;
      ghost.width = this.figure.size;
      ghost.height = this.figure.size;
      ghost.scale.x = (past.facingRight ? 1 : -1) * Math.abs(ghost.scale.x);
      ghost.position.set(Math.round(past.x), Math.round(-past.y + this.figure.feet));
      ghost.alpha = tuning.afterimageAlpha * share * (1 - i / tuning.afterimages);
      ghost.visible = true;
    }
    for (let i = tuning.afterimages; i < this.ghosts.children.length; i += 1) this.ghosts.children[i]!.visible = false;
  }

  private hide(): void {
    for (const child of this.lines.children) child.visible = false;
    for (const child of this.ghosts.children) child.visible = false;
    this.history = [];
  }

  /** The pooled sprite at `index`, made the first time it is asked for. */
  private child(layer: Container, index: number, make: () => Sprite): Sprite {
    const existing = layer.children[index] as Sprite | undefined;
    if (existing !== undefined) return existing;
    const made = make();
    layer.addChild(made);
    return made;
  }
}
