import { afterEach, describe, expect, it, vi } from "vitest";
import { trackLiveHandles, type LiveHandles } from "../../../../apps/client/src/features/render/live-handles";

let handles: LiveHandles | undefined;

afterEach(() => {
  handles?.release();
  handles = undefined;
  vi.useRealTimers();
});

describe("live timers and listeners (release readiness §9.3)", () => {
  it("counts a timeout until it fires or is cleared", () => {
    vi.useFakeTimers();
    handles = trackLiveHandles(window, true);
    const base = handles.timers();
    const fired = window.setTimeout(() => undefined, 10);
    const cleared = window.setTimeout(() => undefined, 10);
    expect(handles.timers()).toBe(base + 2);
    window.clearTimeout(cleared);
    expect(handles.timers()).toBe(base + 1);
    vi.advanceTimersByTime(10);
    expect(handles.timers()).toBe(base);
    expect(fired).toBeDefined();
  });

  it("counts an interval until it is cleared", () => {
    vi.useFakeTimers();
    handles = trackLiveHandles(window, true);
    const base = handles.timers();
    const interval = window.setInterval(() => undefined, 5);
    vi.advanceTimersByTime(20);
    expect(handles.timers()).toBe(base + 1);
    window.clearInterval(interval);
    expect(handles.timers()).toBe(base);
  });

  it("counts window and document listeners, and a duplicate add as one", () => {
    handles = trackLiveHandles(window, true);
    const base = handles.listeners();
    const onKey = (): void => undefined;
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onKey);
    expect(handles.listeners()).toBe(base + 2);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onKey);
    expect(handles.listeners()).toBe(base);
  });

  it("tells a capture listener from a bubbling one, as the DOM does", () => {
    handles = trackLiveHandles(window, true);
    const base = handles.listeners();
    const on = (): void => undefined;
    window.addEventListener("click", on, true);
    window.addEventListener("click", on);
    expect(handles.listeners()).toBe(base + 2);
    window.removeEventListener("click", on, { capture: true });
    window.removeEventListener("click", on);
    expect(handles.listeners()).toBe(base);
  });

  it("wraps nothing outside an inspection build", () => {
    const setTimeoutBefore = window.setTimeout;
    handles = trackLiveHandles(window, false);
    expect(window.setTimeout).toBe(setTimeoutBefore);
    expect(handles.timers()).toBe(0);
  });

  it("puts everything back on release", () => {
    const setTimeoutBefore = window.setTimeout;
    const addBefore = window.addEventListener;
    trackLiveHandles(window, true).release();
    expect(window.setTimeout).toBe(setTimeoutBefore);
    expect(window.addEventListener).toBe(addBefore);
  });
});
