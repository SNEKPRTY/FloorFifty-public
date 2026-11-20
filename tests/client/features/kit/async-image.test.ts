/**
 * The image loader (async loaders spec): a toned frame, a ring after 200 ms,
 * a fade-in once decoded, and nothing at all for an image already cached.
 */

import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AsyncImageHost from "../../support/AsyncImageHost.svelte";

let component: ReturnType<typeof mount> | undefined;
let cached = false;
/** When set, only these srcs read as already cached. */
let cachedSrcs: Set<string> | undefined;
const original = {
  complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
  naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
};

beforeEach(() => {
  cached = false;
  cachedSrcs = undefined;
  // jsdom never fetches an image, so whether one is "already there" is the test's to say.
  const isCached = (img: HTMLImageElement) => (cachedSrcs === undefined ? cached : cachedSrcs.has(img.getAttribute("src") ?? ""));
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get(this: HTMLImageElement) { return isCached(this); } });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get(this: HTMLImageElement) { return isCached(this) ? 64 : 0; } });
});

afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  Object.defineProperty(HTMLImageElement.prototype, "complete", original.complete);
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", original.naturalWidth);
});

/** Lets the load handler's decode chain resolve, then renders. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  flushSync();
}

function render(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(AsyncImageHost, { target: host, props: { first: "/assets/a.png", ...props } });
  flushSync();
  const frame = () => host.querySelector<HTMLElement>(".ff-async")!;
  const img = () => host.querySelector<HTMLImageElement>('[data-testid="image"]');
  const ring = () => host.querySelector(".ff-async__ring");
  return { host, frame, img, ring };
}

/** Fails the first request and every retry, waiting out each retry's delay. */
async function failEveryRequest(img: () => HTMLImageElement | null): Promise<void> {
  for (let request = 0; request < 4; request += 1) {
    img()!.dispatchEvent(new Event("error"));
    await settle();
    vi.advanceTimersByTime(2000);
    flushSync();
  }
}

