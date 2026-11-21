/**
 * A racer's name tag (UI layout system spec §4.2).
 *
 * The canvas twin of the DOM's `NamePill`: an opaque plate in the chip swatch,
 * the seat's colour dot, the seat number set apart from the name, and the name
 * itself. The plate exists because outlined text alone read as a smear over
 * the sun disc and white clouds (audit M2); the separate seat number exists
 * because `1 Wolfgang-Amadeus` set in one run read as "1Wolfgang- madeus".
 *
 * Every colour is an existing palette swatch drawn opaque, so the palette lock
 * holds: no alpha, no blend.
 */

import { Container, Graphics, Text } from "pixi.js";
import { playerColorTint, roleTint, type PlayerColorName } from "@floor-fifty/asset-contract/roles";
import { FONT_UI } from "../i18n/fonts";

/** The smallest a tag's face may be drawn on screen, in css px. */
export const NAME_TAG_MIN_CSS_PX = 12;
/** Longer names are cut on the tag only; the full name stays everywhere else. */
export const NAME_TAG_MAX_CHARS = 12;
/** The logical size the tag's face is set at. */
export const NAME_TAG_FONT_SIZE = 11;

/** Inner padding, dot size and gaps, in logical units. */
const PAD_X = 4;
const PAD_Y = 2;
const DOT = 5;
const GAP = 3;
const RADIUS = 3;
/** The focused racer's marker, in logical units (was `LOCAL_MARKER`). */
const MARKER = { width: 9, height: 6 } as const;

/** What a tag reads: the name, cut to twelve characters. */
export function nameTagText(name: string): string {
  return name.length > NAME_TAG_MAX_CHARS ? `${name.slice(0, NAME_TAG_MAX_CHARS)}…` : name;
}

/**
 * The face's on-screen size for a letterbox, in css px: a whole multiple of
 * `NAME_TAG_MIN_CSS_PX` (12, 24, 36...), never under one.
 *
 * The face is Fusion Pixel at 12 px, crisp only at whole multiples of 12. The
 * step comes from the letterbox alone (`cssPerUnit`, the camera at its resting
 * zoom of 1), never from the live camera: the camera eases between 0.8 and 1.0
 * as a racer starts and stops, and a step chosen from it flipped 24 and 12 px
 * back and forth.
 */
export function nameTagFacePx(cssPerUnit: number): number {
  if (!Number.isFinite(cssPerUnit) || cssPerUnit <= 0) return NAME_TAG_MIN_CSS_PX;
  return Math.max(1, Math.round((cssPerUnit * NAME_TAG_FONT_SIZE) / NAME_TAG_MIN_CSS_PX)) * NAME_TAG_MIN_CSS_PX;
}

/**
 * The scale, in world units, that holds a tag's face at `nameTagFacePx` on
 * screen whatever the camera's `zoom` is, so the tag keeps one size all race.
 */
export function nameTagScale(cssPerUnit: number, zoom: number): number {
  const onScreen = cssPerUnit * zoom * NAME_TAG_FONT_SIZE;
  if (!Number.isFinite(onScreen) || onScreen <= 0) return 1;
  return nameTagFacePx(cssPerUnit) / onScreen;
}

/**
 * The scale that keeps a face of `logicalSize` at least `NAME_TAG_MIN_CSS_PX`
 * on screen, and leaves it alone above that. The lava marker's, whose face is
 * 14 and so is not on the 12 px grid.
 */
export function minimumFaceScale(cssPerLogical: number, logicalSize: number): number {
  const drawn = cssPerLogical * logicalSize;
  if (!Number.isFinite(drawn) || drawn <= 0) return 1;
  return Math.max(1, NAME_TAG_MIN_CSS_PX / drawn);
}

/**
 * The resolution a tag's text is drawn at so one texel is one device pixel:
 * the face's device-pixel size over its logical size. Handed to `Text.resolution`,
 * it stops the canvas resampling the glyphs a second time.
 */
export function nameTagResolution(faceCssPx: number, pixelRatio: number, logicalSize: number): number {
  const resolution = (faceCssPx * pixelRatio) / logicalSize;
  return Number.isFinite(resolution) && resolution > 0 ? Math.round(resolution * 1000) / 1000 : 1;
}

/**
 * Draw order for racers and their tags: seat order, with the focused racer
 * (the local one, or the followed one in a replay) above them all (audit M1).
 */
export function racerZIndex(playerId: string, focusId: string | undefined, seat: number): number {
  return playerId === focusId ? 100 : seat;
}

export class NameTag {
  readonly root = new Container();
  private readonly plate = new Graphics();
  private readonly dot = new Graphics();
  private readonly badge: Text;
  private readonly name: Text;
  private readonly marker = new Graphics();
  private isFocused = false;
  private shown = "";

