import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenFade } from "../../../../apps/client/src/features/kit/screen-fade";
import { SCREEN_FADE_MS } from "../../../../apps/client/src/features/kit/motion";

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
}

describe("screenFade", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function endOpacity(root: HTMLElement) {
    const event = new Event("transitionend");
    Object.assign(event, { propertyName: "opacity" });
    root.dispatchEvent(event);
  }

  it("is inert from the first frame and stays out until the fade has actually ended", async () => {
    setReducedMotion(false);
    const root = document.createElement("div");
    document.body.append(root);
    const port = screenFade(root);
    let done = false;
    const out = port.out().then(() => (done = true));
    expect(root.inert).toBe(true);
    expect(root.style.transition).toContain(`${SCREEN_FADE_MS / 2}ms`);
    await vi.advanceTimersByTimeAsync(SCREEN_FADE_MS * 2);
    expect(done).toBe(false);
    endOpacity(root);
    await out;
    expect(done).toBe(true);
    expect(root.style.opacity).toBe("0");
  });

  it("ignores another property's transition end and carries on after the backup time", async () => {
    setReducedMotion(false);
    const root = document.createElement("div");
    document.body.append(root);
    const port = screenFade(root);
    let done = false;
    const out = port.out().then(() => (done = true));
    const other = new Event("transitionend");
    Object.assign(other, { propertyName: "transform" });
    root.dispatchEvent(other);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await out;
    expect(done).toBe(true);
  });

  it("clears inert at once on in() and fades back over the other half", async () => {
    setReducedMotion(false);
    const root = document.createElement("div");
    document.body.append(root);
    const port = screenFade(root);
    const out = port.out();
    endOpacity(root);
    await out;
    port.in();
    expect(root.inert).toBe(false);
    expect(root.style.opacity).toBe("1");
    expect(root.style.transition).toContain(`${SCREEN_FADE_MS / 2}ms`);
    await vi.advanceTimersByTimeAsync(SCREEN_FADE_MS / 2);
    expect(root.style.transition).toBe("");
  });

  it("lands at once under reduced motion", async () => {
    setReducedMotion(true);
    const root = document.createElement("div");
    document.body.append(root);
    const port = screenFade(root);
    await port.out();
    expect(root.style.opacity).toBe("0");
    port.in();
    expect(root.style.opacity).toBe("1");
    expect(root.inert).toBe(false);
    expect(root.style.transition).toBe("");
  });
});
