/**
 * Motion.
 *
 * The rules in `features/kit/motion.ts` are the kind that fail quietly: a tween through
 * a fractional offset still animates, a colour tween still looks like
 * something, and neither throws. So they are asserted here rather than left to
 * review.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEAT,
  MOTION_STEPS,
  STEP_EASE,
  carryOver,
  pulse,
  pulseOnChange,
  reducedMotion,
  refuse,
  riseIn,
} from "../../../../apps/client/src/features/kit/motion";
import { clientSourceFiles } from "../../support/client-source";

/** The module's own text, for the rules that are about how it is written. */
const SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/motion.ts"),
  "utf8",
);

/** Replaces the media query, which jsdom does not implement. */
function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function element(): HTMLElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the motion vocabulary", () => {
  it("steps rather than glides", () => {
    // Chrome that eases smoothly reads as belonging to a different product
    // than sprites animating at a handful of frames per state.
    expect(STEP_EASE).toBe(`steps(${MOTION_STEPS})`);
  });

  it("keeps a beat short enough to be feedback rather than a cutscene", () => {
    expect(BEAT).toBeLessThanOrEqual(0.3);
  });

  it("never tweens a colour", () => {
    // The palette-lock shader cannot reach DOM chrome, so an interpolation
    // between two swatches would be the one off-palette colour in the client.
    const tweened = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const property of ["backgroundColor", "borderColor", "color:", "fill:"]) {
      expect(tweened).not.toContain(property);
    }
  });

  it("rounds every positional tween to whole pixels", () => {
    // Every tween that moves something declares roundProps. A fractional
    // offset makes the browser resample a bitmap face mid-flight.
    const positional = SOURCE.match(/gsap\.(from|fromTo|to)\(/g) ?? [];
    const rounded = SOURCE.match(/roundProps:/g) ?? [];

    expect(positional.length).toBeGreaterThan(0);
    // `pulse` scales and `flashOut` fades rather than moves: the two tweens without it.
    expect(rounded.length).toBe(positional.length - 2);
  });
});

describe("the focus ring (polish spec §5.1)", () => {
  const STYLES = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/styles.css"), "utf8");
  const READY_ROOM = readFileSync(
    resolve(import.meta.dirname, "../../../../apps/client/src/features/lobby/ReadyRoom.svelte"),
    "utf8",
  );

  it("steps in from 2 px outside its offset, in three steps", () => {
    expect(STYLES).toMatch(/:focus-visible\s*{[^}]*animation:\s*ff-focus-in\s+120ms\s+steps\(3\)\s+backwards/);
    expect(STYLES).toMatch(/@keyframes ff-focus-in\s*{\s*from\s*{\s*outline-offset:\s*calc\(var\(--ff-focus-offset, 2px\) \+ 2px\)/);
  });

  it("appears in place under reduced motion", () => {
    expect(STYLES).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*:focus-visible\s*{\s*animation:\s*none/);
  });

  it("starts an inset ring from its own offset, not the global one", () => {
    expect(READY_ROOM).toMatch(/\.ff-seat__change:focus-visible\s*{[^}]*--ff-focus-offset:\s*-2px/);
  });
});

describe("the controls' own CSS (polish spec §5.2)", () => {
  const AQUARIAN = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/aquarian.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("tweens no colour: a colour change is a swap", () => {
    for (const transition of AQUARIAN.match(/transition:[^;]*;/g) ?? []) {
      expect(transition).not.toMatch(/color/);
    }
  });

  it("tweens no colour in any component or stylesheet either", () => {
    const files = clientSourceFiles().filter((file) => /\.(svelte|css)$/.test(file));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const css = readFileSync(resolve(import.meta.dirname, "../../../..", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const transition of css.match(/transition(-property)?:[^;]*;/g) ?? []) {
        expect(transition, file).not.toMatch(/color|background|border|shadow|fill|stroke|outline|\ball\b/);
      }
    }
  });

  it("leaves the press to ui-motion, so a CSS transform cannot fight it", () => {
    expect(AQUARIAN).not.toMatch(/:active[^{]*{[^}]*transform/);
    for (const transition of AQUARIAN.match(/transition:[^;]*;/g) ?? []) {
      expect(transition).not.toMatch(/transform/);
    }
  });
});

describe("honouring prefers-reduced-motion", () => {
  it("reports what the media query says", () => {
    setReducedMotion(true);
    expect(reducedMotion()).toBe(true);

    setReducedMotion(false);
    expect(reducedMotion()).toBe(false);
  });

  it("survives a environment with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(reducedMotion()).toBe(false);
  });

  it("still leaves an element visible and in place", () => {
    // The failure worth guarding: reduced motion must mean arriving, never
    // never appearing. An element left at opacity 0 is an invisible menu.
    setReducedMotion(true);
    const node = element();

    riseIn(node);

    expect(node.style.opacity).toBe("");
    expect(node.style.transform).toBe("");
    expect(gsap.getTweensOf(node)).toHaveLength(0);
  });

  it("does not pulse or nudge when motion is reduced", () => {
    setReducedMotion(true);
    const node = element();

    pulse(node);
    refuse(node);

    // Asked of GSAP rather than of the inline style. `isTweening` is the wrong
    // question here: it stays false until the ticker runs, which under jsdom it
    // never does. Whether a tween was created at all is the actual claim.
    expect(gsap.getTweensOf(node)).toHaveLength(0);
  });
});

describe("pulsing on change", () => {
  it("stays still on the first render", () => {
    // Otherwise every seat pulses the moment the menu opens, which says four
    // things just happened when nothing has.
    setReducedMotion(false);
    const node = element();

    const action = pulseOnChange(node, "open:false");

    expect(gsap.getTweensOf(node)).toHaveLength(0);
    action.update?.("open:false");
    expect(gsap.getTweensOf(node)).toHaveLength(0);
  });

  it("reacts once the watched value actually changes", () => {
    setReducedMotion(false);
    const node = element();
    const action = pulseOnChange(node, "open:false");

    action.update?.("room-p2:true");

    expect(gsap.getTweensOf(node)).toHaveLength(1);
  });
});

describe("carrying an element over between screens", () => {
  /** An element standing at `(x, y)`, as layout would report it. */
  function standing(x: number, y: number): HTMLElement {
    const node = element();
    node.getBoundingClientRect = () => ({ left: x, top: y, x, y, width: 380, height: 300, right: x + 380, bottom: y + 300, toJSON: () => ({}) });
    return node;
  }

  it("glides the arriving element from where the leaving one stood", () => {
    setReducedMotion(false);
    const from = vi.spyOn(gsap, "from");
    carryOver(standing(760, 250), "test-glide").destroy();
    carryOver(standing(760, 180), "test-glide");
    expect(from).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ x: 0, y: 70, roundProps: "x,y", ease: STEP_EASE }));
    from.mockRestore();
  });

  it("does not glide on a first arrival, or with reduced motion", () => {
    const from = vi.spyOn(gsap, "from");
    setReducedMotion(false);
    carryOver(standing(10, 10), "test-first");
    setReducedMotion(true);
    carryOver(standing(10, 10), "test-reduced").destroy();
    carryOver(standing(10, 90), "test-reduced");
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
  });

  it("does not glide from a place left long ago", () => {
    setReducedMotion(false);
    const from = vi.spyOn(gsap, "from");
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    carryOver(standing(10, 10), "test-stale").destroy();
    now.mockReturnValue(60_000);
    carryOver(standing(10, 90), "test-stale");
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    now.mockRestore();
  });
});
