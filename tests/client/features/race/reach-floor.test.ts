import { describe, expect, it } from "vitest";
import { floorFor } from "../../../../apps/client/src/features/race/reach-floor";

describe("the menu building's floor", () => {
  it("is the foot of the window: menus draw no letterbox bar, whatever the shape of the screen", () => {
    expect(floorFor(720)).toBe(720);
    expect(floorFor(844)).toBe(844);
  });
});
