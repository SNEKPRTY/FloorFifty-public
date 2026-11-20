/**
 * The world camera.
 *
 * Follows the local player vertically and reproduces the reference build's
 * stationary/motion zoom. It is presentation only: it writes a transform onto
 * a display container and never touches a coordinate the simulation produced.
 *
 * That separation is not stylistic. Collision is resolved on the server against
 * logical coordinates, so a camera that changed them would make what a player
 * sees and what the server resolves disagree.
 */

import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { courseBounds } from "@floor-fifty/shared/level/course";
import { CAMERA, LOGICAL_VIEWPORT } from "../../lib/constants";
import { INDICATOR_WIDTH_SCALE } from "./platform-view";

/** Logical units kept clear past the outermost floor marker by `contentFitZoom`. */
export const CONTENT_FIT_MARGIN = 6;

/**
 * The closest the camera can hold while moving without cutting a platform.
 *
 * A phone held upright fits 960 units into about 400 px, so everything is
 * small, and zooming in means cropping the course's sides. The camera does not
 * follow the racer sideways, so a crop could hide a floor near the edge -- but
 * floor centres are generated a full floor's width short of the wrap seam
 * (`courseBounds`), so the outer band is always empty. This zooms in exactly
 * as far as that band allows: the outermost floor marker (a floor's widest
 * drawn part) plus a small margin stays on screen.
 *
 * Racers still reach the seam, and wrap there; one crossing it is out of view
 * for the width of the empty band on each side. Derived from the room's
 * tuning, so a content change to `FLOOR_WIDTH` moves the limit with it.
 */
export function contentFitZoom(tuning: Pick<ResolvedTuning, "FLOOR_WIDTH">): number {
  const half = LOGICAL_VIEWPORT.width / 2;
  const edge = courseBounds(tuning as ResolvedTuning).right + (tuning.FLOOR_WIDTH * INDICATOR_WIDTH_SCALE) / 2;
  return Math.min(1, (edge + CONTENT_FIT_MARGIN) / half);
}

export type CameraTarget = {
  /** True while the local player is moving horizontally. */
  moving: boolean;
  /** Logical y to centre on. Omitted leaves the camera where it is. */
  targetY?: number;
  /**
   * How far past `targetY` to look, in logical units (negative is below): a
   * fast fall's look-ahead, so the floor it lands on is in view sooner.
   */
  lead?: number;
};

/** A transform a display container can be given. */
export type CameraTransform = {
  scale: number;
  x: number;
  y: number;
};

/**
 * Where the local racer is held in portrait, as a share of the field's height
 * measured up from its bottom edge (launch polish spec 2.5, decision D3).
 *
 * D3 held the racer 216 units above the bottom and gave the rest of the field
 * to the course ahead. On a phone that put the racer exactly where the thumb
 * steers (the swipe surface is the lower half), so the finger covered it. The
 * middle of the field, as landscape holds it, keeps the racer clear of the
 * thumbs and still leaves half the field for the course ahead. Presentation
 * only, like everything here.
 */
export const PORTRAIT_RACER_HEIGHT = 0.5;

/** The most Survival's danger closes the zoom in (survival spec §7): 4%. */
export const DANGER_ZOOM = 0.04;

/**
 * The part of the field a player can see, in field units measured down from
 * the field's top: the letterbox's gameplay rectangle (the clip less the
 * bars), which on a canvas wider than 16:9 is less than the field.
 */
export function visibleField(viewport: {
  canvasCss: { width: number };
  gameplayCss: { y: number; height: number };
  sceneryLogical: { y: number };
}): { top: number; bottom: number } {
  // The field spans the canvas's width, so this is the letterbox's scale.
  const scale = viewport.canvasCss.width / LOGICAL_VIEWPORT.width;
  const top = viewport.sceneryLogical.y + viewport.gameplayCss.y / scale;
  return { top, bottom: top + viewport.gameplayCss.height / scale };
}

/** Moves `value` toward `target` at `rate` per second, without overshooting. */
function damp(value: number, target: number, rate: number, deltaSeconds: number): number {
  const t = Math.min(1, rate * deltaSeconds);
  return value + (target - value) * t;
}

export class WorldCamera {
  /** Current zoom. Starts settled, as the reference's projection does. */
  scale: number = CAMERA.stationaryZoom;
  /** Logical y the camera is centred on. */
  y = 0;

  /** How long the player has been stationary, in seconds. */
  private stillSeconds = 0;
  private frozen = false;
  /** Whether the canvas is portrait, which moves where the racer is held. */
  private portrait = false;
  /** The field's height in logical units, which the anchor is measured from. */
  private fieldHeight: number = LOGICAL_VIEWPORT.height;
  /** The zoom held while moving: the reference's, or `contentFitZoom` on a phone held upright. */
  private motionZoom: number = CAMERA.motionZoom;
  /** Survival's danger, 0 to 1 (survival spec §7). */
  private danger = 0;
  /** The juice's zoom punch, a share of the zoom; see `setPunch`. */
  private punch = 0;
  /** The part of the field a player can see, in field units down from its top; the whole field until told. */
  private visible: { top: number; bottom: number } | undefined;

