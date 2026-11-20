/**
 * The four form factors (responsive parity spec §2).
 *
 * Decided from the layout viewport's size alone. Whether the pointer is coarse
 * is a different question -- it decides which controls mount, not how a screen
 * is laid out -- so a tablet with a keyboard and a desktop with a touch screen
 * both get the layout their shape asks for.
 *
 * The one place the thresholds live. CSS reads the answer from
 * `data-form-factor`, Pixi from `ViewportInfo.formFactor`, and neither
 * re-derives it.
 */

export type FormFactor = "phone-portrait" | "phone-landscape" | "desktop" | "tablet-portrait";

/** A portrait viewport narrower than this is a phone; at or above it, a tablet. */
export const PHONE_PORTRAIT_MAX_WIDTH = 600;

/**
 * A landscape viewport shorter than this is a phone, or a desktop window short
 * enough to need the phone's compact layout. 500 rather than the 480 the HUD
 * used, so the 932 x 430 class of phone is inside it with room to spare.
 */
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

export function classifyFormFactor(width: number, height: number): FormFactor {
  // Strictly taller than wide, as `letterbox.ts` decides portrait.
  if (height > width) return width < PHONE_PORTRAIT_MAX_WIDTH ? "phone-portrait" : "tablet-portrait";
  return height < PHONE_LANDSCAPE_MAX_HEIGHT ? "phone-landscape" : "desktop";
}
