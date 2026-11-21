/**
 * The visible band (UI layout system spec §4.1).
 *
 * Everything laid over the game -- a screen's frame, the race HUD, the replay
 * bar, the story card -- positions inside it. In a menu it is the whole
 * window, so a menu fills an iPad or a desktop; in a race, a replay or the
 * story it is the 16:9 field between the letterbox's crop (`LETTERBOX_CROP_FRACTION`),
 * so nothing lands past the part of the course a player sees. In portrait
 * there is no crop and the band is the canvas either way.
 *
 * Published on `<html>`, not on the overlay, so fixed-position layers outside
 * the overlay read the same value. The defaults in `aquarian-tokens.css` (the
 * whole viewport) hold until the first layout.
 */

/** The whole window for menus; the 16:9 field for a race, a replay and the story. */
export type BandMode = "menu" | "field";

/** The shortest bottom bar, in CSS pixels, that DOM text may sit in. */
const BAR_ROOMY_MIN = 32;

export interface BandRect {
  /** Viewport css px from the top of the layout viewport. */
  top: number;
  /** `top + height`. */
  bottom: number;
  height: number;
}

/**
 * The band from `ViewportInfo.gameplayCss`, which `app.ts` already computes as
 * the field less its bars. Rounded inward-safe: top and height to whole px,
 * then bottom from them, so the three can never disagree.
 */
export function bandFromGameplay(gameplayCss: { y: number; height: number }): BandRect {
  const top = Math.round(gameplayCss.y);
  const height = Math.round(gameplayCss.y + gameplayCss.height) - top;
  return { top, bottom: top + height, height };
}

/**
 * The band for one layout. Menu: the whole canvas. Field: in landscape the
 * gameplay rect, between the crop; portrait draws no crop, and its gameplay
 * rect is only the field (between the HUD row and the bottom band, D-R1), so
 * there the band is the whole canvas too.
 */
export function bandForLayout(
  layout: { portrait: boolean; gameplay: { y: number; height: number } },
  canvasHeight: number,
  mode: BandMode,
): BandRect {
  const whole = mode === "menu" || layout.portrait;
  return bandFromGameplay(whole ? { y: 0, height: canvasHeight } : layout.gameplay);
}

/**
 * Whether DOM text (the menu's tagline) may sit in the bar under the field.
 *
 * Only in a field-mode landscape bar that can hold a line, and never on a phone
 * held sideways: 375 px of height cannot give a bar's worth above and below to
 * the menu and still fit the form (responsive parity spec §5.2). A menu has no
 * bar, so its tagline goes into the hero, as on phones.
 */
/**
 * The bottom bar's height in px, for `--ff-bar-height` (the building stops at
 * its top). A menu fills the window and portrait draws no bars, so both are 0.
 */
export function barHeightFor(mode: BandMode, portrait: boolean, canvasHeight: number, gameplayBottom: number): number {
  return mode === "menu" || portrait ? 0 : Math.max(0, canvasHeight - gameplayBottom);
}

export function bottomBarFor(mode: BandMode, barHeight: number, phoneLandscape: boolean): "roomy" | "none" {
  return mode === "field" && barHeight >= BAR_ROOMY_MIN && !phoneLandscape ? "roomy" : "none";
}

export function writeBand(root: HTMLElement, band: BandRect, mode?: BandMode): void {
  // The viewport tracker tiers the height by this (`height-tier.ts`).
  if (mode !== undefined) root.dataset["bandMode"] = mode;
  root.style.setProperty("--ff-band-top", `${band.top}px`);
  root.style.setProperty("--ff-band-bottom", `${band.bottom}px`);
  root.style.setProperty("--ff-band-height", `${band.height}px`);
}
