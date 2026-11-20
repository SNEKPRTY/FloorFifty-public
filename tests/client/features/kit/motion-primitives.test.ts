/**
 * The primitives phase 6 adds to `features/kit/motion.ts` (polish spec §5.1). Each one
 * settles in its final state, and at once under reduced motion.
 *
 * GSAP's ticker does not run under jsdom, so these assert what was set and
 * which tweens were created, never a frame partway through.
 */

import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_MS,
  PANEL_IN,
  SCREEN_FADE_MS,
  fadeIn,
  fadeOut,
  flip,
  pageIn,
  pageOut,
  hoverLift,
  pressDown,
  pressThrough,
  pressUp,
  pulse,
  riseIn,
  rollDigits,
} from "../../../../apps/client/src/features/kit/motion";
import ConfirmHarness from "../../support/ConfirmHarness.svelte";
import { setReducedMotion } from "../../support/motion";

const element = (tag = "button"): HTMLElement => document.body.appendChild(document.createElement(tag));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("press", () => {
  it("steps 1 px down on press", () => {
    const node = element();
    pressDown(node);
    expect(gsap.getProperty(node, "y")).toBe(1);
  });

  it("springs on release: from 1 px past rest back to rest, on whole pixels, in steps", () => {
    const node = element();
    pressDown(node);
    pressUp(node);
    const [tween] = gsap.getTweensOf(node);
    expect(tween).toBeDefined();
    expect(tween!.vars["y"]).toBe(0);
    expect(tween!.vars["roundProps"]).toBe("y");
    expect(String(tween!.vars["ease"])).toMatch(/^steps\(/);
    expect(gsap.getProperty(node, "y")).toBe(-1);
  });

  it("plays both steps at once for an activation with no pointer", () => {
    const node = element();
    pressThrough(node);
    const [tween] = gsap.getTweensOf(node);
    expect(tween).toBeDefined();
    expect(gsap.getProperty(node, "y")).toBe(1);
    expect(tween!.vars["y"]).toBe(0);
  });

  it("clears only the press when it settles, keeping a control's own inline styles", () => {
    const node = element();
    node.style.display = "inline-grid";
    pressDown(node);
    pressUp(node);
    gsap.getTweensOf(node).at(-1)!.progress(1);
    expect(node.style.display).toBe("inline-grid");
    pressThrough(node);
    gsap.getTweensOf(node).at(-1)!.progress(1);
    expect(node.style.display).toBe("inline-grid");
    expect(node.style.transform === "" || /translate\(0px, 0px\)|none/.test(node.style.transform)).toBe(true);
  });

  it("keeps an element's own custom properties when a rise settles (the results winner's land delay)", () => {
    setReducedMotion(true);
    const node = element("li");
    node.style.setProperty("--ff-land-delay", "960ms");
    riseIn(node);
    expect(node.style.getPropertyValue("--ff-land-delay")).toBe("960ms");
  });

  it("keeps a control's own inline styles when a release settles under reduced motion", () => {
    setReducedMotion(true);
    const node = element();
    node.style.display = "inline-grid";
    pressUp(node);
    expect(node.style.display).toBe("inline-grid");
  });

  it("does nothing under reduced motion", () => {
    setReducedMotion(true);
    const node = element();
    pressDown(node);
    pressThrough(node);
    expect(gsap.getTweensOf(node)).toHaveLength(0);
    expect(node.style.transform).toBe("");
  });
});

describe("hover", () => {
  it("lifts 1 px and comes back, on whole pixels", () => {
    const node = element();
    hoverLift(node, true);
    expect(gsap.getTweensOf(node)[0]!.vars["y"]).toBe(-1);
    hoverLift(node, false);
    expect(gsap.getTweensOf(node).at(-1)!.vars["y"]).toBe(0);
  });

  it("does nothing under reduced motion", () => {
    setReducedMotion(true);
    const node = element();
    hoverLift(node, true);
    expect(gsap.getTweensOf(node)).toHaveLength(0);
  });
});

describe("pulse", () => {
  it("takes the scale it is asked for", () => {
    const node = element();
    pulse(node, 1.08);
    expect(gsap.getTweensOf(node)[0]!.vars["scale"]).toBe(1.08);
  });
});

describe("rollDigits", () => {
  it("keeps a space as wide as a space, so Survival's \"Floor 7 · out 0:07.60\" does not run together", () => {
    const node = element("span");
    const action = rollDigits(node, "Floor 0 · out 0:00.00");
    action.update("Floor 7 · out 0:07.60");
    const spaces = [...node.children].filter((cell) => cell.textContent === " ") as HTMLElement[];
    expect(spaces).toHaveLength(4);
    // An inline-block holding only a space collapses to nothing.
    for (const cell of spaces) expect(cell.style.whiteSpace).toBe("pre");
    action.destroy();
  });

  it("shows the new value at once, rolling only the digits that changed", () => {
    const node = element("span");
    const action = rollDigits(node, "19");
    expect(node.textContent).toBe("19");
    action.update("20");
    expect(node.textContent).toBe("20");
    expect(node.querySelectorAll("[data-rolling='true']")).toHaveLength(2);
    action.update("21");
    expect(node.querySelectorAll("[data-rolling='true']")).toHaveLength(1);
    action.destroy();
  });

  it("rolls a digit in from below, on whole pixels, in steps", () => {
    const node = element("span");
    const action = rollDigits(node, "07");
    action.update("08");
    const cell = node.querySelector<HTMLElement>("[data-rolling='true']")!;
    const [tween] = gsap.getTweensOf(cell);
    expect(tween!.vars["roundProps"]).toBe("y");
    expect(String(tween!.vars["ease"])).toMatch(/^steps\(/);
    action.destroy();
  });

  it("does nothing when the value is unchanged", () => {
    const node = element("span");
    const action = rollDigits(node, "07");
    action.update("07");
    expect(node.querySelectorAll("[data-rolling]")).toHaveLength(0);
    action.destroy();
  });

  it("swaps the digit under reduced motion", () => {
    setReducedMotion(true);
    const node = element("span");
    const action = rollDigits(node, "07");
    action.update("09");
    expect(node.textContent).toBe("09");
    expect(node.children).toHaveLength(0);
    action.destroy();
  });
});

describe("confirm", () => {
  it("shows the confirmation for 1.2 s (polish spec §5.1)", () => {
    expect(CONFIRM_MS).toBe(1_200);
  });

  it("keeps the control's width: both labels share one grid cell, and the inactive one is hidden", () => {
    const host = element("div");
    const component = mount(ConfirmHarness, { target: host, props: { active: false } });
    flushSync();
    const button = host.querySelector("button")!;
    expect(button.style.display).toBe("inline-grid");
    const cells = [...button.querySelectorAll<HTMLElement>("[data-confirm-label]")];
    expect(cells.map((cell) => cell.style.gridArea)).toEqual(["1 / 1", "1 / 1"]);
    const visibility = () => Object.fromEntries(cells.map((cell) => [cell.dataset["confirmLabel"], cell.style.visibility]));
    expect(visibility()).toEqual({ idle: "visible", done: "hidden" });
    unmount(component);
  });

  it("swaps to the confirmation, stepping it in, and back when active changes", () => {
    const host = element("div");
    const component = mount(ConfirmHarness, { target: host, props: { active: false } });
    flushSync();
    const cells = [...host.querySelectorAll<HTMLElement>("[data-confirm-label]")];
    const done = cells.find((cell) => cell.dataset["confirmLabel"] === "done")!;
    const idle = cells.find((cell) => cell.dataset["confirmLabel"] === "idle")!;
    const toggle = host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!;
    expect(gsap.getTweensOf(done)).toHaveLength(0);

    toggle.click();
    flushSync();
    expect([done.style.visibility, idle.style.visibility]).toEqual(["visible", "hidden"]);
    const [stepIn] = gsap.getTweensOf(done);
    expect(stepIn, "the confirmation steps in").toBeDefined();
    expect(stepIn!.vars["roundProps"]).toBe("y");

    toggle.click();
    flushSync();
    expect([done.style.visibility, idle.style.visibility]).toEqual(["hidden", "visible"]);
    expect(gsap.getTweensOf(idle), "the label it replaced returns without a step").toHaveLength(0);
    unmount(component);
  });

  it("swaps without stepping under reduced motion", () => {
    setReducedMotion(true);
    const host = element("div");
    const component = mount(ConfirmHarness, { target: host, props: { active: false } });
    flushSync();
    host.querySelector<HTMLButtonElement>("[data-testid='toggle']")!.click();
    flushSync();
    const done = host.querySelector<HTMLElement>("[data-confirm-label='done']")!;
    expect(done.style.visibility).toBe("visible");
    expect(gsap.getTweensOf(done)).toHaveLength(0);
    unmount(component);
  });
});

describe("flip", () => {
  const from = new DOMRect(0, 0, 10, 10);
  const to = new DOMRect(0, 40, 10, 10);

  it("steps from where an item stood to where it stands, on whole pixels", () => {
    const config = flip(element("li"), { from, to });
    expect(config.duration).toBeGreaterThan(0);
    expect(config.css!(0, 1)).toContain("translate(0px, -40px)");
    expect(config.css!(1, 0)).toContain("translate(0px, 0px)");
    expect(config.css!(0.07, 0.93)).toContain("translate(0px, -40px)");
  });

  it("is instant for an item that did not move, and under reduced motion", () => {
    expect(flip(element("li"), { from, to: from }).duration).toBe(0);
    setReducedMotion(true);
    expect(flip(element("li"), { from, to }).duration).toBe(0);
  });
});

describe("the menus' quiet motion", () => {
  it("slides a panel in 8 px over 150 ms", () => {
    expect(PANEL_IN).toEqual({ distance: 8, ms: 150 });
    const node = element("div");
    riseIn(node);
    const [tween] = gsap.getTweensOf(node);
    expect(tween!.vars["y"]).toBe(8);
    expect(tween!.vars["duration"]).toBeCloseTo(0.15);
  });

  it("cross-fades a screen change over 200 ms, with nothing sliding", () => {
    expect(SCREEN_FADE_MS).toBe(200);
    const node = element("div");
    for (const config of [fadeIn(node), fadeOut(node), pageIn(node, { direction: 1 }), pageOut(node, { direction: 1 })]) {
      expect(config.duration).toBe(200);
      expect(config.css!(0.5, 0.5)).toBe("opacity: 0.5");
    }
  });

  it("no transition under reduced motion", () => {
    setReducedMotion(true);
    const node = element("div");
    riseIn(node);
    expect(gsap.getTweensOf(node)).toHaveLength(0);
    for (const config of [fadeIn(node), fadeOut(node), pageIn(node, { direction: 1 }), pageOut(node, { direction: 1 })]) {
      expect(config.duration).toBe(0);
    }
  });
});
