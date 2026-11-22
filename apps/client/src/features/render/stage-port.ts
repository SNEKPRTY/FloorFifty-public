/**
 * The stage a screen draws on: the view rectangles, the layers and the
 * backdrop lease. It sits in `render` so the backdrops and filters can name it
 * without reaching up to the screen contract.
 */

import type { Container, Filter, Ticker } from "pixi.js";
import type { FormFactor } from "../platform/form-factor";
import type { BandMode } from "../platform/band";
import type { BloomLook, BloomPulse } from "./filters/scene-bloom";

/**
 * A rectangle in one of the two spaces the client works in.
 *
 * The distinction is load-bearing, and the field names that carry these encode
 * it: `...Css` values are measured on the canvas, `...Logical` values are
 * measured in the fixed 960 x 540 world. Mixing them is how a filter ends up
 * pinned to a rectangle that is the right one scaled again -- see the
 * backdrop's filter area in `features/app/app.ts`.
 */
export type ViewRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** The layout as of the last resize, in both spaces at once. */
export type ViewportInfo = Readonly<{
  /** The canvas, in CSS pixels. */
  canvasCss: ViewRect;
  /**
   * The play field the player can actually see: the letterbox clip minus the
   * bars that crop it. A HUD anchors to this rather than to the canvas, which
   * is why it is published instead of derived per screen.
   */
  gameplayCss: ViewRect;
  /** The scenery's extent in logical units, covering the whole canvas. */
  sceneryLogical: ViewRect;
  /**
   * The play field's size in logical units: 960 wide, and as tall as the form
   * factor's field (D-R1). What the composite is sized to.
   */
  fieldLogical: Readonly<{ width: number; height: number }>;
  /** Whether the canvas is taller than it is wide. */
  portrait: boolean;
  /**
   * The form factor this canvas classifies as. The same function the document
   * is tagged with, so a Pixi layout and a Tailwind variant cannot disagree.
   */
  formFactor: FormFactor;
  /** Device pixels per CSS pixel. */
  pixelRatio: number;
}>;

/** A bounded scenery render a screen borrows for its lifetime. */
export interface BackdropLease {
  /**
   * The container the app renders, and the one the screen attaches its filter
   * chain to. Handed back so the screen filters the thing that is actually
   * drawn rather than a copy of it.
   */
  readonly filterRoot: Container;
  /** The source rectangle, in logical units, that the target covers. */
  readonly logicalRect: ViewRect;
  /** The allocated target size, in target pixels. Bounded by the area cap. */
  readonly targetSize: Readonly<{ width: number; height: number }>;
  /**
   * What the allocator actually reserves for that size, in pixels.
   *
   * A different number from the active area, and deliberately separate: a
   * pooled texture is rounded up to a power of two per axis, so a 489 x 1059
   * surface reserves 512 x 2048. Reporting only the area is how a bounded pass
   * turns out to be unbounded in memory.
   */
  readonly pooledCapacity: number;
  /** Releases the target. Idempotent, and never destroys a borrowed object. */
  destroy(): void;
}

