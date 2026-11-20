/**
 * The wordmark carried from the splash to the title: the splash notes where
 * its lines were, the title takes that once, and its lines slide from there.
 */

import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveWordmark, slideFrom, takeWordmark } from "../../../../apps/client/src/features/boot/wordmark-handoff";

function wordmark(): HTMLElement {
  const h1 = document.createElement("h1");
  h1.innerHTML = "<span>Floor</span><span>Fifty</span>";
  document.body.append(h1);
  return h1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  takeWordmark();
});

describe("the wordmark handoff", () => {
  it("is taken once", () => {
    leaveWordmark(wordmark());
    expect(takeWordmark()).toHaveLength(2);
    expect(takeWordmark()).toBeUndefined();
  });

  it("leaves nothing when there is no wordmark to leave", () => {
    leaveWordmark(null);
    expect(takeWordmark()).toBeUndefined();
  });

  it("slides each line from where the splash had it", () => {
    const from = vi.spyOn(gsap, "from");
    const h1 = wordmark();
    const action = slideFrom(h1, [
      { left: 300, top: 40 },
      { left: 280, top: 90 },
    ]);
    // jsdom lays nothing out, so every line is at the origin here.
    expect(from.mock.calls.map(([, vars]) => [vars.x, vars.y])).toEqual([
      [300, 40],
      [280, 90],
    ]);
    expect(from.mock.calls.every(([, vars]) => vars.roundProps === "x,y")).toBe(true);
    action.destroy?.();
    from.mockRestore();
  });

  it("arrives in place when motion is reduced", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    const from = vi.spyOn(gsap, "from");
    slideFrom(wordmark(), [
      { left: 300, top: 40 },
      { left: 280, top: 90 },
    ]);
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
  });
});
