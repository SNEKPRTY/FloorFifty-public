import { afterEach, describe, expect, it, vi } from "vitest";
import { observeHeight, observeWidth } from "../../../../apps/client/src/lib/observe-size";
import { installFakeResizeObserver } from "../../support/resize-observer";

let fake: ReturnType<typeof installFakeResizeObserver> | undefined;
afterEach(() => {
  fake?.restore();
  fake = undefined;
});

describe("the size listeners", () => {
  it("reports a node's height as it changes, and stops when released", () => {
    fake = installFakeResizeObserver();
    const heights: number[] = [];
    const stop = observeHeight(document.createElement("div"), (height) => heights.push(height));
    fake.resize(300, 568);
    fake.resize(300, 320);
    expect(heights).toEqual([568, 320]);
    stop();
    fake.resize(300, 100);
    expect(heights).toEqual([568, 320]);
  });

  it("still reports width", () => {
    fake = installFakeResizeObserver();
    const listener = vi.fn();
    observeWidth(document.createElement("div"), listener);
    fake.resize(420, 10);
    expect(listener).toHaveBeenCalledWith(420);
  });

  it("is a no-op where ResizeObserver is missing", () => {
    const previous = globalThis.ResizeObserver;
    // @ts-expect-error -- jsdom has none, and a test may have installed a fake
    delete globalThis.ResizeObserver;
    expect(() => observeHeight(document.createElement("div"), () => {})()).not.toThrow();
    globalThis.ResizeObserver = previous;
  });
});
