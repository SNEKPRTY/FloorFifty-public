/**
 * When the controller is read.
 *
 * The pad is read in the render ticker's `inputPoll` pass, first in each
 * frame, so a press reaches that frame's race sample (`render-order.ts`). A
 * ticker capped below the display rate, as a software renderer's is at one
 * frame a second (`software-renderer.ts`), would read it that rarely: a tap
 * shorter than a second, and every menu step, could fall between two reads.
 * So a capped ticker's poll also runs on every animation frame. An uncapped
 * ticker already runs on every animation frame, and is left exactly as it was.
 */

import { RENDER_PRIORITY } from "./render-order";

/** The part of Pixi's `Ticker` the poll needs. */
export type PollTicker = {
  readonly maxFPS: number;
  add(fn: () => void, context?: unknown, priority?: number): unknown;
  remove(fn: () => void): unknown;
};

/** Animation frames; the browser's by default. */
export type PollFrames = { request(fn: () => void): number; cancel(id: number): void };

const BROWSER_FRAMES: PollFrames = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (id) => cancelAnimationFrame(id),
};

/** Runs `poll` as described above, and returns the function that stops it. */
export function scheduleInputPoll(ticker: PollTicker, poll: () => void, frames: PollFrames = BROWSER_FRAMES): () => void {
  ticker.add(poll, undefined, RENDER_PRIORITY.inputPoll);
  let frame: number | undefined;
  if (ticker.maxFPS > 0) {
    const everyFrame = (): void => {
      poll();
      frame = frames.request(everyFrame);
    };
    frame = frames.request(everyFrame);
  }
  return () => {
    ticker.remove(poll);
    if (frame !== undefined) frames.cancel(frame);
    frame = undefined;
  };
}
