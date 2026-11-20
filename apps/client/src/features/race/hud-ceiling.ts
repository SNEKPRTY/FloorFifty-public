/**
 * The bottom of the race HUD's top band, for what the canvas draws under it
 * to keep clear of (the owner: the pop-up words were covered by the HUD).
 */

/**
 * The bottom of the lowest chip or control in the HUD's top half, in CSS px
 * from the overlay's top; 0 with none. A banner, the announcer and Survival's
 * vignette are not chips, and a phone's standings line sits in the bottom half.
 */
export function hudCeiling(overlay: HTMLElement): number {
  const frame = overlay.getBoundingClientRect();
  let bottom = 0;
  for (const element of overlay.querySelectorAll<HTMLElement>('[data-testid="race-hud"] .ff-aq-hud, [data-testid="pause-open"]')) {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) continue;
    if (rect.top - frame.top > frame.height / 2) continue;
    bottom = Math.max(bottom, rect.bottom - frame.top);
  }
  return bottom;
}
