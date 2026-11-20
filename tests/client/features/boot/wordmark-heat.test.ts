/**
 * Heat on the wordmark: the splash's copy burns, the title's cools to still
 * and then drops the filter, and reduced motion leaves both still.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WORDMARK_HEAT, wordmarkHeat } from "../../../../apps/client/src/features/boot/wordmark-heat";

function wordmark(): HTMLElement {
  const h1 = document.createElement("h1");
  h1.style.fontSize = "100px";
  document.body.append(h1);
  return h1;
}

/** A frame clock driven by hand. */
function frames(): (ms: number) => void {
  let queued: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => queued.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    queued = [];
  });
  return (ms) => {
    const run = queued;
    queued = [];
    for (const callback of run) callback(ms);
  };
}

const heatOf = (node: HTMLElement): string => node.style.getPropertyValue("--ff-wordmark-heat");
const scale = (): number => Number(document.querySelector("feDisplacementMap")?.getAttribute("scale"));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the wordmark's heat", () => {
  it("bends the letters through its own filter, in em", () => {
    frames();
    const node = wordmark();
    wordmarkHeat(node);
    const id = /url\(#(.+)\)/.exec(heatOf(node))?.[1];
    expect(document.getElementById(id!)?.tagName.toLowerCase()).toBe("filter");
    expect(scale()).toBeCloseTo(WORDMARK_HEAT.displacement * 100);
  });

  it("burns on for as long as it is up, and goes when it does", () => {
    const tick = frames();
    const node = wordmark();
    const action = wordmarkHeat(node, "burn");
    tick(0);
    tick(10_000);
    expect(scale()).toBeCloseTo(WORDMARK_HEAT.displacement * 100);
    action.destroy?.();
    expect(heatOf(node)).toBe("");
    expect(document.querySelector("filter")).toBeNull();
  });

  it("cools to still, then drops the filter", () => {
    const tick = frames();
    const node = wordmark();
    wordmarkHeat(node, "cool");
    tick(0);
    tick((WORDMARK_HEAT.cool * 1000) / 2);
    expect(scale()).toBeGreaterThan(0);
    expect(scale()).toBeLessThan(WORDMARK_HEAT.displacement * 100);
    tick(WORDMARK_HEAT.cool * 1000);
    expect(heatOf(node)).toBe("");
    expect(document.querySelector("filter")).toBeNull();
  });

  it("is not there when off, or when motion is reduced", () => {
    frames();
    const node = wordmark();
    wordmarkHeat(node, "off");
    expect(heatOf(node)).toBe("");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    wordmarkHeat(node, "burn");
    expect(heatOf(node)).toBe("");
    expect(document.querySelector("filter")).toBeNull();
  });
});
