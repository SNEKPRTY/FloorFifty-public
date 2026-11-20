/**
 * When the replay's bar steps aside (ui layout spec §4.5).
 *
 * The bar is over the race it controls, so after a moment without input it
 * hides and gives the race back the screen; any tap, key or pointer move
 * brings it back. While the replay is paused, scrubbed or held on its end
 * card the bar is what the player is using, so it is held in view.
 *
 * Plain timers and a callback, so it is tested with fake timers and the
 * view owns the DOM.
 */

import * as m from "../../paraglide/messages.js";
import type { InputMethod } from "../platform/input-method.svelte";

/** How long without input before the bar hides. */
export const REPLAY_IDLE_MS = 2500;

/**
 * How long the hint stays that says how to bring the bar back. It is said the
 * first time the bar steps aside in a visit, and not again: a tap anywhere
 * waking a hidden bar is a convention, but nothing on screen says so.
 */
export const REPLAY_HINT_MS = 3000;

/** The hint, in the player's hand: a controller's buttons arrive as keys, so they wake it too. */
export function replayHintText(method: InputMethod): string {
  if (method === "touch") return m.replay_hint_touch();
  if (method === "gamepad") return m.replay_hint_gamepad();
  return m.replay_hint_pointer();
}

export interface IdleTimer {
  /** Input arrived: show the bar, and count again. */
  poke(): void;
  /** While held, the bar stays; released, the count starts again. */
  hold(held: boolean): void;
  readonly idle: boolean;
  dispose(): void;
}

export function createIdleTimer(ms: number, onChange: (idle: boolean) => void): IdleTimer {
  let idle = false;
  let held = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: boolean): void => {
    if (next === idle) return;
    idle = next;
    onChange(next);
  };
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const start = (): void => {
    stop();
    if (disposed || held) return;
    timer = setTimeout(() => {
      timer = undefined;
      set(true);
    }, ms);
  };

  start();
  return {
    poke() {
      if (disposed) return;
      set(false);
      start();
    },
    hold(next) {
      if (disposed || next === held) return;
      held = next;
      if (held) {
        stop();
        set(false);
      } else {
        start();
      }
    },
    get idle() {
      return idle;
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
