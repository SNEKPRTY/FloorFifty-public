// @vitest-environment node
import { describe, expect, it } from "vitest";
import { menuArrangement, roomArrangement, screenLayout } from "../../../../apps/client/src/features/kit/screen-arrangement";

describe("the menu's arrangement (UI layout spec §6.1)", () => {
  it("stacks the hero over the form when held upright", () => {
    expect(menuArrangement("phone-portrait", undefined)).toBe("stack");
    expect(menuArrangement("tablet-portrait", undefined)).toBe("stack");
  });

  it("splits a desktop at every width, 900 x 600 included", () => {
    expect(menuArrangement("desktop", undefined)).toBe("split");
    expect(menuArrangement("desktop", "short")).toBe("split");
  });

  it("splits a phone held sideways, even at the 270 px a browser leaves", () => {
    expect(menuArrangement("phone-landscape", "short")).toBe("split");
    expect(menuArrangement("phone-landscape", "compact")).toBe("split");
  });
});

describe("the ready room's arrangement (UI layout spec §6.3)", () => {
  it("stacks the seats over the settings when held upright", () => {
    expect(roomArrangement("phone-portrait")).toBe("stack");
    expect(roomArrangement("tablet-portrait")).toBe("stack");
  });

  it("sets the seats beside the settings held sideways and on desktop", () => {
    expect(roomArrangement("phone-landscape")).toBe("split");
    expect(roomArrangement("desktop")).toBe("split");
  });
});

describe("the layout a root hands down (UI layout spec §2.1 rule 1)", () => {
  it("names each form factor's layout once, for the components below the roots", () => {
    expect(screenLayout("phone-portrait")).toBe("upright");
    expect(screenLayout("tablet-portrait")).toBe("tablet");
    expect(screenLayout("phone-landscape")).toBe("sideways");
    expect(screenLayout("desktop")).toBe("desk");
  });
});
