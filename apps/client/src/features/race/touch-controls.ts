/**
 * Touch controls.
 *
 * Three fixed buttons on the safe lower edge. They feed the same `InputManager`
 * the keyboard does, so neither scheme can drift from the other.
 *
 * Multi-touch is the whole difficulty here, and it lives in `PointerLatch`
 * below rather than in the component that draws the buttons. A player holds
 * left with one thumb and taps fast-fall with the other, so each action tracks
 * its own set of active pointer ids and only releases when its last one lifts.
 *
 * Splitting it this way is deliberate: the view moved to Svelte, the bookkeeping
 * did not, and `features/platform/input.ts` is untouched. Only the element producing the
 * events changed, so the existing multi-touch coverage keeps its meaning.
 *
 * The buttons are sticky, as mobile action games' are: a thumb that lands
 * just outside one still presses the nearest within `STICKY_MARGIN_PX`, and a
 * held thumb that slides onto another button moves to it. One that slides
 * off everything keeps what it holds until it lifts.
 */

import { flushSync, mount, unmount } from "svelte";
import { MIN_TOUCH_TARGET_PX } from "../../lib/constants";
import type { InputAction } from "../platform/input";
import TouchControlsView from "./TouchControls.svelte";

export type TouchAction = Extract<InputAction, "left" | "right" | "fastFall">;

export type TouchInputListener = (action: TouchAction, active: boolean) => void;

const ACTIONS: readonly TouchAction[] = ["left", "right", "fastFall"];

/** How far outside a button a thumb still counts for it, in CSS pixels. */
export const STICKY_MARGIN_PX = 24;

export type TouchTarget = Readonly<{
  action: TouchAction;
  rect: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}>;

/**
 * The button a point is on, or else the nearest within the margin, or
 * nothing. Distance is to the button's edge, so any point inside is 0.
 */
export function nearestTarget(
  x: number,
  y: number,
  targets: readonly TouchTarget[],
  margin = STICKY_MARGIN_PX,
): TouchAction | undefined {
  let best: TouchAction | undefined;
  let bestDistance = margin;
  for (const { action, rect } of targets) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      best = action;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Which button each finger is on, over the latch.
 *
 * A finger owns one button at a time. Moving onto another releases the first
 * and presses the second; moving onto nothing keeps what it owns.
 */
export class StickyPointers {
  private readonly owned = new Map<number, TouchAction>();

  constructor(private readonly latch: PointerLatch) {}

  down(pointerId: number, action: TouchAction | undefined): boolean {
    if (action === undefined) return false;
    this.owned.set(pointerId, action);
    this.latch.press(action, pointerId);
    return true;
  }

  move(pointerId: number, action: TouchAction | undefined): void {
    const current = this.owned.get(pointerId);
    if (current === undefined || action === undefined || action === current) return;
    this.latch.release(current, pointerId);
    this.owned.set(pointerId, action);
    this.latch.press(action, pointerId);
  }

  up(pointerId: number): void {
    const current = this.owned.get(pointerId);
    if (current === undefined) return;
    this.owned.delete(pointerId);
    this.latch.release(current, pointerId);
  }

  releaseAll(): void {
    this.owned.clear();
    this.latch.releaseAll();
  }
}

/** True when the primary input is a finger rather than a mouse. */
export function prefersTouchControls(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Which pointers are currently down on which action.
 *
 * Reports only real state changes: a second finger landing on a button that is
 * already held produces nothing, and lifting it produces nothing either. The
 * action ends when the last pointer on it lifts.
 */
export class PointerLatch {
  private readonly active = new Map<TouchAction, Set<number>>();

  constructor(private readonly onInput: TouchInputListener) {
    for (const action of ACTIONS) this.active.set(action, new Set());
  }

  /** True while any pointer holds the action; what the pressed style reads. */
  isHeld(action: TouchAction): boolean {
    return (this.active.get(action)?.size ?? 0) > 0;
  }

  press(action: TouchAction, pointerId: number): void {
    this.set(action, pointerId, true);
  }

  release(action: TouchAction, pointerId: number): void {
    this.set(action, pointerId, false);
  }

  /** Releases everything still held, reporting each one exactly once. */
  releaseAll(): void {
    for (const [action, pointers] of this.active) {
      if (pointers.size === 0) continue;
      pointers.clear();
      this.onInput(action, false);
    }
  }

  private set(action: TouchAction, pointerId: number, down: boolean): void {
    const pointers = this.active.get(action);
    if (pointers === undefined) return;

    const wasActive = pointers.size > 0;
    if (down) pointers.add(pointerId);
    else pointers.delete(pointerId);
    const isActive = pointers.size > 0;

    if (wasActive !== isActive) this.onInput(action, isActive);
  }
}

/**
 * The controls, as something a screen owns.
 *
 * `features/race/gameplay.ts` creates and destroys this the way it does everything
 * else it owns, so the seam stays a class even though the view is a component.
 */
export class TouchControls {
  private readonly latch: PointerLatch;
  private readonly pointers: StickyPointers;
  private app: Record<string, unknown> | undefined;

  constructor(onInput: TouchInputListener) {
    this.latch = new PointerLatch(onInput);
    this.pointers = new StickyPointers(this.latch);
  }

  get isMounted(): boolean {
    return this.app !== undefined;
  }

  /** Builds the controls into `parent` and begins listening. */
  mount(parent: HTMLElement): void {
    if (this.app !== undefined) return;
    this.app = mount(TouchControlsView, { target: parent, props: { latch: this.latch, pointers: this.pointers } });
    // Svelte builds the elements synchronously but runs actions in a deferred
    // effect, and the listener that blocks page gestures is an action. Without
    // this, `mount()` would return before the controls could swallow a drag --
    // a real gap on the first touch, not only in a test.
    flushSync();
  }

  /** Drives a button from a test or from a synthetic event source. */
  pointerDown(action: TouchAction, pointerId: number): void {
    this.latch.press(action, pointerId);
  }

  pointerUp(action: TouchAction, pointerId: number): void {
    this.latch.release(action, pointerId);
  }

  /** The minimum edge length every control must meet, in CSS pixels. */
  static get minimumTargetPx(): number {
    return MIN_TOUCH_TARGET_PX;
  }

  unmount(): void {
    // Releasing on teardown stops a player who left mid-press from being held
    // in that direction by a screen that no longer exists.
    this.pointers.releaseAll();
    if (this.app === undefined) return;
    void unmount(this.app);
    this.app = undefined;
  }
}