  /**
   * Told by the view from the letterbox geometry: the `portrait` flag, the
   * field's height, and the zoom to hold while moving.
   */
  setField(portrait: boolean, fieldHeight: number, motionZoom: number = CAMERA.motionZoom): void {
    this.portrait = portrait;
    this.fieldHeight = fieldHeight;
    this.motionZoom = motionZoom;
  }

  /** Holds the follow and the zoom, for the slam's hit-stop. */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  /** Survival's danger, 0 to 1, which closes the zoom in a little; reduced motion passes 0. */
  setDanger(danger: number): void {
    this.danger = Math.min(1, Math.max(0, danger));
  }

  /** The part of the field a player can see (`visibleField`), which the lava's marker sits on. */
  setVisible(top: number, bottom: number): void {
    this.visible = { top, bottom };
  }

  /** The field y, down from its top, of the top of what a player can see. */
  visibleTop(): number {
    return this.visible?.top ?? 0;
  }

  /** The field y, down from its top, of the bottom of what a player can see. */
  visibleBottom(): number {
    return this.visible?.bottom ?? this.fieldHeight;
  }

  /** Whether a logical height is drawn inside the part of the field a player can see, at this frame's transform. */
  showsY(y: number): boolean {
    const screenY = this.logicalToScreen({ x: 0, y }).y;
    return screenY >= (this.visible?.top ?? 0) && screenY <= this.visibleBottom();
  }

  /** The logical y drawn at field y `screenY`, at this frame's transform: `logicalToScreen`'s inverse. */
  logicalYAtScreen(screenY: number): number {
    const transform = this.transform();
    return (transform.y - screenY) / transform.scale;
  }

  /** Where in the field, y down, the followed racer is held. */
  private anchor(): number {
    return this.portrait ? this.fieldHeight * (1 - PORTRAIT_RACER_HEIGHT) : this.fieldHeight / 2;
  }

  /**
   * Advances the camera by one frame.
   *
   * The zoom follows a dwell timer rather than instantaneous speed: the
   * reference only zooms in once the player has been still for a moment, which
   * stops the view pumping while a player taps left and right.
   */
  update(target: CameraTarget, deltaSeconds: number): void {
    // A slam's hit-stop holds the follow and the zoom where they are (polish
    // spec §4.2); the next frame after it carries on from there.
    if (this.frozen) return;
    this.stillSeconds = target.moving ? 0 : this.stillSeconds + deltaSeconds;

    const settled = this.stillSeconds > CAMERA.stationaryDelaySeconds;
    // Settling only ever closes in: a motion zoom already tighter than the
    // reference's settled one is kept rather than widened on a stop.
    const desired = settled ? Math.min(CAMERA.stationaryZoom, this.motionZoom) : this.motionZoom;
    this.scale = damp(this.scale, desired, CAMERA.zoomSpeed, deltaSeconds);

    if (target.targetY !== undefined) {
      this.y = damp(this.y, target.targetY + (target.lead ?? 0), CAMERA.followSpeed, deltaSeconds);
    }
  }

  /**
   * The juice's zoom punch, as a share of the zoom (A/V polish plan, G5): a
   * slam or the finish closes in a little and springs back. Never out.
   */
  setPunch(share: number): void {
    this.punch = Math.max(0, share);
  }

  /**
   * The transform to apply to the world container.
   *
   * `scale` is kept as the reference's *projection* scale, where a smaller
   * number shows less of the world, so its damping curve is the reference's.
   * A container scale is that value's reciprocal: scaling the world down shows
   * more of it. Inverting here, once, is what keeps the two from being
   * confused anywhere else.
   *
   * Logical space has y pointing up with the origin at the course start; the
   * screen has y pointing down from the top-left, so the sign flips here and
   * only here.
   */
  transform(): CameraTransform {
    // Survival's danger closes the view in a little (survival spec §7), and
    // the juice's punch a little more for a moment.
    const scale = (1 + this.punch) / (this.scale * (1 - DANGER_ZOOM * this.danger));
    return {
      scale,
      x: LOGICAL_VIEWPORT.width / 2,
      y: this.anchor() + this.y * scale,
    };
  }

  /**
   * Converts a point in world-container space back to logical space.
   *
   * This is the identity, by construction: children of the world container are
   * positioned at logical coordinates, and the camera's zoom and follow live on
   * the container's own transform. Keeping the function here makes that an
   * assertable property rather than a convention.
   */
  worldToLogical(point: { x: number; y: number }): { x: number; y: number } {
    return { x: point.x, y: point.y };
  }

  /** Where a logical point lands on the letterboxed screen. */
  logicalToScreen(point: { x: number; y: number }): { x: number; y: number } {
    const transform = this.transform();
    return {
      x: transform.x + point.x * transform.scale,
      y: transform.y - point.y * transform.scale,
    };
  }

  /**
   * Moves straight to a height and keeps the zoom: a change of who is
   * followed is a cut, not a new start, so the view does not pump.
   */
  cutTo(y: number): void {
    this.y = y;
  }

  reset(y = 0): void {
    this.y = y;
    this.scale = CAMERA.stationaryZoom;
    this.stillSeconds = 0;
  }
}
