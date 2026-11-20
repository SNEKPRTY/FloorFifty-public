/**
 * Press and hover for every control, from one delegated listener (polish
 * spec §5.2), as `ui-sounds.ts` gives every control its sound.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installUiMotion } from "../../../../apps/client/src/features/kit/ui-motion";
import { setReducedMotion } from "../../support/motion";

function setUp(markup: string) {
  const root = document.body.appendChild(document.createElement("div"));
  root.innerHTML = markup;
  const release = installUiMotion(root);
  return { root, release };
}

const y = (element: Element): number => Number(gsap.getProperty(element, "y"));
const pointer = (type: string, pointerType = "mouse", pointerId = 1) => new PointerEvent(type, { bubbles: true, pointerType, pointerId });
const springing = (element: Element): boolean => gsap.getTweensOf(element).at(-1)?.vars["y"] === 0;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("installUiMotion", () => {
  it("springs each finger's own control: a second finger's press outlives the first's lift", () => {
    const { root, release } = setUp(`<button id="a">A</button><button id="b">B</button>`);
    const [a, b] = [root.querySelector("#a")!, root.querySelector("#b")!];
    a.dispatchEvent(pointer("pointerdown", "touch", 1));
    b.dispatchEvent(pointer("pointerdown", "touch", 2));
    a.dispatchEvent(pointer("pointerup", "touch", 1));
    expect(springing(a), "the first finger's control springs").toBe(true);
    expect(springing(b), "the second is still held").toBe(false);
    expect(y(b)).toBe(1);
    b.dispatchEvent(pointer("pointerup", "touch", 2));
    expect(springing(b)).toBe(true);
    release();
  });

  it("is opted out of by the race's touch buttons, which press themselves while held", () => {
    const touch = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/race/TouchControls.svelte"), "utf8");
    const at = touch.indexOf('class="ff-touch-button');
    const button = touch.slice(touch.lastIndexOf("<Panel", at), touch.indexOf(">", at));
    expect(button).toContain('data-motion="none"');
  });

  it("presses a control on pointer-down and springs it on release", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown"));
    expect(y(button)).toBe(1);
    button.dispatchEvent(pointer("pointerup"));
    expect(gsap.getTweensOf(button).at(-1)!.vars["y"]).toBe(0);
    release();
  });

  it("presses from a finger too", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown", "touch"));
    expect(y(button)).toBe(1);
    release();
  });

  it("springs a control that lost its pointer to a cancel", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown", "touch"));
    button.dispatchEvent(pointer("pointercancel", "touch"));
    expect(gsap.getTweensOf(button).at(-1)!.vars["y"]).toBe(0);
    release();
  });

  it("plays both steps at once for a click with no pointer (keyboard or pad)", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    // Asked of the tween rather than of the rendered value: GSAP may write a
    // from-value lazily, so the tween's own start is the claim.
    const [press] = gsap.getTweensOf(button);
    expect(press!.vars["startAt"]).toMatchObject({ y: 1 });
    expect(press!.vars["y"]).toBe(0);
    release();
  });

  it("does not press twice for a pointer's own click", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(pointer("pointerup"));
    const tweens = gsap.getTweensOf(button).length;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(gsap.getTweensOf(button)).toHaveLength(tweens);
    release();
  });

  it("refuses rather than presses a disabled or aria-disabled control", () => {
    const { root, release } = setUp(`<button aria-disabled="true">No</button><button disabled>No</button>`);
    for (const button of root.querySelectorAll("button")) {
      button.dispatchEvent(pointer("pointerdown"));
      expect(y(button), button.outerHTML).toBe(0);
      // The refusal's own start, as above: a nudge from 3 px left back to rest.
      const [nudge] = gsap.getTweensOf(button);
      expect(nudge!.vars["startAt"], button.outerHTML).toMatchObject({ x: -3 });
      expect(nudge!.vars["x"]).toBe(0);
    }
    release();
  });

  it("presses the control under a child that was the target", () => {
    const { root, release } = setUp(`<button><span>Go</span></button>`);
    root.querySelector("span")!.dispatchEvent(pointer("pointerdown"));
    expect(y(root.querySelector("button")!)).toBe(1);
    release();
  });

  it("skips a control that opts out with data-motion='none', or sits inside one that does", () => {
    const { root, release } = setUp(`<button data-motion="none">Tile</button><div data-motion="none"><button>Inner</button></div>`);
    for (const button of root.querySelectorAll("button")) {
      button.dispatchEvent(pointer("pointerdown"));
      expect(gsap.getTweensOf(button)).toHaveLength(0);
      expect(y(button)).toBe(0);
    }
    release();
  });

  it("lifts on a mouse hover and never on a finger", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerover", "touch"));
    expect(gsap.getTweensOf(button)).toHaveLength(0);
    button.dispatchEvent(pointer("pointerover"));
    expect(gsap.getTweensOf(button).at(-1)!.vars["y"]).toBe(-1);
    button.dispatchEvent(pointer("pointerout"));
    expect(gsap.getTweensOf(button).at(-1)!.vars["y"]).toBe(0);
    release();
  });

  it("gives every control in the overlay a press, as ui-sounds gives each a sound", () => {
    const { root, release } = setUp(
      `<a href="#">a</a><div role="button">b</div><select><option>c</option></select><input type="checkbox">`,
    );
    for (const control of root.querySelectorAll<HTMLElement>("a, [role='button'], select, input")) {
      control.dispatchEvent(pointer("pointerdown"));
      expect(y(control), control.tagName).toBe(1);
    }
    release();
  });

  it("leaves a text field alone, as ui-sounds does", () => {
    const { root, release } = setUp(`<input type="text">`);
    const field = root.querySelector("input")!;
    field.dispatchEvent(pointer("pointerdown"));
    expect(y(field)).toBe(0);
    release();
  });

  it("does nothing under reduced motion", () => {
    setReducedMotion(true);
    const { root, release } = setUp(`<button>Go</button>`);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(pointer("pointerover"));
    expect(gsap.getTweensOf(button)).toHaveLength(0);
    expect(button.style.transform).toBe("");
    release();
  });

  it("is opted out of by the select screen's tiles, whose own consequence is the motion", () => {
    const tiles = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/TileGrid.svelte"), "utf8");
    for (const testId of ['data-testid="tile"', 'data-testid="tile-random"']) {
      const at = tiles.indexOf(testId);
      const button = tiles.slice(tiles.lastIndexOf("<button", at), tiles.indexOf(">", at));
      expect(button, testId).toContain('data-motion="none"');
    }
  });

  it("removes every listener on release", () => {
    const { root, release } = setUp(`<button>Go</button>`);
    release();
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(pointer("pointerover"));
    expect(gsap.getTweensOf(button)).toHaveLength(0);
  });
});
