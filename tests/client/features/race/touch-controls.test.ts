import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PointerLatch,
  STICKY_MARGIN_PX,
  StickyPointers,
  TouchControls,
  nearestTarget,
  prefersTouchControls,
  type TouchAction,
} from "../../../../apps/client/src/features/race/touch-controls";
import { InputManager } from "../../../../apps/client/src/features/platform/input";
import { MIN_TOUCH_TARGET_PX } from "../../../../apps/client/src/lib/constants";

/** Mounts controls wired to a real InputManager, as gameplay does. */
function mountedControls(): {
  controls: TouchControls;
  input: InputManager;
  host: HTMLElement;
  lastInput(): { left: boolean; right: boolean; fastFall: boolean };
} {
  const input = new InputManager();
  const host = document.createElement("div");
  document.body.append(host);

  const controls = new TouchControls((action, active) => input.set(action, active, "touch"));
  controls.mount(host);

  return {
    controls,
    input,
    host,
    lastInput: () => ({
      left: input.frame.left,
      right: input.frame.right,
      fastFall: input.frame.fastFall,
    }),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("multi-touch", () => {
  it("supports simultaneous left and fast-fall pointers", () => {
    const { controls, lastInput } = mountedControls();
    controls.pointerDown("left", 1);
    controls.pointerDown("fastFall", 2);
    expect(lastInput()).toMatchObject({ left: true, fastFall: true });
  });

  it("keeps an action held until its last pointer lifts", () => {
    const { controls, lastInput } = mountedControls();
    controls.pointerDown("left", 1);
    controls.pointerDown("left", 2);
    controls.pointerUp("left", 1);
    expect(lastInput().left).toBe(true);

    controls.pointerUp("left", 2);
    expect(lastInput().left).toBe(false);
  });

  it("ignores a release for a pointer that was never down", () => {
    const { controls, lastInput } = mountedControls();
    controls.pointerDown("right", 1);
    controls.pointerUp("right", 99);
    expect(lastInput().right).toBe(true);
  });

  it("produces one input frame per real state change", () => {
    const input = new InputManager();
    const frames: number[] = [];
    input.subscribe((frame) => frames.push(frame.sequence));

    const controls = new TouchControls((action, active) => input.set(action, active, "touch"));
    controls.pointerDown("left", 1);
    controls.pointerDown("left", 2);
    controls.pointerUp("left", 2);
    controls.pointerUp("left", 1);

    expect(frames).toHaveLength(2);
  });

  it("releases everything held when the controls come down", () => {
    const { controls, lastInput } = mountedControls();
    controls.pointerDown("left", 1);
    controls.unmount();
    expect(lastInput().left).toBe(false);
  });
});

describe("the buttons' names (languages plan, Task 8)", () => {
  it("names each button in words, never by its action identifier", () => {
    const { host, controls } = mountedControls();
    const label = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-label");
    expect(label("touch-left")).toBe("Move left");
    expect(label("touch-right")).toBe("Move right");
    expect(label("touch-fast-fall")).toBe("Fast fall");
    controls.unmount();
  });
});

describe("mounting", () => {
  it("draws left, right, and fast-fall controls", () => {
    const { host } = mountedControls();
    expect(host.querySelector('[data-testid="touch-left"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="touch-right"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="touch-fast-fall"]')).not.toBeNull();
  });

  it("removes its DOM on unmount", () => {
    const { controls, host } = mountedControls();
    controls.unmount();
    expect(host.querySelector('[data-testid="touch-controls"]')).toBeNull();
    expect(controls.isMounted).toBe(false);
  });

  it("mounts only once", () => {
    const { controls, host } = mountedControls();
    controls.mount(host);
    expect(host.querySelectorAll('[data-testid="touch-controls"]')).toHaveLength(1);
  });

  it("captures the pointer on its side, so a thumb sliding off still releases the control", () => {
    const { host, lastInput } = mountedControls();
    const side = host.querySelector<HTMLElement>('[data-testid="touch-side-left"]')!;
    const button = host.querySelector<HTMLElement>('[data-testid="touch-left"]')!;
    const capture = vi.fn();
    side.setPointerCapture = capture;

    button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, bubbles: true }));
    expect(capture).toHaveBeenCalledWith(7);
    expect(lastInput().left).toBe(true);
    flushSync();
    expect(button.dataset["held"]).toBe("true");

    side.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, bubbles: true }));
    expect(lastInput().left).toBe(false);
    flushSync();
    expect(button.dataset["held"]).toBe("false");
  });

  it("suppresses the page gestures a drag on the controls would otherwise cause", () => {
    const { host } = mountedControls();
    const root = host.querySelector<HTMLElement>('[data-testid="touch-controls"]')!;
    const event = new Event("touchmove", { cancelable: true, bubbles: true });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels a touch at its start, so a held thumb never starts the long-press buzz", () => {
    // Chrome on Android buzzes as its long-press detector offers a selection;
    // only a cancelled touchstart stops the detector.
    const { host } = mountedControls();
    const button = host.querySelector<HTMLElement>('[data-testid="touch-left"]')!;
    const event = new Event("touchstart", { cancelable: true, bubbles: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("requires a target at least as large as the accessibility minimum", () => {
    expect(TouchControls.minimumTargetPx).toBe(MIN_TOUCH_TARGET_PX);
    expect(MIN_TOUCH_TARGET_PX).toBeGreaterThanOrEqual(44);
  });
});

const box = (left: number, top: number, size = 60) => ({ left, top, right: left + size, bottom: top + size });
const LAYOUT = [
  { action: "left" as const, rect: box(16, 700) },
  { action: "right" as const, rect: box(88, 700) },
  { action: "fastFall" as const, rect: box(300, 700) },
];

describe("sticky buttons", () => {
  it("resolves a point on a button to that button", () => {
    expect(nearestTarget(40, 720, LAYOUT)).toBe("left");
  });

  it("resolves a near miss to the nearest button within the margin", () => {
    expect(nearestTarget(40, 700 - (STICKY_MARGIN_PX - 4), LAYOUT)).toBe("left");
    expect(nearestTarget(83, 720, LAYOUT)).toBe("right"); // in the gap, nearer right
    expect(nearestTarget(372, 720, LAYOUT)).toBe("fastFall");
  });

  it("ignores a touch beyond the margin", () => {
    expect(nearestTarget(40, 700 - STICKY_MARGIN_PX - 1, LAYOUT)).toBeUndefined();
    expect(nearestTarget(200, 720, LAYOUT)).toBeUndefined();
  });

  it("slides a held thumb from one button to the next", () => {
    const held = new Set<TouchAction>();
    const pointers = new StickyPointers(new PointerLatch((action, active) => (active ? held.add(action) : held.delete(action))));
    pointers.down(1, "left");
    pointers.move(1, "right");
    expect([...held]).toEqual(["right"]);
    pointers.up(1);
    expect(held.size).toBe(0);
  });

  it("keeps what a thumb holds when it slides off everything", () => {
    const held = new Set<TouchAction>();
    const pointers = new StickyPointers(new PointerLatch((action, active) => (active ? held.add(action) : held.delete(action))));
    pointers.down(1, "left");
    pointers.move(1, undefined);
    expect([...held]).toEqual(["left"]);
  });

  it("keeps a button held while another finger slides off it", () => {
    const held = new Set<TouchAction>();
    const pointers = new StickyPointers(new PointerLatch((action, active) => (active ? held.add(action) : held.delete(action))));
    pointers.down(1, "left");
    pointers.down(2, "left");
    pointers.move(2, "right");
    expect([...held].sort()).toEqual(["left", "right"]);
  });

  it("presses the nearest button from a touch on the margin, in the DOM", () => {
    const { host, lastInput } = mountedControls();
    for (const { action, rect } of LAYOUT) {
      const button = host.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
      button.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: 60, height: 60, toJSON: () => ({}) });
    }
    const side = host.querySelector<HTMLElement>('[data-testid="touch-side-left"]')!;

    side.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, clientX: 150, clientY: 720, bubbles: true }));
    expect(lastInput()).toMatchObject({ left: false, right: true });

    side.dispatchEvent(new PointerEvent("pointermove", { pointerId: 3, clientX: 30, clientY: 720, bubbles: true }));
    expect(lastInput()).toMatchObject({ left: true, right: false });

    side.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3, bubbles: true }));
    expect(lastInput().left).toBe(false);
  });
});

describe("device selection", () => {
  it("mounts for a coarse pointer and not for a fine one", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("coarse"),
      media: query,
    }));
    expect(prefersTouchControls()).toBe(true);

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    expect(prefersTouchControls()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("the touch buttons' material", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../../../apps/client/src/features/race/TouchControls.svelte"),
    "utf8",
  );
  it("is the kit's HUD glass, so a button reads as a control over the course and no second copy of the look is kept here", () => {
    expect(source).toMatch(/<Panel\s+as="button"[^>]*tone="hud"/);
    const rule = /:global\(\.ff-touch-button\)\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const own of ["background", "backdrop-filter", "border:", "border-radius", "box-shadow"]) expect(rule).not.toContain(own);
  });
  it("keeps inside the visible band, off the letterbox's bottom bar (ui layout spec §4.1)", () => {
    const rule = /\.ff-touch-frame\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(rule).toMatch(/top:\s*var\(--ff-band-top\)/);
    expect(rule).toMatch(/height:\s*var\(--ff-band-height\)/);
  });

  it("presses: one pixel down while held", () => {
    expect(source).toMatch(/\.ff-touch-button\[data-held="true"\]\)\s*\{[^}]*transform:\s*translateY\(1px\)/);
  });
});
