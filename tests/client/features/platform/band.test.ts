import { describe, expect, it } from "vitest";
import { bandForLayout, bandFromGameplay, barHeightFor, bottomBarFor, writeBand } from "../../../../apps/client/src/features/platform/band";

describe("the visible band (UI layout system spec §4.1)", () => {
  it("is the gameplay rect's vertical extent, in viewport css px", () => {
    // 1280 x 720 at a 5% crop: 36 px bars, 648 px of field between them.
    expect(bandFromGameplay({ y: 36, height: 648 })).toEqual({ top: 36, bottom: 684, height: 648 });
  });

  it("is the whole canvas in portrait, where nothing is cropped", () => {
    expect(bandFromGameplay({ y: 0, height: 844 })).toEqual({ top: 0, bottom: 844, height: 844 });
  });

  it("rounds to whole pixels, so a fractional scale cannot leave a hairline of bar", () => {
    expect(bandFromGameplay({ y: 13.5, height: 243.2 })).toEqual({ top: 14, bottom: 257, height: 243 });
  });

  it("publishes itself as three custom properties on the element it is given", () => {
    const root = document.createElement("html");
    writeBand(root, { top: 36, bottom: 684, height: 648 });
    expect(root.style.getPropertyValue("--ff-band-top")).toBe("36px");
    expect(root.style.getPropertyValue("--ff-band-bottom")).toBe("684px");
    expect(root.style.getPropertyValue("--ff-band-height")).toBe("648px");
  });

  it("is the whole canvas in portrait, where the gameplay rect is only the field", () => {
    // A portrait layout's gameplay rect is the field between the HUD row and
    // the bottom band (D-R1); the HUD and the touch controls sit outside it,
    // on screen. There are no bars, so the band is the canvas.
    const portrait = { portrait: true, gameplay: { y: 60, height: 880 } };
    expect(bandForLayout(portrait, 1180, "field")).toEqual({ top: 0, bottom: 1180, height: 1180 });
  });

  it("is the gameplay rect in landscape, between the bars", () => {
    const landscape = { portrait: false, gameplay: { y: 36, height: 648 } };
    expect(bandForLayout(landscape, 720, "field")).toEqual({ top: 36, bottom: 684, height: 648 });
  });

  it("is the whole canvas in menu mode, in landscape too", () => {
    // 1440 x 900: the menus fill the window, not the 16:9 field's middle.
    const landscape = { portrait: false, gameplay: { y: 45, height: 810 } };
    expect(bandForLayout(landscape, 900, "menu")).toEqual({ top: 0, bottom: 900, height: 900 });
  });

  it("is the field between the bars in field mode", () => {
    const landscape = { portrait: false, gameplay: { y: 45, height: 810 } };
    expect(bandForLayout(landscape, 900, "field")).toEqual({ top: 45, bottom: 855, height: 810 });
  });
});

describe("the bottom bar the tagline may sit in", () => {
  it("is roomy where a landscape bar can hold a line", () => {
    expect(bottomBarFor("field", 40, false)).toBe("roomy");
  });

  it("is none in a sliver of a bar and on a phone held sideways", () => {
    expect(bottomBarFor("field", 12, false)).toBe("none");
    expect(bottomBarFor("field", 60, true)).toBe("none");
  });

  it("writes no roomy bottom bar in menu mode, where there is no bar", () => {
    // 1440 x 900 would have drawn a 45 px bar under the field.
    expect(bottomBarFor("menu", 45, false)).toBe("none");
  });
});

describe("the bottom bar's height", () => {
  it("is 0 in a menu, whatever the crop: the building runs to the window's foot (iPad sideways, 1080 x 810)", () => {
    expect(barHeightFor("menu", false, 810, 678)).toBe(0);
  });

  it("is what the crop leaves in a race, and 0 held upright", () => {
    expect(barHeightFor("field", false, 810, 678)).toBe(132);
    expect(barHeightFor("field", true, 844, 700)).toBe(0);
  });
});
