import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuickActions from "../../../../apps/client/src/features/lobby/QuickActions.svelte";

let component: ReturnType<typeof mount> | undefined;
let fullscreenElement: Element | null = null;

beforeEach(() => {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  document.documentElement.requestFullscreen = vi.fn(async () => {
    fullscreenElement = document.documentElement;
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
  });
});

afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  fullscreenElement = null;
  document.body.innerHTML = "";
});

describe("the Full screen quick action", () => {
  it("is guarded against a pad confirm it did not earn, and lets go of focus once pressed", async () => {
    component = mount(QuickActions, { target: document.body, props: { onContact: () => {}, onHomeScreen: () => {} } });
    flushSync();
    const button = document.querySelector<HTMLButtonElement>('[data-testid="quick-fullscreen"]')!;
    expect(button.hasAttribute("data-pad-guard")).toBe(true);

    button.focus();
    button.click();
    await vi.waitFor(() => expect(fullscreenElement).not.toBeNull());
    await vi.waitFor(() => expect(document.activeElement).not.toBe(button));
  });

  it("labels Full screen in two words, and leaves Mute to the corner", () => {
    component = mount(QuickActions, { target: document.body, props: { onContact: () => {}, onHomeScreen: () => {} } });
    flushSync();
    expect(document.querySelector('[data-testid="quick-fullscreen"]')!.textContent).toContain("Full screen");
    expect(document.querySelector('[data-testid="quick-mute"]')).toBeNull();
    expect(document.querySelector("[data-action-bar]")).not.toBeNull();
  });
});
