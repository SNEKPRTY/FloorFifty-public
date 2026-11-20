import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { fadeIn, fadeOut } from "../../../../apps/client/src/features/kit/motion";
import { readClient } from "../../support/client-source";
import KitHarness from "../../support/KitHarness.svelte";

afterEach(() => document.body.replaceChildren());

function open() {
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(KitHarness, { target: host, props: { piece: "view" } });
  flushSync();
  return { host, component, swap: () => host.querySelector<HTMLButtonElement>("[data-testid='swap']")!.click() };
}

describe("ViewSwitch", () => {
  it("shows the one view it is given", () => {
    const { host, component } = open();
    expect(host.querySelector("[data-testid='view-menu']")).not.toBeNull();
    expect(host.querySelector("[data-testid='view-settings']")).toBeNull();
    unmount(component);
  });

  it("the new view takes input within 120 ms, and the old view cannot catch a press", () => {
    const { host, component, swap } = open();
    const started = performance.now();
    const old = host.querySelector<HTMLElement>("[data-testid='view-menu']")!;
    swap();
    flushSync();
    const next = host.querySelector<HTMLElement>("[data-testid='view-settings']")!;
    expect(next.parentElement!.inert).toBeFalsy();
    expect(performance.now() - started).toBeLessThan(120);
    // The exit does not block the arrival, and it is inert from its first frame.
    expect(old.isConnected).toBe(true);
    expect(old.parentElement!.inert).toBe(true);
    unmount(component);
  });

  it("changes by a 200 ms cross-fade with no slide in either tween", () => {
    const node = document.createElement("div");
    for (const config of [fadeIn(node), fadeOut(node)]) {
      expect(config.duration).toBe(200);
      expect(config.css!(0.5, 0.5)).toBe("opacity: 0.5");
      expect(config.css!(0.5, 0.5)).not.toMatch(/transform|translate/);
    }
    expect(readClient("ViewSwitch.svelte")).toMatch(/in:fadeIn out:fadeOut/);
  });
});
