import { describe, expect, it } from "vitest";
import { GLYPHS, glyphFamily } from "../../../../apps/client/src/features/i18n/glyphs";

describe("controller glyphs", () => {
  it("recognises the two families by id and falls back to generic", () => {
    expect(glyphFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toBe("xbox");
    expect(glyphFamily("xinput")).toBe("xbox");
    expect(glyphFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
    expect(glyphFamily("054c-09cc-Wireless Controller")).toBe("playstation");
    expect(glyphFamily("8BitDo SN30 Pro")).toBe("generic");
  });

  it("names every action for every family", () => {
    for (const family of ["xbox", "playstation", "generic"] as const) {
      for (const action of ["confirm", "back", "move", "fastFall", "restart", "pause"] as const) {
        expect(GLYPHS[family][action]().length).toBeGreaterThan(0);
      }
    }
  });

  it("names A alongside the trigger for fast fall", () => {
    expect(GLYPHS.xbox.fastFall()).toBe("A / RT");
    expect(GLYPHS.playstation.fastFall()).toBe("✕ / R2");
    expect(GLYPHS.generic.fastFall()).toBe("Bottom button / Right trigger");
  });
});