/** The Pixi surface a screen draws into, narrowed to what screens may touch. */
export interface StagePort {
  /**
   * The current layout, published rather than recomputed.
   *
   * One source of truth for the geometry, so a screen drawing in screen space
   * and the app laying the letterbox out cannot disagree. Read at the moment it
   * is needed and re-read on `onViewportChange`; a screen that latches a
   * rectangle at entry has latched the wrong one the first time a phone is
   * turned.
   */
  readonly viewport: ViewportInfo;
  /**
   * Reports a layout. Returns the unsubscribe, per the client's ownership rule.
   *
   * Fires after the letterbox has been recomputed, so a listener sees the new
   * geometry rather than the one the resize invalidated.
   */
  onViewportChange(listener: (value: ViewportInfo) => void): () => void;
  /**
   * Renders `source` into a bounded target and shows the result.
   *
   * The screen keeps building its scenery exactly as before; what changes is
   * where it lands. `source` must not also be in the display tree, or the
   * scenery is drawn twice -- once by this target and once by the stage.
   */
  mountBackdrop(source: Container): BackdropLease;
  /**
   * A new palette-lock filter from the app's palette, or `undefined` when the
   * palette did not load.
   *
   * The caller owns what it gets and destroys it. A factory rather than a
   * shared instance, because one live Pixi filter carries per-target render
   * state and may not serve two targets.
   */
  createPaletteLock(): Filter | undefined;
  /**
   * Tells the scene bloom where the menu refraction's caustic band is, so the
   * band does not flare, or `undefined` once there is no band on screen.
   *
   * Optional: a stage without a bloom has nothing to tell.
   */
  setBloomBand?(band: { timeSeconds: number; intensity: number } | undefined): void;
  /**
   * Gives the scene bloom a screen's own look, or the authored scene look
   * back with `undefined`. Optional, as `setBloomBand` is.
   */
  setBloomLook?(look: Partial<BloomLook> | undefined): void;
  /**
   * Pulses the scene bloom over whatever look is in place -- its strength
   * scaled and the picture's saturation pushed -- or stops with `undefined`.
   * Optional, as `setBloomBand` is.
   */
  setBloomPulse?(pulse: BloomPulse | undefined): void;
  /**
   * The canvas the game draws on, for recording the race (unlockables spec
   * §6.1). Optional: a stage with no canvas has nothing to record.
   */
  canvas?(): HTMLCanvasElement | undefined;
  /**
   * Takes the letterbox bars to true black, or back to the palette's black.
   * `fadeMs` spreads the change over that long; without it, it is at once.
   * Optional: a stage without bars has nothing to shade.
   */
  setBarsBlack?(black: boolean, fadeMs?: number): void;
  /**
   * Where a race's scenery starts stretching, in canvas pixels, so a phone held
   * upright can cover it in the palette's black; undefined lets go. See
   * `LetterboxFrame.setSkirtLine`. Optional: a stage without bars has none.
   */
  setSkirtLine?(line: number | undefined): void;
  /**
   * What the visible band is (`features/platform/band.ts`): the whole window for a menu, the
   * 16:9 field for a race and a replay. Rewrites the band at
   * once and on every later layout. The app starts in `"menu"`.
   * Optional: a stage without a window to fill has no band.
   */
  setBandMode?(mode: BandMode): void;
  /**
   * The juice's aberration pulse on the LCD panel, on top of its own (A/V
   * polish plan, G6). Optional, and a no-op with the panel off.
   */
  setPanelAberration?(extra: number): void;
  /**
   * Everything the panel shader covers. Scenery, play field, and the clip.
   *
   * A screen touches this only to filter the whole picture at once; to draw,
   * use `backdrop`, `world` or `ui`.
   */
  readonly scene: Container;
  /**
   * CSS pixels per logical unit, as of the last layout.
   *
   * A pass that draws a pattern in screen space has to be told how big a game
   * pixel currently is. Exposed as a number rather than as the renderer,
   * because the alternative is a screen recomputing `renderer.width /
   * screenWidth` -- the same formula the letterbox already applied, kept in a
   * second place to drift from the first.
   *
   * CSS pixels, not device ones: `renderer.width` is the canvas measured in
   * the stage's own coordinates, which `renderer.resolution` then multiplies
   * on the way to the framebuffer. See `pixelRatio`.
   */
  readonly cellSize: number;
  /**
   * Device pixels per CSS pixel -- the renderer's resolution.
   *
   * The partner to `cellSize`, and separate from it because the two answer
   * different questions. `cellSize` is how big a game pixel looks; this is how
   * finely the display can draw one. A screen-space pass that band-limits
   * itself needs both, and collapsing them into one number is how a pattern
   * ends up filtered for the wrong footprint.
   */
  readonly pixelRatio: number;
  /**
   * The letterbox's flat backdrop colour, filling the whole canvas.
   *
   * Exposed so gameplay can hide it. It is opaque, and the sky pass paints
   * where nothing has been drawn, so a visible field leaves the dither nothing
   * to paint. Every other screen wants it.
   */
  readonly field: Container;
  /**
   * Scenery, drawn past the letterbox.
   *
   * Nothing here may decide a race; it exists so a device that is not 16:9
   * shows sky and skyline where it would otherwise show bars.
   */
  readonly backdrop: Container;
  /** Follows the camera, clipped to the letterbox. Platforms and players. */
  readonly world: Container;
  /** Fixed in screen space. HUD, menus, overlays. */
  readonly ui: Container;
  /** Unclipped foreground effects: impact flash, speed lines. Carries the frame's transform without the mask. */
  readonly effects?: Container;
  /** Over the letterbox bars too: what must cover the whole screen (the impact flash, the lava's spill). Same transform as `effects`. */
  readonly front?: Container;
  /** The DOM element overlaying the canvas, for HTML controls. */
  readonly overlay: HTMLElement;
  /**
   * The render loop, when one exists.
   *
   * Optional because a screen test runs without a renderer: a screen that needs
   * per-frame work must still enter cleanly when there is no ticker to join.
   */
  readonly app?: { readonly ticker: Ticker };
  /** Active context, exposed only for one-time shader preflight validation. */
  readonly webgl?: WebGLRenderingContextBase;
  readonly screenWidth: number;
  readonly screenHeight: number;
  /**
   * Turns the LCD panel on or off (the player's display setting). Optional:
   * a stage with no panel has nothing to switch.
   */
  setPanel?(enabled: boolean): void;
}
