/**
 * The boot loader: a stepped ring that `index.html` paints from the first
 * frame, before any script has arrived, so the page is never a plain black
 * while the client downloads, reaches the server and loads the splash. It
 * sits over the splash's black cover too, and goes when the splash shows --
 * or when the boot fails, so a failure is not read as still loading.
 *
 * It also says how far the boot has got (`reportBootStep`, from real steps
 * and never a timer) and, after eight seconds, that it is slow -- that last
 * line is `index.html`'s own CSS, so it comes on while the script is still
 * downloading.
 */

import * as m from "../../paraglide/messages.js";
import { browserTimers, type Timers } from "../../lib/load-meter";

/** As long as the splash's cover takes to lift, so the two go together. */
export const BOOT_LOADER_FADE_MS = 320;

export function dismissBootLoader(doc: Document = document): void {
  const loader = doc.getElementById("ff-boot-loader");
  if (loader === null || loader.classList.contains("ff-boot-loader--gone")) return;
  loader.classList.add("ff-boot-loader--gone");
  setTimeout(() => loader.remove(), BOOT_LOADER_FADE_MS);
}

/**
 * Re-words the loader once the language is known: `index.html` paints before
 * any script, so it can only say "Loading".
 */
export function wordBootLoader(doc: Document = document): void {
  const word = doc.querySelector("#ff-boot-loader span:not([aria-hidden])");
  if (word !== null) word.textContent = m.shell_loading();
  const slow = doc.querySelector('#ff-boot-loader [data-testid="boot-slow"]');
  if (slow !== null) slow.textContent = m.shell_loading_slow();
  doc.querySelector('#ff-boot-loader [data-testid="boot-progress"]')?.setAttribute("aria-label", m.shell_loading());
}

/**
 * The steps of the boot the loader covers, and how much of the bar each is
 * worth. Roughly their share of the wait on a slow link: the fonts and the
 * server's content are the big ones.
 */
const BOOT_STEP_WEIGHTS = { host: 1, content: 3, manifest: 1, fonts: 3, art: 1 } as const;
export type BootStep = keyof typeof BOOT_STEP_WEIGHTS;

const reached = new Map<BootStep, number>();

/** How far the boot has got, 0 to 1. */
export function bootProgressValue(): number {
  let done = 0;
  let total = 0;
  for (const [step, weight] of Object.entries(BOOT_STEP_WEIGHTS) as [BootStep, number][]) {
    total += weight;
    done += weight * (reached.get(step) ?? 0);
  }
  return done / total;
}

/** Forgets every step. A test's reset; a page boots once. */
export function resetBootProgress(): void {
  reached.clear();
}

/**
 * A step of the boot has got `fraction` of the way. Never goes backwards, and
 * says nothing once the loader has gone.
 */
export function reportBootStep(step: BootStep, fraction: number, doc: Document = document): void {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  if (clamped > (reached.get(step) ?? 0)) reached.set(step, clamped);

  const bar = doc.querySelector<HTMLElement>('#ff-boot-loader [data-testid="boot-progress"]');
  if (bar === null) return;
  const percent = Math.round(bootProgressValue() * 100);
  bar.hidden = false;
  bar.setAttribute("aria-valuenow", String(percent));
  const fill = bar.querySelector<HTMLElement>(".ff-boot-loader__fill");
  if (fill !== null) fill.style.width = `${percent}%`;
}

/** How long to wait for a frame before going on without one (a hidden page gets none). */
const FIRST_PAINT_FALLBACK_MS = 250;

/**
 * Resolves once the page has had a chance to put its first frame on screen.
 *
 * Inside Ruken the host lifts its cover when the game says hello, so hello
 * waits for this: the loader in `index.html` is in the first frame, and the
 * frame is out. A callback in `requestAnimationFrame` runs just before the
 * frame is drawn, so the turn after it is when it is on screen. A page that
 * gets no frames (a frame the host has hidden) must not be held, so there is
 * a fallback -- it only decides when to say hello, never what is shown.
 */
export function afterFirstPaint(
  options: {
    requestFrame?: (callback: FrameRequestCallback) => unknown;
    timers?: Timers;
  } = {},
): Promise<void> {
  const requestFrame =
    options.requestFrame ?? (typeof requestAnimationFrame === "function" ? (callback: FrameRequestCallback) => requestAnimationFrame(callback) : undefined);
  const timers = options.timers ?? browserTimers;
  return new Promise<void>((resolve) => {
    let over = false;
    let fallback: unknown;
    const go = (): void => {
      if (over) return;
      over = true;
      timers.clearTimeout(fallback);
      resolve();
    };
    fallback = timers.setTimeout(go, FIRST_PAINT_FALLBACK_MS);
    requestFrame?.(() => {
      timers.clearTimeout(fallback);
      fallback = timers.setTimeout(go, 0);
    });
  });
}
