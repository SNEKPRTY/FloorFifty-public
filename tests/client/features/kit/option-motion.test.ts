import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import OptionHarness from "../../support/OptionHarness.svelte";
import { installFakeResizeObserver } from "../../support/resize-observer";

afterEach(() => document.body.replaceChildren());

function open() {
  installFakeResizeObserver();
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(OptionHarness, { target: host });
  flushSync();
  return { host, component };
}

describe("picking an option", () => {
  it("swaps the selected state and then plays one pulse on the picked option", () => {
    const { host, component } = open();
    const picked = host.querySelector<HTMLButtonElement>("[data-testid='floors-50']")!;
    expect(gsap.getTweensOf(picked)).toHaveLength(0);
    picked.click();
    flushSync();
    expect(picked.dataset["selected"]).toBe("true");
    const tweens = gsap.getTweensOf(picked);
    expect(tweens).toHaveLength(1);
    // A scale, never a colour.
    expect(Object.keys(tweens[0]!.vars)).toContain("scale");
    expect(Object.keys(tweens[0]!.vars).join()).not.toMatch(/color|background/i);
    // The one it replaced does not pulse.
    expect(gsap.getTweensOf(host.querySelector("[data-testid='floors-20']"))).toHaveLength(0);
    unmount(component);
  });
});

describe("the pager's dots", () => {
  it("one lit marker steps to the current page, so the dots show position", () => {
    const { host, component } = open();
    const pill = host.querySelector<HTMLElement>(".ff-pager__pill")!;
    expect(host.querySelector(".ff-pager__marker")).not.toBeNull();
    expect(pill.style.getPropertyValue("--ff-pager-at")).toBe("0");
    host.querySelectorAll<HTMLButtonElement>("[data-testid='dot']")[3]!.click();
    flushSync();
    expect(pill.style.getPropertyValue("--ff-pager-at")).toBe("3");
    expect(host.querySelectorAll("[data-testid='dot']")[3]!.getAttribute("aria-current")).toBe("true");
    unmount(component);
  });
});