  constructor(seat: number, colour: PlayerColorName) {
    this.root.label = "name-tag";
    this.plate.label = "name-tag-plate";
    this.dot.label = "name-tag-dot";
    this.marker.label = "local-marker";
    this.dot.circle(0, 0, DOT / 2).fill(playerColorTint(colour));
    this.badge = new Text({
      text: String(seat + 1),
      roundPixels: true,
      style: { fill: roleTint("uiMuted"), fontFamily: FONT_UI, fontWeight: "600", fontSize: NAME_TAG_FONT_SIZE },
    });
    this.badge.label = "name-tag-seat";
    this.name = new Text({
      text: "",
      roundPixels: true,
      style: { fill: roleTint("uiMuted"), fontFamily: FONT_UI, fontWeight: "600", fontSize: NAME_TAG_FONT_SIZE },
    });
    this.name.label = "name-tag-name";
    for (const text of [this.badge, this.name]) text.anchor.set(0, 1);
    const half = MARKER.width / 2;
    this.marker
      .poly([-half, 0, half, 0, 0, MARKER.height])
      .fill(roleTint("cloud"))
      .stroke({ color: roleTint("cityNear"), width: 1, alignment: 1 });
    this.marker.visible = false;
    this.root.addChild(this.plate, this.dot, this.badge, this.name, this.marker);
    this.redraw();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  /**
   * Shows or hides the seat number. The story hides it: there is no race, and
   * "1 You", "2 Frog" read as places (story mode v2 review, R6).
   */
  setSeatShown(shown: boolean): void {
    if (this.badge.visible === shown) return;
    this.badge.visible = shown;
    this.redraw();
  }

  setName(name: string): void {
    const text = nameTagText(name);
    if (text === this.shown) return;
    this.shown = text;
    this.name.text = text;
    this.redraw();
  }

  /**
   * Redraws the name and seat in another face: the player view follows a
   * language switch with the locale's stack (languages spec §6.2), so a name
   * in the new script draws in a face that has it.
   */
  setFontFamily(stack: string): void {
    if (this.name.style.fontFamily === stack) return;
    this.badge.style.fontFamily = stack;
    this.name.style.fontFamily = stack;
    this.redraw();
  }

  /** Draws the face at `resolution` (see `nameTagResolution`); the layout is in logical units, so nothing moves. */
  setResolution(resolution: number): void {
    if (this.name.resolution === resolution) return;
    this.badge.resolution = resolution;
    this.name.resolution = resolution;
  }

  setFocus(focused: boolean): void {
    if (focused === this.isFocused) return;
    this.isFocused = focused;
    this.name.style.fill = roleTint(focused ? "uiText" : "uiMuted");
    this.marker.visible = focused;
    this.redraw();
  }

  /** Lays the plate out around its contents, anchored bottom-centre at (0, 0). */
  private redraw(): void {
    const height = NAME_TAG_FONT_SIZE + PAD_Y * 2;
    const seat = this.badge.visible ? this.badge.width + GAP : 0;
    const width = PAD_X + DOT + GAP + seat + this.name.width + PAD_X;
    const left = -width / 2;
    this.plate
      .clear()
      .roundRect(left, -height, width, height, RADIUS)
      .fill(roleTint("uiChipFill"))
      .stroke({
        color: roleTint("uiChipEdge"),
        width: 1,
        alignment: 1,
      });
    const baseline = -PAD_Y;
    this.dot.position.set(left + PAD_X + DOT / 2, -height / 2);
    this.badge.position.set(left + PAD_X + DOT + GAP, baseline);
    this.name.position.set(this.badge.x + seat, baseline);
    this.marker.position.set(0, 2);
  }
}

/** A cluster count uses the same opaque plate and sizing as its racer names. */
export class NameplateChip {
  readonly root = new Container();
  private readonly plate = new Graphics();
  private readonly count = new Text({
    text: "",
    roundPixels: true,
    style: { fill: roleTint("uiText"), fontFamily: FONT_UI, fontWeight: "600", fontSize: NAME_TAG_FONT_SIZE },
  });

  constructor() {
    this.root.label = "nameplate-chip";
    this.root.zIndex = 200;
    this.plate.label = "nameplate-chip-plate";
    this.count.label = "nameplate-chip-count";
    this.count.anchor.set(0.5, 1);
    this.count.y = -PAD_Y;
    this.root.addChild(this.plate, this.count);
  }

  setCount(count: number): void {
    const text = `×${count}`;
    if (this.count.text === text) return;
    this.count.text = text;
    this.redraw();
  }

  setResolution(resolution: number): void {
    if (this.count.resolution !== resolution) this.count.resolution = resolution;
  }

  setFontFamily(stack: string): void {
    if (this.count.style.fontFamily === stack) return;
    this.count.style.fontFamily = stack;
    this.redraw();
  }

  private redraw(): void {
    const width = this.count.width + PAD_X * 2;
    const height = NAME_TAG_FONT_SIZE + PAD_Y * 2;
    this.plate.clear().roundRect(-width / 2, -height, width, height, RADIUS)
      .fill(roleTint("uiChipFill"))
      .stroke({ color: roleTint("uiChipEdge"), width: 1, alignment: 1 });
  }
}
