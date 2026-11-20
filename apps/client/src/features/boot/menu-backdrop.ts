/**
 * The menu backdrop the title and the lobby share.
 *
 * Claimed through the carry-over rather than built per screen, so moving
 * between the two keeps the same sky, clock and parallax and only the panel
 * changes. The returned release goes in the screen's bag like anything else
 * it owns.
 *
 * The menu's bloom look rides the same lease: on while either screen holds
 * the backdrop, back to the scene look once neither does.
 *
 * The backdrop hears the menu song. Its camera is struck by the kick only
 * while a claim asks for `beatZoom` -- the title's -- so the lobby, which
 * keeps the same backdrop, holds its framing still under the panel.
 */

import { installBackdropInspection } from "../render/inspection";
import { MENU_BLOOM } from "../render/filters/scene-bloom";
import { NonGameplayBackdrop } from "../render/non-gameplay-backdrop";
import { effectiveQuality, rebuildOnQuality } from "../render/quality-rebuild";
import { menuSongBeat } from "./menu-music";
import type { ScreenContext } from "../screen/screen";

/** How many live claims ask for the camera's kick. */
let beatZoomClaims = 0;

/** How many screens hold the backdrop now; the inspection hook reads it. */
let claims = 0;
let releaseInspection = (): void => {};

export function claimMenuBackdrop(
  context: ScreenContext,
  options: { zoomIn?: boolean; beatZoom?: boolean } = {},
): () => void {
  let releaseBeatZoom = (): void => {};
  if (options.beatZoom === true) {
    beatZoomClaims += 1;
    releaseBeatZoom = () => {
      beatZoomClaims -= 1;
      releaseBeatZoom = () => {};
    };
  }
  if (claims === 0) releaseInspection = installBackdropInspection(() => ({ drawn: claims > 0 }));
  claims += 1;
  const lease = context.carryOver.claim("menu-backdrop", () => {
    // `zoomIn` is the title's first showing: only the first build pulls the
    // camera back, not a rebuild for a quality change later.
    let zoomIn = options.zoomIn === true;
    // Rebuilt live when the player changes the graphics quality (§3.1.2).
    const backdrop = rebuildOnQuality(context.settings, (quality) => {
      const built = new NonGameplayBackdrop(context.stage, {
        quality: effectiveQuality(quality),
        zoomIn,
        music: () => context.audio.musicSpectrum?.(),
        song: () => menuSongBeat(context),
        beatZoom: () => beatZoomClaims > 0,
        still: () => !context.settings.value.display.stageEffects,
      });
      zoomIn = false;
      return built;
    });
    context.stage.setBloomLook?.(MENU_BLOOM);
    return {
      destroy: () => {
        context.stage.setBloomLook?.(undefined);
        backdrop.dispose();
      },
    };
  });
  let released = false;
  return () => {
    releaseBeatZoom();
    lease.release();
    if (released) return;
    released = true;
    claims -= 1;
    if (claims === 0) releaseInspection();
  };
}
