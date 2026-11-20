import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AccessibilitySystem } from "pixi.js";

const sourceOf = (path: string): string =>
  readFileSync(resolve(process.cwd(), "apps/client/src", path), "utf8");

describe("the Pixi stage application options and lifecycle", () => {
  describe("accessibility configuration", () => {
    it("disables activateOnTab in app.init to prevent shadow DOM focus capture over Svelte ARIA overlays", () => {
      const source = sourceOf("features/app/app.ts");
      expect(source).toMatch(/accessibilityOptions:\s*\{\s*activateOnTab:\s*false/);
    });

    it("ensures AccessibilitySystem ignores Tab keydown when activateOnTab is false", () => {
      const system = new AccessibilitySystem({
        runners: { postrender: { remove: vi.fn() } },
      } as never);

      system.init({ accessibilityOptions: { activateOnTab: false } });

      const activateSpy = vi.spyOn(system as unknown as { _activate: () => void }, "_activate");
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", keyCode: 9 } as never);

      // Simulate tab key press
      (system as unknown as { _onKeyDown: (e: KeyboardEvent) => void })._onKeyDown(tabEvent);

      expect(activateSpy).not.toHaveBeenCalled();
    });

    it("activates on Tab keydown by default when activateOnTab is not disabled", () => {
      const system = new AccessibilitySystem({
        runners: { postrender: { remove: vi.fn() } },
      } as never);

      system.init({});

      const activateSpy = vi
        .spyOn(system as unknown as { _activate: () => void }, "_activate")
        .mockImplementation(() => {});
      const tabEvent = new KeyboardEvent("keydown", { key: "Tab", keyCode: 9 } as never);

      (system as unknown as { _onKeyDown: (e: KeyboardEvent) => void })._onKeyDown(tabEvent);

      expect(activateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("stage teardown lifecycle", () => {
    it("drains pooled global resources and removes view on app.destroy", () => {
      const source = sourceOf("features/app/app.ts");
      expect(source).toMatch(
        /app\.destroy\(\s*\{\s*removeView:\s*true,\s*releaseGlobalResources:\s*true\s*\},\s*\{\s*children:\s*true\s*\}\s*\)/,
      );
    });
  });
});
