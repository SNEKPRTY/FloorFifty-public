/**
 * A race HUD element popping on a spring (Wonder spec §4.2): knocked to its
 * pop scale, it settles back to 1 through the spring's own overshoot, drawn on
 * scale steps of 1/32. The race's, not the menus': the chrome keeps its stepped
 * tweens (`motion.ts`).
 */

import type { SpringTuning } from "@floor-fifty/shared/content/game-content";
import { SecondOrder, snapTo } from "../../lib/second-order";

/** When to run the next frame; `requestAnimationFrame` in the page. */
export type FrameClock = {
  readonly schedule: (callback: (nowMs: number) => void) => number;
  readonly cancel: (handle: number) => void;
};

const PAGE_CLOCK: FrameClock = {
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const SCALE_STEP = 1 / 32;

type Running = { readonly spring: SecondOrder; handle: number | undefined; lastMs: number | undefined };
const running = new WeakMap<HTMLElement, Running>();

/**
 * Pops `node` to `scale` and lets its spring settle it. A pop on a node still
 * settling re-knocks it, never past `scale`. Returns a stop that leaves the
 * node at rest.
 */
export function springPop(node: HTMLElement, scale: number, spring: SpringTuning, clock: FrameClock = PAGE_CLOCK): () => void {
  let run = running.get(node);
  if (run === undefined) {
    run = { spring: new SecondOrder(spring), handle: undefined, lastMs: undefined };
    running.set(node, run);
  }
  const current = run;
  current.spring.retune(spring);
  current.spring.lift(scale - 1);
  draw(node, current.spring.value);

  const stop = (): void => {
    if (current.handle !== undefined) clock.cancel(current.handle);
    current.handle = undefined;
    current.lastMs = undefined;
    current.spring.set(0);
    node.style.transform = "";
    running.delete(node);
  };

  const frame = (nowMs: number): void => {
    current.handle = undefined;
    const dtSeconds = current.lastMs === undefined ? 1 / 60 : (nowMs - current.lastMs) / 1_000;
    current.lastMs = nowMs;
    current.spring.update(dtSeconds, 0);
    if (current.spring.settled) {
      stop();
      return;
    }
    draw(node, current.spring.value);
    current.handle = clock.schedule(frame);
  };
  if (current.handle === undefined) current.handle = clock.schedule(frame);
  return stop;
}

function draw(node: HTMLElement, offset: number): void {
  node.style.transform = `scale(${snapTo(1 + offset, SCALE_STEP)})`;
}
