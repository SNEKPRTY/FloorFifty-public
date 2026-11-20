import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PANEL_IN, STAGGER } from "../../../../apps/client/src/features/kit/motion";
import KitHarness from "../../support/KitHarness.svelte";
import { setReducedMotion } from "../../support/motion";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function show(panel: Record<string, unknown> = {}, piece: "panel" | "toast" = "panel") {
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(KitHarness, { target: host, props: { piece, panel } });
  flushSync();
  return { host, component, node: () => host.querySelector<HTMLElement>("[data-testid='piece']") };
}

describe("Panel", () => {
  it("is the glass rule and nothing else", () => {
    const { node, component } = show();
    expect(node()!.classList.contains("ff-aquarian-panel")).toBe(true);
    expect(node()!.getAttribute("style") ?? "").not.toMatch(/background|backdrop/);
    unmount(component);
    const hud = show({ tone: "hud" });
    expect(hud.node()!.classList.contains("ff-aq-hud")).toBe(true);
    expect(hud.node()!.classList.contains("ff-aquarian-panel")).toBe(false);
    unmount(hud.component);
  });

  it("takes the element it is asked for, and a caller's class and attributes", () => {
    const { node, component } = show({ as: "section", class: "mine", role: "dialog" });
    expect(node()!.tagName).toBe("SECTION");
    expect(node()!.classList.contains("mine")).toBe(true);
    expect(node()!.getAttribute("role")).toBe("dialog");
    unmount(component);
  });

  it("rises in by the stylesheet's keyframe, staggered by its order, and never by a tween on the panel", () => {
    const { node, component } = show({ order: 2 });
    expect(node()!.classList.contains("ff-panel-arrive")).toBe(true);
    expect(node()!.style.getPropertyValue("--ff-panel-order")).toBe("2");
    // A GSAP tween left inline styles that kept Svelte's exit from finishing.
    expect(gsap.getTweensOf(node())).toHaveLength(0);
    unmount(component);
  });

  it("keeps a caller's own inline style beside the stagger slot", () => {
    const { node, component } = show({ style: "--ff-notice-layer: 5" });
    expect(node()!.style.getPropertyValue("--ff-notice-layer")).toBe("5");
    expect(node()!.style.getPropertyValue("--ff-panel-order")).toBe("0");
    unmount(component);
  });

  it("the keyframe is PANEL_IN: 8 px over 150 ms in eight steps, a stagger slot of STAGGER, and none under reduced motion", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/aquarian.css"), "utf8");
    expect(css).toMatch(new RegExp(`\\.ff-panel-arrive \\{\\s*animation: ff-panel-rise ${PANEL_IN.ms}ms steps\\(8\\) calc\\(var\\(--ff-panel-order, 0\\) \\* ${STAGGER * 1000}ms\\) both`));
    expect(css).toMatch(new RegExp(`@keyframes ff-panel-rise \\{\\s*from \\{\\s*opacity: 0;\\s*transform: translateY\\(${PANEL_IN.distance}px\\)`));
    expect(css).toMatch(/\.ff-panel-arrive--long \{\s*animation-duration: 300ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ff-panel-arrive \{\s*animation: none/);
  });

  it("rise-long adds the 300 ms the results screen keeps, and none adds no rise", () => {
    const long = show({ arrive: "rise-long" });
    expect(long.node()!.classList.contains("ff-panel-arrive--long")).toBe(true);
    unmount(long.component);
    const none = show({ arrive: "none" });
    expect(none.node()!.classList.contains("ff-panel-arrive")).toBe(false);
    unmount(none.component);
  });

  it("falls out, inert from its first exit frame", () => {
    const { host, node, component } = show();
    const panel = node()!;
    host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!.click();
    flushSync();
    // The outro runs on: it is still in the page, and nothing can reach it.
    expect(panel.isConnected).toBe(true);
    expect(panel.inert).toBe(true);
    unmount(component);
  });

  it("leaves at once under reduced motion, still inert from its first frame", () => {
    setReducedMotion(true);
    const { host, node, component } = show();
    const panel = node()!;
    host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!.click();
    flushSync();
    expect(panel.inert).toBe(true);
    unmount(component);
  });

  it("is gone from the page once its exit is done", async () => {
    const { host, node, component } = show();
    const panel = node()!;
    host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!.click();
    flushSync();
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 300));
    expect(panel.isConnected).toBe(false);
    unmount(component);
  });
});