describe("AsyncImage", () => {
  it("starts pending, toned, with the image in place but no ring yet", () => {
    const { frame, img, ring } = render();
    expect(frame().dataset["load"]).toBe("pending");
    expect(frame().dataset["tone"]).toBe("fill");
    expect(frame().classList.contains("host-frame")).toBe(true);
    expect(img()!.getAttribute("src")).toBe("/assets/a.png");
    expect(img()!.getAttribute("alt")).toBe("");
    expect(ring()).toBeNull();
  });

  it("shows the ring once the image has been pending for 200 ms", () => {
    vi.useFakeTimers();
    const { ring } = render();
    vi.advanceTimersByTime(199);
    flushSync();
    expect(ring()).toBeNull();
    vi.advanceTimersByTime(1);
    flushSync();
    expect(ring()).not.toBeNull();
    expect(ring()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("never shows the ring with ring={false}", () => {
    vi.useFakeTimers();
    const { ring } = render({ ring: false });
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(ring()).toBeNull();
  });

  it("is loaded once the image loads, and the ring goes", async () => {
    vi.useFakeTimers();
    const { frame, img, ring } = render();
    vi.advanceTimersByTime(200);
    flushSync();
    expect(ring()).not.toBeNull();
    img()!.dispatchEvent(new Event("load"));
    await settle();
    expect(frame().dataset["load"]).toBe("loaded");
    expect(frame().hasAttribute("data-instant")).toBe(false);
    expect(ring()).toBeNull();
  });

  it("never shows the ring for a load before the delay", async () => {
    vi.useFakeTimers();
    const { frame, img, ring } = render();
    vi.advanceTimersByTime(100);
    img()!.dispatchEvent(new Event("load"));
    await settle();
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(frame().dataset["load"]).toBe("loaded");
    expect(ring()).toBeNull();
  });

  it("goes straight to loaded for an image already cached, with no fade", () => {
    cached = true;
    const { frame, ring } = render();
    expect(frame().dataset["load"]).toBe("loaded");
    expect(frame().hasAttribute("data-instant")).toBe(true);
    expect(ring()).toBeNull();
  });

  it("retries a failed request on a URL of its own, still pending with the ring, and shows the retry", async () => {
    vi.useFakeTimers();
    const { frame, img, ring } = render();
    vi.advanceTimersByTime(200);
    img()!.dispatchEvent(new Event("error"));
    await settle();
    expect(frame().dataset["load"]).toBe("pending");
    expect(ring()).not.toBeNull();
    vi.advanceTimersByTime(250);
    flushSync();
    expect(img()!.getAttribute("src")).toBe("/assets/a.png?retry=1");
    img()!.dispatchEvent(new Event("load"));
    await settle();
    expect(frame().dataset["load"]).toBe("loaded");
  });

  it("is failed once every retry has failed, keeps its tone, and stops the ring", async () => {
    vi.useFakeTimers();
    const { frame, img, ring } = render();
    vi.advanceTimersByTime(200);
    await failEveryRequest(img);
    expect(img()!.getAttribute("src")).toBe("/assets/a.png?retry=3");
    expect(frame().dataset["load"]).toBe("failed");
    expect(ring()).toBeNull();
  });

  it("drops a pending retry when the src changes", async () => {
    vi.useFakeTimers();
    const { frame, img, host } = render({ second: "/assets/b.png" });
    img()!.dispatchEvent(new Event("error"));
    await settle();
    host.querySelector<HTMLButtonElement>('[data-testid="swap"]')!.click();
    flushSync();
    vi.advanceTimersByTime(2000);
    flushSync();
    expect(img()!.getAttribute("src")).toBe("/assets/b.png");
    expect(frame().dataset["load"]).toBe("pending");
  });

  it("renders the fallback in place of a failed image, and stays failed", async () => {
    const fallback = createRawSnippet(() => ({ render: () => `<span data-testid="fallback">Moving On</span>` }));
    vi.useFakeTimers();
    const { frame, img, host } = render({ fallback });
    await failEveryRequest(img);
    expect(frame().dataset["load"]).toBe("failed");
    expect(img()).toBeNull();
    expect(host.querySelector('[data-testid="fallback"]')!.textContent).toBe("Moving On");
  });

  it("resets to pending on a new src", async () => {
    const { frame, img, host } = render({ second: "/assets/b.png" });
    img()!.dispatchEvent(new Event("load"));
    await settle();
    expect(frame().dataset["load"]).toBe("loaded");
    host.querySelector<HTMLButtonElement>('[data-testid="swap"]')!.click();
    flushSync();
    expect(img()!.getAttribute("src")).toBe("/assets/b.png");
    expect(frame().dataset["load"]).toBe("pending");
  });

  it("ignores a stale load from the src it had before", async () => {
    const { frame, img, host } = render({ second: "/assets/b.png" });
    const stale = img()!;
    let resolveDecode: () => void = () => {};
    stale.decode = () => new Promise<void>((resolve) => (resolveDecode = resolve));
    stale.dispatchEvent(new Event("load"));
    host.querySelector<HTMLButtonElement>('[data-testid="swap"]')!.click();
    flushSync();
    resolveDecode();
    await settle();
    expect(frame().dataset["load"]).toBe("pending");
  });

  it("leaves the frame clear with tone none", () => {
    const { frame } = render({ tone: "none" });
    expect(frame().dataset["tone"]).toBe("none");
  });
  it("reads a new src's own cache, not the image it replaced", () => {
    cachedSrcs = new Set(["/assets/a.png"]);
    const { frame, host } = render({ second: "/assets/b.png" });
    expect(frame().dataset["load"]).toBe("loaded");
    host.querySelector<HTMLButtonElement>('[data-testid="swap"]')!.click();
    flushSync();
    expect(frame().dataset["load"]).toBe("pending");
    expect(frame().hasAttribute("data-instant")).toBe(false);
  });

  it("ignores a late error from the src it had before", async () => {
    const { frame, img, host } = render({ second: "/assets/b.png" });
    const stale = img()!;
    host.querySelector<HTMLButtonElement>('[data-testid="swap"]')!.click();
    flushSync();
    stale.dispatchEvent(new Event("error"));
    await settle();
    expect(frame().dataset["load"]).toBe("pending");
  });

  it("never shows the ring for an image that loaded before the delay but decodes after it", async () => {
    vi.useFakeTimers();
    const { frame, img, ring } = render();
    let resolveDecode: () => void = () => {};
    img()!.decode = () => new Promise<void>((resolve) => (resolveDecode = resolve));
    vi.advanceTimersByTime(190);
    img()!.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(60);
    flushSync();
    expect(ring()).toBeNull();
    resolveDecode();
    await settle();
    expect(frame().dataset["load"]).toBe("loaded");
  });
});
