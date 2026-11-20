import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";
import Countdown from "../../../../apps/client/src/features/race/Countdown.svelte";
import type { CountLabel } from "../../../../apps/client/src/features/race/countdown-clock";

const SOURCE = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/race/Countdown.svelte"), "utf8");

function render(label: CountLabel | undefined) {
  const target = document.createElement("div");
  const component = mount(Countdown, { target, props: { label } });
  flushSync();
  return { target, destroy: () => unmount(component) };
}

describe("Countdown", () => {
  it("shows the number, hidden from assistive tech (the live region says Go)", () => {
    const view = render("2");
    const count = view.target.querySelector('[data-testid="race-count"]')!;
    expect(count.textContent?.trim()).toBe("2");
    expect(count.getAttribute("aria-hidden")).toBe("true");
    view.destroy();
  });

  it("shows nothing between counts", () => {
    const view = render(undefined);
    expect(view.target.querySelector('[data-testid="race-count"]')).toBeNull();
    view.destroy();
  });

  it("marks GO for its burst", () => {
    const view = render("GO");
    expect(view.target.querySelector('[data-testid="race-count"]')!.getAttribute("data-count")).toBe("GO");
    view.destroy();
  });

  it("swaps in place under reduced motion", () => {
    expect(SOURCE).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
