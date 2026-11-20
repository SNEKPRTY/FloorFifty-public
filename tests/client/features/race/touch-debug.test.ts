import { describe, expect, it } from "vitest";
import { readTouchDebug, startTouchDebug, StrokeLog } from "../../../../apps/client/src/features/race/touch-debug";

// Debugging the iPad's slam swipe inside Ruken (2026-10-10): the flick needs 40 px down
// within 180 ms, so the log reports, per finger, how many moves arrived, the biggest gap
// between them, and the fastest 180 ms drop seen.
describe("touch debug", () => {
  it("is on with ?touchdebug or the build flag, and off otherwise", () => {
    expect(readTouchDebug("?touchdebug", undefined)).toBe(true);
    expect(readTouchDebug("", "1")).toBe(true);
    expect(readTouchDebug("", undefined)).toBe(false);
    expect(readTouchDebug("?audiodebug", "")).toBe(false);
  });

  it("summarises a finger's stroke: moves, largest gap and the best 180 ms drop", () => {
    const log = new StrokeLog();
    log.down(1, 100, 0);
    log.move(1, 110, 16);
    log.move(1, 130, 32);
    log.move(1, 150, 120);
    expect(log.up(1, 140)).toEqual({ id: 1, moves: 3, durationMs: 140, largestGapMs: 88, bestDropPx: 50 });
  });

  it("forgets a finger the browser cancelled, and says so", () => {
    const log = new StrokeLog();
    log.down(7, 0, 0);
    expect(log.cancel(7, 30)).toEqual({ id: 7, moves: 0, durationMs: 30, largestGapMs: 30, bestDropPx: 0 });
    expect(log.up(7, 40)).toBeUndefined();
  });
});

// Second round (2026-10-10): the panel did not show on the Owner's iPad, and one screenshot has to
// answer as much as possible. So the panel names its build, and logs each finger twice: once from
// pointer events (what the swipe uses today, with every coalesced sample WebKit batched into one
// move) and once from touch events (a possible fallback if WebKit cancels the pointer).
describe("touch debug panel", () => {
  const fire = (win: Window, type: string, props: Record<string, unknown>): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
    win.dispatchEvent(event);
  };
  const touch = (identifier: number, clientY: number) => ({ identifier, clientY });

  it("names its build on the first line", () => {
    const panel = startTouchDebug(window, "build-abc");
    expect(panel.text()).toContain("build build-abc");
    panel.stop();
  });

  it("measures a pointer's drop from its coalesced samples, not only the move events", () => {
    const panel = startTouchDebug(window, "b");
    fire(window, "pointerdown", { pointerId: 3, pointerType: "touch", clientY: 100, timeStamp: 0 });
    // One move event that carries the whole flick in its coalesced samples.
    fire(window, "pointermove", {
      pointerId: 3,
      clientY: 150,
      timeStamp: 60,
      getCoalescedEvents: () => [
        { clientY: 120, timeStamp: 20 },
        { clientY: 140, timeStamp: 40 },
        { clientY: 150, timeStamp: 60 },
      ],
    });
    fire(window, "pointerup", { pointerId: 3, pointerType: "touch", clientY: 150, timeStamp: 70 });
    expect(panel.text()).toMatch(/pointerup #3 .*moves=1 samples=3 .*bestDrop180ms=50px/);
    panel.stop();
  });

  it("logs each finger from touch events too, so a cancelled pointer still shows the finger's drop", () => {
    const panel = startTouchDebug(window, "b");
    fire(window, "touchstart", { touches: [touch(9, 100)], changedTouches: [touch(9, 100)], timeStamp: 0 });
    fire(window, "touchmove", { touches: [touch(9, 130)], changedTouches: [touch(9, 130)], timeStamp: 30 });
    fire(window, "touchmove", { touches: [touch(9, 160)], changedTouches: [touch(9, 160)], timeStamp: 60 });
    fire(window, "touchend", { touches: [], changedTouches: [touch(9, 160)], timeStamp: 80 });
    expect(panel.text()).toMatch(/touchend #9 moves=2 .*bestDrop180ms=60px/);
    panel.stop();
  });
});
