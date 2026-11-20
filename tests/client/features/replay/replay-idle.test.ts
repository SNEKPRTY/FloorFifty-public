/**
 * The replay bar's idle timer (ui layout spec §4.5): the bar hides after
 * 2.5 s without input, any input brings it back, and while held (paused,
 * scrubbing, the end card) it never hides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPLAY_IDLE_MS, createIdleTimer } from "../../../../apps/client/src/features/replay/replay-idle";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the replay idle timer", () => {
  it("is 2.5 s", () => {
    expect(REPLAY_IDLE_MS).toBe(2500);
  });

  it("goes idle after the delay and reports it once", () => {
    const onChange = vi.fn();
    const timer = createIdleTimer(REPLAY_IDLE_MS, onChange);
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(2499);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(timer.idle).toBe(true);
    expect(onChange.mock.calls).toEqual([[true]]);
    timer.dispose();
  });

  it("wakes on a poke and starts the delay again", () => {
    const onChange = vi.fn();
    const timer = createIdleTimer(REPLAY_IDLE_MS, onChange);
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    timer.poke();
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(2000);
    timer.poke();
    vi.advanceTimersByTime(2000);
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(500);
    expect(timer.idle).toBe(true);
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
    timer.dispose();
  });

  it("never goes idle while held, and counts again from release", () => {
    const timer = createIdleTimer(REPLAY_IDLE_MS, () => {});
    vi.advanceTimersByTime(REPLAY_IDLE_MS);
    timer.hold(true);
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(REPLAY_IDLE_MS * 4);
    expect(timer.idle).toBe(false);
    timer.hold(false);
    vi.advanceTimersByTime(REPLAY_IDLE_MS - 1);
    expect(timer.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timer.idle).toBe(true);
    timer.dispose();
  });

  it("does nothing after dispose", () => {
    const onChange = vi.fn();
    const timer = createIdleTimer(REPLAY_IDLE_MS, onChange);
    timer.dispose();
    vi.advanceTimersByTime(REPLAY_IDLE_MS * 2);
    timer.poke();
    expect(onChange).not.toHaveBeenCalled();
  });
});
