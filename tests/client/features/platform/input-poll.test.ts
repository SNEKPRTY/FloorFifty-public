// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scheduleInputPoll, type PollTicker } from "../../../../apps/client/src/features/platform/input-poll";

/** A ticker that runs its listeners only when told to, as a capped one does. */
function fakeTicker(maxFPS: number): PollTicker & { tick(): void; count(): number } {
  const listeners = new Set<() => void>();
  return {
    maxFPS,
    add: (fn) => void listeners.add(fn),
    remove: (fn) => void listeners.delete(fn),
    tick: () => listeners.forEach((fn) => fn()),
    count: () => listeners.size,
  };
}

/** Animation frames, run one at a time. */
function fakeFrames(): { request: (fn: () => void) => number; cancel: (id: number) => void; run(): void } {
  let queued = new Map<number, () => void>();
  let next = 1;
  return {
    request: (fn) => (queued.set(next, fn), next++),
    cancel: (id) => void queued.delete(id),
    run: () => {
      const now = queued;
      queued = new Map();
      now.forEach((fn) => fn());
    },
  };
}

describe("scheduleInputPoll", () => {
  it("polls with the render ticker, and only with it, when the ticker is not capped", () => {
    const ticker = fakeTicker(0);
    const frames = fakeFrames();
    let polls = 0;
    scheduleInputPoll(ticker, () => (polls += 1), frames);
    for (let index = 0; index < 5; index += 1) frames.run();
    expect(polls).toBe(0);
    ticker.tick();
    expect(polls).toBe(1);
  });

  it("polls on every animation frame when the ticker is capped, so a short pad press is not missed", () => {
    // A software renderer draws one frame a second; a tap held for one
    // animation frame would fall between two of its polls.
    const ticker = fakeTicker(1);
    const frames = fakeFrames();
    let polls = 0;
    scheduleInputPoll(ticker, () => (polls += 1), frames);
    for (let index = 0; index < 5; index += 1) frames.run();
    expect(polls).toBe(5);
  });

  it("stops both when released", () => {
    const ticker = fakeTicker(1);
    const frames = fakeFrames();
    let polls = 0;
    const release = scheduleInputPoll(ticker, () => (polls += 1), frames);
    release();
    frames.run();
    ticker.tick();
    expect(polls).toBe(0);
    expect(ticker.count()).toBe(0);
  });
});
