/**
 * The height tiers (UI layout system spec §3.2).
 *
 * The form factor (`form-factor.ts`) says what shape a screen is; the tier
 * says how much height it has to spend. Two screens of the same form factor
 * can need different answers: a 1280 x 720 desktop and a 900 x 600 window are
 * both desktop, and only one of them can afford the hero above the menu.
 *
 * Written to `<html data-height>` by the viewport tracker, beside
 * `data-form-factor`. Tokens tighten under it (`aquarian-tokens.css`), so
 * every primitive tightens at once; screen roots may also branch on it
 * through the `short:` and `compact:` variants.
 */

import { LETTERBOX_CROP_FRACTION, LOGICAL_VIEWPORT } from "../../lib/constants";
import type { BandMode } from "./band";
import { classifyFormFactor } from "./form-factor";

export type HeightTier = "short" | "compact";

/** At or below this many css px of layout height, a screen is short. */
export const SHORT_MAX_HEIGHT = 600;

/**
 * Below this, compact: what a browser leaves a sideways phone (780 x 270
 * Chrome on a Galaxy, 667 x 320 Safari on an SE). 844 x 340, Safari on an
 * iPhone 14, sits exactly on it and stays short.
 */
export const COMPACT_MAX_HEIGHT = 340;

/**
 * The height a screen has to spend: the band (`band.ts`), never more than the
 * window. A menu's band is the window. A race's landscape field is the canvas's
 * width at 16:9, less a bar top and bottom, so a tablet held sideways
 * (1180 x 820) lays its screens out in 598 px, a short desktop's room.
 * Portrait draws no bars. The same arithmetic as `letterbox.ts`, here so the
 * tier is known before the renderer has laid out.
 *
 * The desktop form factor only: a phone held sideways is tiered by its
 * window, which its layouts were drawn against.
 */
export function bandHeight(width: number, height: number, mode: BandMode): number {
  if (mode === "menu" || classifyFormFactor(width, height) !== "desktop") return height;
  const field = (width * LOGICAL_VIEWPORT.height) / LOGICAL_VIEWPORT.width;
  return Math.min(height, Math.round(field * (1 - 2 * LETTERBOX_CROP_FRACTION)));
}

export function classifyHeightTier(height: number): HeightTier | undefined {
  if (height < COMPACT_MAX_HEIGHT) return "compact";
  if (height <= SHORT_MAX_HEIGHT) return "short";
  return undefined;
}
