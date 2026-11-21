/**
 * Fullscreen (spec §3.1.5). iPhone Safari has no element fullscreen; the
 * nearest thing is running from the Home Screen, so there the button teaches
 * that instead of doing nothing.
 *
 * iPad Safari has element fullscreen but is sent to the Home Screen too. In
 * element fullscreen WebKit watches for fast, repeated taps -- the pattern of
 * someone typing on a keyboard drawn to phish them -- and lays "It looks like
 * you are typing while in full screen" over the page. A race is fast taps, the
 * check cannot be turned off from a page, and an app opened from the Home
 * Screen is never checked.
 *
 * Inside Ruken the host owns the page, so fullscreen is the host's to give
 * (P6 §4): each function here asks the current hosting first. The host says
 * what the device supports only when asked, so the toggle is offered until
 * the host's first answer says otherwise.
 */

import { isEmbedded } from "./embedded-frame";
import { currentHosting } from "../ruken/current";
import type { FullscreenSupport, Hosting } from "../ruken/host";

export type { FullscreenSupport };

const isIos = (nav: Navigator): boolean =>
  /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);

/** What each Ruken host last said the device supports, from its answer to a fullscreen request. */
const hostSupport = new WeakMap<Hosting, FullscreenSupport>();

/** Whether this page is framed by another, as Ruken frames it; false with no window at all. */
const pageEmbedded = (): boolean => (typeof window === "undefined" ? false : isEmbedded(window));

/** Which fullscreen, if any, this browser can give the game. */
export function fullscreenSupport(doc: Document = document, nav: Navigator = navigator, embedded: boolean = pageEmbedded()): FullscreenSupport {
  const hosting = currentHosting();
  if (hosting.hosted) return hostSupport.get(hosting) ?? "element";
  // In a frame, "add to Home Screen" would install the host's page, not the
  // game, and Ruken's frame on an iPhone already fills the window.
  if (embedded && isIos(nav)) return "none";
  // Opened from the Home Screen, the game already has the whole screen.
  if (isIos(nav)) return (nav as Navigator & { standalone?: boolean }).standalone === true ? "none" : "ios-home-screen";
  if (doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === "function") return "element";
  return "none";
}

export function isFullscreen(doc: Document = document): boolean {
  const hosting = currentHosting();
  if (hosting.hosted) return hosting.isFullscreen();
  return doc.fullscreenElement != null;
}

/** Hears fullscreen being entered or left, by the browser or, inside Ruken, by the host. */
export function onFullscreenChange(listener: () => void, doc: Document = document): () => void {
  doc.addEventListener("fullscreenchange", listener);
  const releaseHost = currentHosting().onFullscreenChange(() => listener());
  return () => {
    doc.removeEventListener("fullscreenchange", listener);
    releaseHost();
  };
}

/**
 * Enters or leaves fullscreen. Entering also asks for a landscape lock, which
 * most phones refuse outside an installed app; a refusal changes nothing. In a
 * frame (Ruken) it never asks: the host owns the screen's direction.
 */
export async function toggleFullscreen(doc: Document = document, embedded: boolean = pageEmbedded()): Promise<void> {
  const hosting = currentHosting();
  if (hosting.hosted) {
    hostSupport.set(hosting, await hosting.setFullscreen(!hosting.isFullscreen()));
    return;
  }
  if (isFullscreen(doc)) {
    await doc.exitFullscreen().catch(() => undefined);
    return;
  }
  await doc.documentElement.requestFullscreen().catch(() => undefined);
  if (embedded) return;
  const orientation = (globalThis.screen as Screen | undefined)?.orientation as
    | (ScreenOrientation & { lock?: (orientation: string) => Promise<void> })
    | undefined;
  await orientation?.lock?.("landscape").catch(() => undefined);
}
