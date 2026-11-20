import { beforeEach, describe, expect, it } from "vitest";
import { SwipeControls } from "../../../../apps/client/src/features/race/swipe-controls";
import { InputManager } from "../../../../apps/client/src/features/platform/input";

beforeEach(() => {
  document.body.innerHTML = "";
});

const pointer = (type: string, id: number, x: number, y: number) =>
  new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: "touch", bubbles: true });

describe("the swipe surface", () => {
  it("steers the race from a real pointer drag", () => {
    const input = new InputManager();
    const controls = new SwipeControls((action, active) => input.set(action, active, "touch"));
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;

    surface.dispatchEvent(pointer("pointerdown", 1, 100, 600));
    surface.dispatchEvent(pointer("pointermove", 1, 140, 600));
    expect(input.frame.right).toBe(true);

    surface.dispatchEvent(pointer("pointercancel", 1, 140, 600));
    expect(input.frame.right).toBe(false);
    controls.unmount();
  });

  it("keeps the steering thumb when the other finger lifts and loses its capture", () => {
    const input = new InputManager();
    const controls = new SwipeControls((action, active) => input.set(action, active, "touch"));
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;

    surface.dispatchEvent(pointer("pointerdown", 1, 100, 600));
    surface.dispatchEvent(pointer("pointermove", 1, 140, 600));
    surface.dispatchEvent(pointer("pointerdown", 2, 300, 600));
    surface.dispatchEvent(pointer("pointerup", 2, 300, 650));
    surface.dispatchEvent(pointer("lostpointercapture", 2, 300, 650));
    expect(input.frame.right).toBe(true);
    controls.unmount();
  });

  // Owner, 2026-10-10: any downward flick slams, wherever it starts; only steering keeps to the lower half.
  it("fast-falls from a flick in the top half of the screen", () => {
    const pulses: string[] = [];
    const controls = new SwipeControls((action, active) => {
      if (active) pulses.push(action);
    });
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;
    const top = window.innerHeight * 0.1;

    surface.dispatchEvent(pointer("pointerdown", 1, 100, top));
    surface.dispatchEvent(pointer("pointermove", 1, 100, top + 60));
    expect(pulses).toEqual(["fastFall"]);
    controls.unmount();
  });

  it("does not steer from a finger that lands in the top half", () => {
    const input = new InputManager();
    const controls = new SwipeControls((action, active) => input.set(action, active, "touch"));
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;
    const top = window.innerHeight * 0.1;

    surface.dispatchEvent(pointer("pointerdown", 1, 100, top));
    surface.dispatchEvent(pointer("pointermove", 1, 160, top));
    expect(input.frame.right).toBe(false);
    controls.unmount();
  });

  it("covers the whole screen, so a flick anywhere reaches it", () => {
    const controls = new SwipeControls(() => {});
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;
    expect(surface.className).toContain("top-0");
    expect(surface.className).not.toContain("h-1/2");
    controls.unmount();
  });

  it("has no restart button of its own", () => {
    const controls = new SwipeControls(() => {});
    controls.mount(document.body);
    expect(document.querySelector('[data-testid="swipe-restart"]')).toBeNull();
    controls.unmount();
  });

  it("releases on unmount", () => {
    const input = new InputManager();
    const controls = new SwipeControls((action, active) => input.set(action, active, "touch"));
    controls.mount(document.body);
    const surface = document.querySelector<HTMLElement>('[data-testid="swipe-surface"]')!;
    surface.dispatchEvent(pointer("pointerdown", 1, 100, 600));
    surface.dispatchEvent(pointer("pointermove", 1, 40, 600));
    controls.unmount();
    expect(input.frame.left).toBe(false);
  });
});
