/**
 * Puts the game's sound to sleep while nobody can see it.
 *
 * Locking a phone left the stage music playing. A hidden page is the signal
 * every browser gives for that, a backgrounded tab and a switched-away app
 * alike; `pagehide` and `freeze` cover the browsers that pause a page without
 * reporting it hidden first. The render loop needs nothing here: browsers
 * already stop animation frames for a hidden page.
 *
 * A window that only loses focus stays awake. The page is still in view --
 * a second monitor, a chat app over the corner -- and an online race goes on
 * whether the player is clicked into it or not, so its sound does too.
 *
 * Every gesture also asks the sound to come back from an interruption the
 * page was never told about: a call or Siri on a phone suspends the graph
 * while the page stays visible, and only a gesture may resume it.
 */

import type { Hosting } from "../ruken/host";

export type Sleeper = {
  sleep(): Promise<void>;
  wake(): Promise<void>;
  /** Resumes a graph the system suspended; see `AudioEngine.resumeOnGesture`. */
  resumeOnGesture?(): Promise<void>;
};

/** The events a browser may count as the gesture that lets sound resume. */
const GESTURES = ["pointerup", "touchend", "keydown"] as const;

export function sleepWhenHidden(doc: Document, sleeper: Sleeper, win: Window = window): () => void {
  const sleep = (): void => void sleeper.sleep().catch(() => undefined);
  const wake = (): void => void sleeper.wake().catch(() => undefined);
  const onVisibility = (): void => (doc.visibilityState === "hidden" ? sleep() : wake());
  const onGesture = (): void => void sleeper.resumeOnGesture?.().catch(() => undefined);

  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("freeze", sleep);
  doc.addEventListener("resume", onVisibility);
  win.addEventListener("pagehide", sleep);
  win.addEventListener("pageshow", onVisibility);
  // Capture, so a control that stops propagation still counts as the gesture.
  for (const type of GESTURES) win.addEventListener(type, onGesture, true);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    doc.removeEventListener("freeze", sleep);
    doc.removeEventListener("resume", onVisibility);
    win.removeEventListener("pagehide", sleep);
    win.removeEventListener("pageshow", onVisibility);
    for (const type of GESTURES) win.removeEventListener(type, onGesture, true);
  };
}

/**
 * Inside Ruken, the host also says when the game is out of sight (P6 §4):
 * its page hidden, or the game hidden behind it. Only "hidden" sleeps: the
 * host's drawer or an overlay leaves the race in view, and the race goes on.
 * Back to "active" wakes. Standalone the hosting never reports a change.
 */
export function sleepOnHostLifecycle(
  hosting: Pick<Hosting, "onLifecycle">,
  sleeper: Pick<Sleeper, "sleep" | "wake">,
): () => void {
  return hosting.onLifecycle((lifecycle) => {
    if (lifecycle.state === "active") void sleeper.wake().catch(() => undefined);
    else if (lifecycle.reasons.includes("hidden")) void sleeper.sleep().catch(() => undefined);
  });
}
