import { describe, expect, it, vi } from "vitest";
import { PadTrace, padTraceEnabled } from "../../../../apps/client/src/features/app/pad-trace";

describe("the pad trace", () => {
  it("keeps the last sixteen events, with what had focus", () => {
    document.body.innerHTML = `<button data-testid="quick-fullscreen">FS</button>`;
    document.querySelector<HTMLElement>("button")!.focus();
    const trace = new PadTrace();
    for (let i = 0; i < 20; i += 1) trace.record(`down`, i);
    trace.record("confirm", 20);
    const recent = trace.recent();
    expect(recent).toHaveLength(16);
    expect(recent.at(-1)).toEqual({ at: 20, event: "confirm", target: "quick-fullscreen" });
  });

  it("logs the recent events whenever fullscreen changes, until detached", () => {
    const trace = new PadTrace();
    trace.record("confirm", 1);
    const log = vi.fn();
    const detach = trace.attach(document, log);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(log).toHaveBeenCalledWith("[ff:pad]", "left fullscreen", [expect.objectContaining({ event: "confirm" })]);
    detach();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(log).toHaveBeenCalledOnce();
  });

  // Debug output is for dev and inspection builds only (release readiness
  // D-G8): a production player cannot turn it on from the address bar.
  it("is on only where inspection is, whatever the address says", () => {
    expect(padTraceEnabled(false)).toBe(false);
    expect(padTraceEnabled(true)).toBe(true);
  });
});
