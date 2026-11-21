import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import Instructions from "../../../../apps/client/src/features/lobby/Instructions.svelte";
import { INSTRUCTION_SLIDES, slideAfter } from "../../../../apps/client/src/features/lobby/instructions";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { fakeSettings } from "../../support/fakes/settings";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const prompts = JSON.parse(readFileSync("content/generated/content.json", "utf8")).content.story.prompts;

const cleanup: (() => void)[] = [];
beforeEach(() => {
  inputMethod.note("keyboard");
  inputMethod.family = "generic";
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.innerHTML = "";
});

function open(options: { artSrc?: (alias: string) => string | undefined } = {}) {
  const settings = fakeSettings();
  cleanup.push(installLocaleStrategy(settings, () => ["en"]));
  const closed: number[] = [];
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const target = document.createElement("div");
  document.body.append(target);
  const view = mount(Instructions, {
    target,
    props: { settings, prompts, artSrc: options.artSrc ?? ((alias: string) => `/assets/${alias}.webp`), onClose: () => closed.push(1) },
  });
  cleanup.push(() => void unmount(view));
  flushSync();
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const caption = () => q("instructions-caption")!.textContent!.trim();
  const slide = () => document.querySelector<HTMLElement>("[data-slide]")!.dataset["slide"]!;
  const click = (id: string) => {
    q(id)!.click();
    flushSync();
  };
  return { settings, closed, opener, q, caption, slide, click };
}

describe("the Instructions carousel (story-mode spec, criteria 19 and 20)", () => {
  it("has six slides in the order a player is taught them", () => {
    expect(INSTRUCTION_SLIDES.map((s) => s.id)).toEqual(["steer", "bounce", "dropFast", "movingFloors", "lava", "race"]);
  });

  it("has a picture for every slide, the race's included, in the shipped demos", () => {
    // Live showed the race slide with no picture (Owner, 2026-11-20): every slide's clip and still must be a row.
    const manifest = JSON.parse(readFileSync("packages/asset-contract/assets/art-manifest.json", "utf8"));
    const shipped = new Set((manifest.bundles.demos as { alias: string }[]).map((row) => row.alias));
    for (const slide of INSTRUCTION_SLIDES) expect([slide.clip, slide.still].filter((alias) => !shipped.has(alias)), slide.id).toEqual([]);
  });

  it("never steps past either end", () => {
    expect(slideAfter(0, -1)).toBe(0);
    expect(slideAfter(5, 1)).toBe(5);
    expect(slideAfter(2, 1)).toBe(3);
  });

  it("opens on the first slide and counts as having been shown how", () => {
    const view = open();
    expect(view.slide()).toBe("steer");
    expect(view.settings.value.seen.tutorial).toBe(true);
    expect(view.q("instructions-back")!.hasAttribute("disabled")).toBe(true);
  });

  it("walks forward with Next and back with Back, and Done closes on the last slide", () => {
    const view = open();
    const seen: string[] = [view.slide()];
    for (let step = 0; step < 5; step += 1) {
      view.click("instructions-next");
      seen.push(view.slide());
    }
    expect(seen).toEqual(INSTRUCTION_SLIDES.map((s) => s.id));
    expect(view.q("instructions-next")!.textContent).toContain(m.instructions_done());
    expect(view.closed).toEqual([]);
    view.click("instructions-back");
    expect(view.slide()).toBe("lava");
    view.click("instructions-next");
    view.click("instructions-next");
    expect(view.closed).toEqual([1]);
  });

  it("jumps with the dots and steers with the pad's left and right", () => {
    const view = open();
    const dots = document.querySelectorAll<HTMLElement>('[data-testid="instructions-dot"]');
    expect(dots.length).toBe(6);
    dots[3]!.click();
    flushSync();
    expect(view.slide()).toBe("movingFloors");
    // Offered from the focused Next, which sits outside the carousel group, as FocusNavigator does.
    const focused = document.querySelector('[data-testid="instructions-next"]')!;
    const steer = (direction: string) => {
      focused.dispatchEvent(new CustomEvent("ff-steer", { detail: { direction }, bubbles: true, cancelable: true }));
      flushSync();
    };
    steer("right");
    expect(view.slide()).toBe("lava");
    steer("left");
    steer("left");
    expect(view.slide()).toBe("dropFast");
    for (let i = 0; i < 3; i += 1) steer("left");
    expect(view.slide()).toBe("steer");
    steer("up");
    expect(view.slide()).toBe("steer");
  });

  it("names the control in hand on slides 1 and 3, and changes with the hand", () => {
    const view = open();
    const keyboard = view.caption();
    expect(keyboard).not.toBe("");
    inputMethod.note("touch");
    flushSync();
    const touch = view.caption();
    expect(touch).not.toBe(keyboard);
    inputMethod.noteGamepad("xbox");
    flushSync();
    expect(view.caption()).not.toBe(touch);
    // The third slide's words follow the same hand.
    document.querySelectorAll<HTMLElement>('[data-testid="instructions-dot"]')[2]!.click();
    flushSync();
    expect(view.slide()).toBe("dropFast");
    expect(view.caption()).not.toBe("");
  });

  it("gives slides 2, 4, 5 and 6 the same words whatever the hand", () => {
    const view = open();
    document.querySelectorAll<HTMLElement>('[data-testid="instructions-dot"]')[1]!.click();
    flushSync();
    expect(view.caption()).toBe(m.instructions_caption_bounce());
    inputMethod.note("touch");
    flushSync();
    expect(view.caption()).toBe(m.instructions_caption_bounce());
  });

  it("offers the still to a player who asks for less motion", () => {
    open();
    const source = document.querySelector<HTMLSourceElement>('source[media="(prefers-reduced-motion: reduce)"]');
    expect(source?.getAttribute("srcset")).toBe("/assets/demo.steerStill.webp");
    expect(document.querySelector<HTMLImageElement>('[data-testid="instructions-image"]')!.getAttribute("src")).toBe("/assets/demo.steer.webp");
  });

  it("keeps the caption when a clip cannot be had", () => {
    const view = open({ artSrc: () => undefined });
    expect(view.q("instructions-image")).toBeNull();
    expect(view.caption()).not.toBe("");
    view.click("instructions-next");
    expect(view.caption()).toBe(m.instructions_caption_bounce());
  });

  it("falls back to the still, then to the words, when a clip fails to load", () => {
    const view = open();
    const image = () => document.querySelector<HTMLImageElement>('[data-testid="instructions-image"]');
    image()!.dispatchEvent(new Event("error"));
    flushSync();
    expect(image()!.getAttribute("src")).toBe("/assets/demo.steerStill.webp");
    image()!.dispatchEvent(new Event("error"));
    flushSync();
    expect(image()).toBeNull();
    expect(view.caption()).not.toBe("");
  });
});
