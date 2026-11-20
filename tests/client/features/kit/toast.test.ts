import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import KitHarness from "../../support/KitHarness.svelte";

afterEach(() => document.body.replaceChildren());

describe("Toast", () => {
  it("is a glass HUD panel that says what happened", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const component = mount(KitHarness, { target: host, props: { piece: "toast" } });
    flushSync();
    const toast = host.querySelector<HTMLElement>("[data-testid='piece']")!;
    expect(toast.classList.contains("ff-aq-hud")).toBe(true);
    expect(toast.classList.contains("ff-toast")).toBe(true);
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toContain("Copied");
    unmount(component);
  });

  it("rises in and falls out", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const component = mount(KitHarness, { target: host, props: { piece: "toast" } });
    flushSync();
    const toast = host.querySelector<HTMLElement>("[data-testid='piece']")!;
    expect(toast.classList.contains("ff-panel-arrive")).toBe(true);
    host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!.click();
    flushSync();
    expect(toast.inert).toBe(true);
    unmount(component);
  });
});
