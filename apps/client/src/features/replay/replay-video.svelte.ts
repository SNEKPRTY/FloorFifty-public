/**
 * Mounts Save video and Share video into the replay window (unlockables spec
 * §6.4, amended) and keeps them under the HUD on the right edge: the HUD's
 * roster holds the top-right corner in landscape, and its tiles span the top
 * on a phone held upright, so the buttons sit below whatever HUD is above
 * them, re-measured as the layout changes.
 */

import { mount, unmount } from "svelte";
import type { StagePort } from "../render/stage-port";
import type { RaceVideo } from "../net/race-video.svelte";
import ReplayVideoButtons from "./ReplayVideoButtons.svelte";
import type { ReplayShare } from "./replay-share.svelte";

/** How wide a band at the right edge the buttons and their lines take, in CSS px. */
const BAND_PX = 140;
const GAP_PX = 8;

/** The bottom of the lowest HUD element in the right-hand band, relative to the overlay. */
export function hudBottomOnRight(overlay: HTMLElement): number {
  const frame = overlay.getBoundingClientRect();
  let bottom = 0;
  for (const element of overlay.querySelectorAll<HTMLElement>('[data-testid="race-hud"] *')) {
    if (element.closest('[data-testid="replay-video"]') !== null) continue;
    // Survival's vignette covers the whole field; it is shading, not HUD (survival spec §7).
    if (element.dataset["testid"] === "survival-vignette") continue;
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0 || rect.right < frame.right - BAND_PX) continue;
    // The HUD's top band only: a toast or banner mid-screen is not a ceiling.
    if (rect.top - frame.top > frame.height / 2) continue;
    bottom = Math.max(bottom, rect.bottom - frame.top);
  }
  return bottom;
}

export class ReplayVideoView {
  private readonly place = $state({ top: GAP_PX });
  private readonly app: Record<string, unknown>;
  private readonly release: (() => void)[] = [];

  constructor(stage: StagePort, share: ReplayShare, video: RaceVideo | undefined) {
    const place = this.place;
    this.app = mount(ReplayVideoButtons, {
      target: stage.overlay,
      props: {
        share,
        get available() {
          return video?.current !== undefined;
        },
        get top() {
          return place.top;
        },
      },
    });
    const measure = (): void => {
      place.top = hudBottomOnRight(stage.overlay) + GAP_PX;
    };
    measure();
    this.release.push(stage.onViewportChange(() => requestAnimationFrame(measure)));
    // The roster grows with its rows while the HUD's frame stays put, so
    // both are watched.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      for (const element of stage.overlay.querySelectorAll('[data-testid="race-hud"], [data-testid="hud-roster"]')) observer.observe(element);
      this.release.push(() => observer.disconnect());
    }
  }

  destroy(): void {
    for (const release of this.release.splice(0)) release();
    void unmount(this.app);
  }
}
