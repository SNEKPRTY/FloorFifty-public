/**
 * The order of one frame's render passes, stated once.
 *
 * Every pass shares the application's ticker, so the order within a frame is
 * the order of priorities, highest first. The application's own render runs
 * at `UPDATE_PRIORITY.LOW`, after all of these:
 *
 * 1. `inputPoll` -- the controller is read, so a press reaches this frame's
 *    sample rather than the next one's.
 * 2. `gameplayDraw` -- the race moves its scenery and sprites to this frame.
 * 3. `backdrop` -- bounded scenery targets render what the race just drew.
 * 4. `composite` -- the world target renders, so the letterbox sprite is
 *    never a frame behind.
 *
 * And one pass after it: `record`, at `UPDATE_PRIORITY.UTILITY`, copies the
 * frame the application just rendered into the race's recording, in the same
 * task, while the WebGL drawing buffer still holds it (unlockables spec §6.1).
 *
 * A pass registered at the default priority (0) would run *after* the
 * backdrop and the composite, and they would show the previous frame's world
 * (Aquarian spec §5). Registering through `addRenderPass` makes that
 * impossible to write by accident.
 */

import type { Ticker } from "pixi.js";

export const RENDER_PRIORITY = { inputPoll: 300, gameplayDraw: 200, backdrop: 110, composite: 100, record: -50 } as const;

/** Adds `fn` at `pass`'s priority and returns the function that removes it. */
export function addRenderPass(
  ticker: Ticker,
  pass: keyof typeof RENDER_PRIORITY,
  fn: () => void,
): () => void {
  ticker.add(fn, undefined, RENDER_PRIORITY[pass]);
  return () => {
    ticker.remove(fn);
  };
}
