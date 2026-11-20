import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActionBar from "../../../../../apps/client/src/features/kit/layout/ActionBar.svelte";
import type { BarAction } from "../../../../../apps/client/src/features/kit/layout/action-bar";
import { installFakeResizeObserver } from "../../../support/resize-observer";

let component: ReturnType<typeof mount> | undefined;
let fake: ReturnType<typeof installFakeResizeObserver>;
beforeEach(() => {
  fake = installFakeResizeObserver();
});
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  fake.restore();
});

const actions = (onSelect = vi.fn()): BarAction[] => [
  { id: "race-again", label: "Race again", kind: "primary", onSelect },
  { id: "watch-replay", label: "Watch replay", shortLabel: "Replay", kind: "secondary", onSelect },
  { id: "return-to-menu", label: "Return to menu", shortLabel: "Menu", kind: "secondary", onSelect },
];

function open(widths: [number, number, number], list = actions()) {
  let available = 0;
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(ActionBar, {
    target: host,
    props: { actions: list, testId: "results-actions", measure: () => ({ available, widths }) },
  });
  flushSync();
  const bar = host.querySelector<HTMLElement>('[data-testid="results-actions"]')!;
  return {
    bar,
    resize(width: number) {
      available = width;
      fake.resize(width);
      flushSync();
    },
  };
}

describe("ActionBar (UI layout system §5)", () => {
  it("is one row of every action, in full, until it has been measured", () => {
    const { bar } = open([500, 450, 400]);
    expect(bar.hasAttribute("data-action-bar")).toBe(true);
    expect(bar.dataset["collapse"]).toBe("0");
    const visible = bar.querySelector('[data-row="visible"]')!;
    expect([...visible.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "Race again",
      "Watch replay",
      "Return to menu",
    ]);
  });

  it("gives way in order: secondaries take their short label before it ever wraps", () => {
    const { bar, resize } = open([500, 500, 400]);
    resize(420);
    expect(bar.dataset["collapse"]).toBe("2");
    const visible = bar.querySelector('[data-row="visible"]')!;
    expect(visible.querySelector('[data-testid="race-again"]')?.textContent?.trim()).toBe("Race again");
    expect(visible.querySelector('[data-testid="watch-replay"]')?.textContent?.trim()).toBe("Replay");
    expect(visible.querySelector('[data-testid="return-to-menu"]')?.textContent?.trim()).toBe("Menu");
    // The full words stay with assistive technology.
    expect(visible.querySelector('[data-testid="watch-replay"]')?.getAttribute("aria-label")).toBe("Watch replay");
  });

  it("names each visible button's kind and short label, for the screens' tests (Task 4)", () => {
    const { bar } = open([500, 450, 400]);
    const visible = bar.querySelector('[data-row="visible"]')!;
    expect(visible.querySelector('[data-testid="race-again"]')?.getAttribute("data-kind")).toBe("primary");
    expect(visible.querySelector('[data-testid="race-again"]')?.hasAttribute("data-short-label")).toBe(false);
    expect(visible.querySelector('[data-testid="watch-replay"]')?.getAttribute("data-kind")).toBe("secondary");
    expect(visible.querySelector('[data-testid="watch-replay"]')?.getAttribute("data-short-label")).toBe("Replay");
  });

  it("wraps only as a last resort", () => {
    const { bar, resize } = open([500, 450, 400]);
    resize(300);
    expect(bar.dataset["collapse"]).toBe("3");
  });

  it("says a toggle's state, a pad guard and its sound on the visible button only", () => {
    const list: BarAction[] = [
      { id: "quick-fullscreen", label: "Fullscreen", kind: "utility", pressed: false, padGuard: true, onSelect: vi.fn() },
      { id: "ready-toggle", label: "Ready", kind: "primary", sfx: "ready", onSelect: vi.fn() },
    ];
    const { bar } = open([300, 300, 300], list);
    const fullscreen = bar.querySelector('[data-row="visible"] [data-testid="quick-fullscreen"]')!;
    expect(fullscreen.getAttribute("aria-pressed")).toBe("false");
    expect(fullscreen.hasAttribute("data-pad-guard")).toBe(true);
    expect(bar.querySelector('[data-row="visible"] [data-testid="ready-toggle"]')!.getAttribute("data-sfx")).toBe("ready");
    expect(bar.querySelector('[data-row="visible"] [data-testid="ready-toggle"]')!.hasAttribute("aria-pressed")).toBe(false);
  });

  it("hands the click to the action", () => {
    const onSelect = vi.fn();
    const { bar } = open([500, 450, 400], actions(onSelect));
    bar.querySelector<HTMLButtonElement>('[data-row="visible"] [data-testid="watch-replay"]')!.click();
    expect(onSelect.mock.calls[0]![0]).toBeInstanceOf(MouseEvent);
  });

  it("selects through the visible row, and the measuring rows are inert", () => {
    const onSelect = vi.fn();
    const { bar } = open([500, 450, 400], actions(onSelect));
    bar.querySelector<HTMLButtonElement>('[data-row="visible"] [data-testid="race-again"]')!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const box = bar.querySelector("[data-measures]")!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.hasAttribute("inert")).toBe(true);
    expect(box.querySelectorAll("[data-measure]")).toHaveLength(3);
    for (const measure of bar.querySelectorAll("[data-measure]")) {
      expect(measure.closest("[data-measures]")).toBe(box);
      expect(measure.getAttribute("aria-hidden")).toBe("true");
      expect(measure.hasAttribute("inert")).toBe(true);
      expect(measure.querySelector("[data-testid]")).toBeNull();
    }
  });
});
