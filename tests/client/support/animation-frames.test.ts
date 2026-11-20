/**
 * Animation frames under fake timers.
 *
 * jsdom starts its 60 Hz frame loop with whatever `setInterval` is global when
 * the first frame is asked for, and only starts it while none is outstanding.
 * Pixi and Svelte keep jsdom's own `requestAnimationFrame`, so one asked for
 * while a test has fake timers on put the loop on the fake clock: once real
 * timers came back it never ticked again, and every later frame in that file
 * waited forever (the splash's real-timer tests, intermittently, on CI).
 */

import { expect, it, vi } from "vitest";

const frameWithin = (ms: number): Promise<string> =>
  Promise.race([
    new Promise<string>((resolve) => requestAnimationFrame(() => resolve("fired"))),
    new Promise<string>((resolve) => setTimeout(() => resolve(`no frame in ${ms}ms`), ms)),
  ]);

it("still draws frames after one was asked for under fake timers", async () => {
  const kept = window.requestAnimationFrame.bind(window);
  vi.useFakeTimers();
  kept(() => {});
  vi.useRealTimers();

  expect(await frameWithin(500)).toBe("fired");
});
