/**
 * The studio's screen, first thing at launch: the SNEKPRTY logo on white that
 * fades in, holds and fades out over three seconds, then lets the game's own
 * splash begin. A key press or a touch ends it early. It shows once per
 * launch, and where the player asked for less movement it is the same screen
 * with no fade. (`StudioSplash.svelte` draws it; the timing is here.)
 */

import { mount, unmount } from "svelte";
import StudioSplash from "./StudioSplash.svelte";
import { browserTimers, type Timers } from "../../lib/load-meter";
import { reducedMotion } from "../kit/motion";
import { PAD_PRESS } from "../platform/focus-nav";

/** How long the studio's screen is up, fades included. */
export const STUDIO_SPLASH_MS = 3000;

/**
 * How long the screen waits for the logo to arrive before it gives up and lets
 * the game go on: a logo that can never come must not hold the game back.
 */
export const STUDIO_LOGO_WAIT_MS = 8000;

/** A wait for the studio's screen to be over, and a way to end it at once. */
export type StudioGate = (overlay: HTMLElement) => { done: Promise<void>; cancel: () => void; shown?: boolean };

let shownThisLaunch = false;

/** For tests: the next launch shows it again. */
export function resetStudioSplash(): void {
  shownThisLaunch = false;
}

const nothing: ReturnType<StudioGate> = { done: Promise.resolve(), cancel: () => {}, shown: false };

/** The studio's screen on `overlay`, shown once per launch. */
export function studioSplash(overlay: HTMLElement, timers: Timers = browserTimers, still: () => boolean = reducedMotion): ReturnType<StudioGate> {
  if (shownThisLaunch) return nothing;
  shownThisLaunch = true;
  const app = mount(StudioSplash, { target: overlay, props: { still: still(), ms: STUDIO_SPLASH_MS } });
  const root = overlay.querySelector<HTMLElement>('[data-testid="studio-splash"]');
  const logo = root?.querySelector("img") ?? null;
  let handle: unknown;
  let finish = (): void => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    timers.clearTimeout(handle);
    window.removeEventListener("keydown", end);
    window.removeEventListener("pointerdown", end);
    window.removeEventListener(PAD_PRESS, end);
    logo?.removeEventListener("load", arrived);
    logo?.removeEventListener("error", end);
    void unmount(app);
    finish();
  };
  // The three seconds count from the logo's arrival, so a slow link never shows plain white.
  function arrived(): void {
    if (ended) return;
    timers.clearTimeout(handle);
    if (root !== null) root.dataset["loaded"] = "true";
    handle = timers.setTimeout(end, STUDIO_SPLASH_MS);
  }
  if (logo !== null && logo.complete && logo.naturalWidth > 0) arrived();
  else {
    logo?.addEventListener("load", arrived);
    logo?.addEventListener("error", end);
    handle = timers.setTimeout(end, STUDIO_LOGO_WAIT_MS);
  }
  window.addEventListener("keydown", end);
  window.addEventListener("pointerdown", end);
  window.addEventListener(PAD_PRESS, end);
  return { done, cancel: end, shown: true };
}
