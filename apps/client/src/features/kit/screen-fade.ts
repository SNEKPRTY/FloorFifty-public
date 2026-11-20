/**
 * The screen cross-fade (UI overhaul spec, "Motion": screens change with a
 * 200 ms cross-fade and nothing slides).
 *
 * The screen manager owns when it runs; this file owns how. The overlay root
 * fades out over the first half of `SCREEN_FADE_MS` and is `inert` from its
 * first frame, then the new screen mounts and the root fades back over the
 * second half, taking input at once. Stepped, like every other chrome fade.
 * Under reduced motion both halves land at once.
 */

import { reducedMotion, SCREEN_FADE_MS, STEP_EASE } from "./motion";

/** What `ScreenManager` needs of a cross-fade: out before the swap, in after. */
export interface FadePort {
  /** Fades the root to 0 and makes it `inert`; settles when it is out. */
  out(): Promise<void>;
  /** Clears `inert` at once and fades the root back in. Does not wait. */
  in(): void;
}

const HALF_MS = SCREEN_FADE_MS / 2;
/**
 * How long `out()` waits for the browser to say the fade ended before it
 * gives up and carries on. A busy or software-rendered page can start a
 * transition late; the swap waits for the fade, not for a clock.
 */
const BACKUP_MS = 600;

export function screenFade(root: HTMLElement): FadePort {
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTransition = () => {
    root.style.transition = "";
  };

  return {
    out() {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      root.inert = true;
      if (reducedMotion()) {
        clearTransition();
        root.style.opacity = "0";
        return Promise.resolve();
      }
      // Already out (the manager always calls in() between two outs, so this is a guard).
      if (getComputedStyle(root).opacity === "0") return Promise.resolve();
      root.style.transition = `opacity ${HALF_MS}ms ${STEP_EASE}`;
      root.style.opacity = "0";
      return new Promise<void>((resolve) => {
        const done = () => {
          root.removeEventListener("transitionend", onEnd);
          clearTimeout(backup);
          resolve();
        };
        const onEnd = (event: Event) => {
          // Only the fade-out's own end counts: the fade-in's transitionend can
          // still be on its way when out() starts, and it arrives while the
          // root is not yet transparent.
          if (event.target === root && (event as TransitionEvent).propertyName === "opacity" && getComputedStyle(root).opacity === "0") done();
        };
        const backup = setTimeout(done, BACKUP_MS);
        root.addEventListener("transitionend", onEnd);
      });
    },
    in() {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      root.inert = false;
      if (reducedMotion()) {
        clearTransition();
        root.style.opacity = "1";
        return;
      }
      root.style.transition = `opacity ${HALF_MS}ms ${STEP_EASE}`;
      root.style.opacity = "1";
      settleTimer = setTimeout(clearTransition, HALF_MS);
    },
  };
}
