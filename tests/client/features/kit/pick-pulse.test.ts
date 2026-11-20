import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import PickPulseHarness from "../../support/PickPulseHarness.svelte";
import { setReducedMotion } from "../../support/motion";

afterEach(() => {
  setReducedMotion(false);
  document.body.replaceChildren();
});

function open() {
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(PickPulseHarness, { target: host });
  flushSync();
  const input = (id: string) => host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
  const pick = (id: string) => {
    const el = input(id);
    if (el.type === "range") el.dispatchEvent(new Event("change", { bubbles: true }));
    else el.click();
    flushSync();
  };
  return { host, component, input, pick };
}

describe("picking a setting", () => {
  it("pulses the row of the box ticked, in scale and never in colour", () => {
    const { input, pick, component } = open();
    const row = input("tick").closest("label")!;
    expect(gsap.getTweensOf(row)).toHaveLength(0);
    pick("tick");
    const tweens = gsap.getTweensOf(row);
    expect(tweens).toHaveLength(1);
    expect(Object.keys(tweens[0]!.vars)).toContain("scale");
    expect(Object.keys(tweens[0]!.vars).join()).not.toMatch(/color|background/i);
    unmount(component);
  });

  it("pulses the choice taken in a radio group, and not the one it replaced", () => {
    const { input, pick, component } = open();
    pick("low");
    expect(gsap.getTweensOf(input("low").closest("label"))).toHaveLength(1);
    expect(gsap.getTweensOf(input("high").closest("label"))).toHaveLength(0);
    unmount(component);
  });

  it("leaves a slider alone: it moves with the finger", () => {
    const { input, pick, component } = open();
    pick("level");
    expect(gsap.getTweensOf(input("level"))).toHaveLength(0);
    expect(gsap.getTweensOf(input("level").closest("label"))).toHaveLength(0);
    unmount(component);
  });

  it("lands at once under reduced motion: no tween at all", () => {
    setReducedMotion(true);
    const { input, pick, component } = open();
    pick("tick");
    expect(gsap.getTweensOf(input("tick").closest("label"))).toHaveLength(0);
    unmount(component);
  });

  it("stops listening when the group goes", () => {
    const { host, input, component } = open();
    const box = input("tick");
    unmount(component);
    host.append(box.closest("label")!);
    box.click();
    expect(gsap.getTweensOf(box.closest("label"))).toHaveLength(0);
  });
});
