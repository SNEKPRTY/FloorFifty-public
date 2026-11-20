/**
 * Swipe steering on screen (spec §3.1.3), mounted as `TouchControls` is.
 *
 * The same shape as `TouchControls` so gameplay can swap one for the other
 * when the player changes the touch mode mid-race. All of the gesture
 * bookkeeping is `SwipeTracker`'s; this owns only the component's life.
 */

import { flushSync, mount, unmount } from "svelte";
import SwipeSurface from "./SwipeSurface.svelte";
import { SwipeTracker, type SwipeAction } from "./swipe-tracker";
import { touchDebug } from "./touch-debug";

export class SwipeControls {
  private readonly tracker: SwipeTracker;
  private app: Record<string, unknown> | undefined;

  constructor(onInput: (action: SwipeAction, active: boolean) => void) {
    // Under touch diagnostics only, every action the swipe emits is logged too (see `touch-debug.ts`).
    const debug = touchDebug;
    this.tracker = new SwipeTracker(
      debug === undefined
        ? onInput
        : (action, active) => {
            if (active) debug.note(`swipe action: ${action}`);
            onInput(action, active);
          },
    );
  }

  get isMounted(): boolean {
    return this.app !== undefined;
  }

  /** Builds the surface into `parent` and begins listening. */
  mount(parent: HTMLElement): void {
    if (this.app !== undefined) return;
    this.app = mount(SwipeSurface, {
      target: parent,
      props: { tracker: this.tracker },
    });
    // As `TouchControls`: the page-gesture block is an action, which Svelte
    // runs in a deferred effect, so the first touch would otherwise miss it.
    flushSync();
  }

  unmount(): void {
    // Released first, so a player who left mid-drag is not held steering by a
    // screen that no longer exists.
    this.tracker.cancel();
    if (this.app === undefined) return;
    void unmount(this.app);
    this.app = undefined;
  }
}
