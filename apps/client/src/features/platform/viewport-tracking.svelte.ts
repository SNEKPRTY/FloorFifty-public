/**
 * Keeps the document's form factor current (responsive parity spec §2.2, §4.4).
 *
 * Classified from the *layout* viewport, `innerWidth x innerHeight`, never the
 * visual one. The on-screen keyboard shrinks the visual viewport, and a
 * classifier that read it would swap the whole layout the moment a player
 * tapped the name field.
 *
 * What covers the layout viewport's foot is published separately, as
 * `--ff-visual-inset-bottom`: the keyboard, and anything else the browser
 * lays over the page instead of resizing it, such as a toolbar at the bottom.
 * The full-screen screens (`.ff-screen`) and the touch controls end above it,
 * so no bar sits over a button that nothing can scroll out from under it
 * (responsive parity spec §5.7, gate round 3).
 *
 * A bar the browser covers the page with *without* reporting it at all is
 * published as `--ff-hidden-bar-bottom` (and folded into the inset above).
 * `#app` ends above it too, so the canvas does. See `hidden-browser-bar.ts`.
 */

import type { HostReserved, Hosting } from "../ruken/host";
import { classifyFormFactor, type FormFactor } from "./form-factor";
import { bandHeight, classifyHeightTier, type HeightTier } from "./height-tier";
import { HiddenBrowserBar, isDuckDuckGo } from "./hidden-browser-bar";

class FormFactorState {
  current = $state<FormFactor>("desktop");
}

/** The current form factor, for the rare component that branches in script. */
export const formFactor = new FormFactorState();

class HeightTierState {
  current = $state<HeightTier | undefined>(undefined);
}

/** The current height tier, for screen roots that choose an arrangement in script. */
export const heightTier = new HeightTierState();

type Listen = (type: string, listener: () => void) => void;

export type ViewportWindow = {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly visualViewport?:
    | { readonly height: number; readonly offsetTop: number; addEventListener: Listen; removeEventListener: Listen }
    | null;
  /** Read only where the browser needs its bar recognised (`hidden-browser-bar.ts`). */
  readonly screen?: { readonly width: number; readonly height: number };
  readonly navigator?: object;
  addEventListener: Listen;
  removeEventListener: Listen;
};

/** Whether a text field has focus, which on some browsers shrinks the whole page. */
function isEditing(doc: Document): boolean {
  const active = doc.activeElement;
  return active instanceof HTMLElement && active.closest("input, textarea, [contenteditable='true']") !== null;
}

/**
 * When to measure again after a viewport event, in milliseconds.
 *
 * A browser's bars and keyboard animate, and the event that reports them can
 * fire before the sizes have stopped moving. Measured on an Android emulator:
 * the keyboard closed, the last event fired mid-animation, and the inset was
 * left at the keyboard's height with no further event to correct it. A few
 * follow-up measurements cover the animation; each one is only a read and a
 * style write, and the latest event restarts them.
 */
export const SETTLE_DELAYS_MS = [100, 400, 1000] as const;

export function trackViewport(win: ViewportWindow, root: HTMLElement): () => void {
  const hiddenBar = win.navigator != null && isDuckDuckGo(win.navigator) ? new HiddenBrowserBar() : undefined;
  let lastHeight: number | undefined;

  const measure = (): void => {
    const next = classifyFormFactor(win.innerWidth, win.innerHeight);
    root.dataset["formFactor"] = next;
    formFactor.current = next;
    // How much height the screen has to spend (UI layout system spec §3.2).
    // From the same layout viewport as the form factor, for the same reason:
    // the on-screen keyboard must not re-tier the page under a typing player.
    // By the band the screens are laid out in: the window in a menu, the
    // letterbox's field in a race (`app.ts` writes the mode beside the band).
    const mode = root.dataset["bandMode"] === "field" ? "field" : "menu";
    const tier = classifyHeightTier(bandHeight(win.innerWidth, win.innerHeight, mode));
    if (tier === undefined) delete root.dataset["height"];
    else root.dataset["height"] = tier;
    heightTier.current = tier;
    const visual = win.visualViewport;
    const inset = visual == null ? 0 : Math.max(0, win.innerHeight - visual.height - visual.offsetTop);

    const screenSize = win.screen;
    const hidden =
      hiddenBar == null || screenSize == null
        ? 0
        : hiddenBar.measure({
            screenHeight: screenSize.height,
            innerHeight: win.innerHeight,
            portrait: screenSize.height > screenSize.width,
            editing: isEditing(root.ownerDocument),
            fullscreen: root.ownerDocument.fullscreenElement != null,
            settled: lastHeight === win.innerHeight,
          });
    lastHeight = win.innerHeight;

    root.style.setProperty("--ff-visual-inset-bottom", `${Math.round(inset + hidden)}px`);
    // Something covers the page's foot: a screen frame scrolls what it hides
    // rather than leaving an action under it (responsive parity gate round 3).
    if (Math.round(inset + hidden) > 0) root.dataset["visualInset"] = "";
    else delete root.dataset["visualInset"];
    root.style.setProperty("--ff-hidden-bar-bottom", `${Math.round(hidden)}px`);
  };

  let settling: ReturnType<typeof setTimeout>[] = [];
  const update = (): void => {
    measure();
    settling.forEach(clearTimeout);
    settling = SETTLE_DELAYS_MS.map((ms) => setTimeout(measure, ms));
  };

  update();
  win.addEventListener("resize", update);
  win.visualViewport?.addEventListener("resize", update);
  win.visualViewport?.addEventListener("scroll", update);
  return () => {
    settling.forEach(clearTimeout);
    win.removeEventListener("resize", update);
    win.visualViewport?.removeEventListener("resize", update);
    win.visualViewport?.removeEventListener("scroll", update);
  };
}

/**
 * Asks everything that lays out against the viewport to measure again, now
 * and as the settle delays pass.
 *
 * For the moment a screen appears. A WebView's bars can finish settling while
 * a screen is loading and send no event at all, which left the race's touch
 * controls under a browser's bottom bar until a rotation forced a re-layout
 * (DuckDuckGo on a Galaxy). A synthetic `resize` reaches the viewport tracker
 * and the renderer's resize plugin alike; each re-reads the real sizes, so
 * where nothing moved, nothing changes.
 */
export function remeasureViewport(win: Pick<Window, "dispatchEvent"> = window): () => void {
  const fire = (): void => void win.dispatchEvent(new Event("resize"));
  fire();
  const timers = SETTLE_DELAYS_MS.map((ms) => setTimeout(fire, ms));
  return () => timers.forEach(clearTimeout);
}

/**
 * Inside Ruken, the host keeps a strip on one side of the game for its own
 * tab (`display.metrics.hostReserved`, P6 §4). Its width, in CSS pixels, is
 * set as `--ff-host-reserved-left` / `--ff-host-reserved-right` on `root`;
 * every side inset in the shell takes the larger of that and the safe area,
 * so no HUD cell or dialog sits under the host's tab. Standalone both are 0.
 */
export function trackHostReserved(hosting: Pick<Hosting, "hostReserved" | "onHostReserved">, root: HTMLElement): () => void {
  const apply = (reserved: HostReserved): void => {
    root.style.setProperty("--ff-host-reserved-left", `${reserved.left}px`);
    root.style.setProperty("--ff-host-reserved-right", `${reserved.right}px`);
  };
  apply(hosting.hostReserved());
  return hosting.onHostReserved(apply);
}
