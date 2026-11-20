import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStudioSplash, studioSplash, STUDIO_LOGO_WAIT_MS, STUDIO_SPLASH_MS } from "../../../../apps/client/src/features/boot/studio-splash";
import { LOGO_URL } from "../../../../apps/client/src/features/kit/brand";
import { browserTimers } from "../../../../apps/client/src/lib/load-meter";

const shown = (overlay: HTMLElement): HTMLElement | null => overlay.querySelector<HTMLElement>('[data-testid="studio-splash"]');
/** The logo arriving: jsdom loads no images, so the test says when. */
const logoArrives = (overlay: HTMLElement): void => {
  overlay.querySelector("img")?.dispatchEvent(new Event("load"));
};

describe("the studio's screen", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    resetStudioSplash();
    overlay = document.createElement("div");
    document.body.append(overlay);
  });
  afterEach(() => {
    overlay.remove();
    vi.useRealTimers();
  });

  it("shows the SNEKPRTY logo, centred, for three seconds, then goes", async () => {
    const gate = studioSplash(overlay, browserTimers, () => false);
    logoArrives(overlay);
    const screen = shown(overlay);
    expect(screen).not.toBeNull();
    expect(screen?.querySelector("img")?.getAttribute("src")).toBe(LOGO_URL);
    expect(screen?.querySelector("img")?.getAttribute("alt")).toBe("SNEKPRTY");
    expect(screen?.getAttribute("data-still")).toBe("false");
    await vi.advanceTimersByTimeAsync(STUDIO_SPLASH_MS - 1);
    expect(shown(overlay)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await gate.done;
    expect(shown(overlay)).toBeNull();
    expect(STUDIO_SPLASH_MS).toBe(3000);
  });

  it("is over at once for a key press and for a touch", async () => {
    const first = studioSplash(overlay, browserTimers, () => false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await first.done;
    expect(shown(overlay)).toBeNull();

    resetStudioSplash();
    const second = studioSplash(overlay, browserTimers, () => false);
    window.dispatchEvent(new Event("pointerdown"));
    await second.done;
    expect(shown(overlay)).toBeNull();
  });

  it("shows once per launch", async () => {
    const first = studioSplash(overlay, browserTimers, () => false);
    logoArrives(overlay);
    await vi.advanceTimersByTimeAsync(STUDIO_SPLASH_MS);
    await first.done;
    const again = studioSplash(overlay, browserTimers, () => false);
    expect(shown(overlay)).toBeNull();
    await again.done;
  });

  it("is still, with no fade, where the player asked for less movement", () => {
    const gate = studioSplash(overlay, browserTimers, () => true);
    expect(shown(overlay)?.getAttribute("data-still")).toBe("true");
    gate.cancel();
  });

  it("can be cancelled twice without harm", async () => {
    const gate = studioSplash(overlay, browserTimers, () => false);
    gate.cancel();
    gate.cancel();
    await gate.done;
    expect(shown(overlay)).toBeNull();
  });

  it("counts the three seconds from the logo's arrival, so a slow link never shows plain white", async () => {
    const gate = studioSplash(overlay, browserTimers, () => false);
    expect(shown(overlay)?.getAttribute("data-loaded")).toBeNull();
    await vi.advanceTimersByTimeAsync(STUDIO_SPLASH_MS + 1_000);
    expect(shown(overlay), "still up, waiting for the logo").not.toBeNull();
    logoArrives(overlay);
    expect(shown(overlay)?.getAttribute("data-loaded")).toBe("true");
    await vi.advanceTimersByTimeAsync(STUDIO_SPLASH_MS - 1);
    expect(shown(overlay)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await gate.done;
    expect(shown(overlay)).toBeNull();
  });

  it("goes at once when the logo cannot load, and never waits for ever", async () => {
    const broken = studioSplash(overlay, browserTimers, () => false);
    overlay.querySelector("img")?.dispatchEvent(new Event("error"));
    await broken.done;
    expect(shown(overlay)).toBeNull();

    resetStudioSplash();
    const silent = studioSplash(overlay, browserTimers, () => false);
    await vi.advanceTimersByTimeAsync(STUDIO_LOGO_WAIT_MS - 1);
    expect(shown(overlay)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await silent.done;
    expect(shown(overlay)).toBeNull();
  });
});

// Owner, 2026-11-19: the studio's mark is at most 220 px, 55% of the width and 40% of the height.
describe("the studio's logo size", () => {
  it("is capped in the stylesheet at 220 px, 55vw and 40vh", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/boot/StudioSplash.svelte"), "utf8");
    expect(/\.ff-studio__logo\s*\{[^}]*width:\s*min\(220px, 55vw, 40vh\)/.exec(source)).not.toBeNull();
  });
});
