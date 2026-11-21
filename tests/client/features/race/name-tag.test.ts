import { describe, expect, it } from "vitest";
import { Graphics, Text } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import {
  NAME_TAG_FONT_SIZE,
  NAME_TAG_MAX_CHARS,
  NameTag,
  minimumFaceScale,
  nameTagFacePx,
  nameTagResolution,
  nameTagScale,
  nameTagText,
  racerZIndex,
} from "../../../../apps/client/src/features/race/name-tag";

describe("what a name tag reads", () => {
  it("keeps a name of twelve characters whole", () => {
    expect(nameTagText("Wolfgang-Ama")).toBe("Wolfgang-Ama");
  });

  it("cuts a longer name to twelve characters and an ellipsis", () => {
    expect(nameTagText("Wolfgang-Amadeus")).toBe("Wolfgang-Ama…");
    expect(nameTagText("Wolfgang-Amadeus").length).toBe(NAME_TAG_MAX_CHARS + 1);
  });

  it("cuts sixteen wide letters to twelve and an ellipsis", () => {
    expect(nameTagText("WWWWWWWWWWWWWWWW")).toBe("WWWWWWWWWWWW…");
  });

  it("reads the name as given, even one that starts with a digit", () => {
    // The seat number is the badge's, never prefixed here (the old tag read
    // "1 Kite"); a name of its own that starts with a digit stays as it is.
    expect(nameTagText("1Kite")).toBe("1Kite");
    expect(nameTagText("Sable")).toBe("Sable");
  });
});

describe("how large a name tag is drawn", () => {
  // The camera eases between the resting zoom (0.8) and the moving one (1.0), with punch and Survival's 4% on top.
  const zooms = [0.8, 0.85, 0.9, 0.95, 1, 1.04];
  const face = (cssPerUnit: number, zoom: number): number => nameTagScale(cssPerUnit, zoom) * cssPerUnit * zoom * NAME_TAG_FONT_SIZE;
  const letterboxes = Array.from({ length: 300 }, (_, index) => 0.2 + index * 0.0127);

  it("draws the face at a whole multiple of twelve css px, never under twelve, on every screen", () => {
    for (const cssPerUnit of letterboxes) {
      const px = face(cssPerUnit, 1);
      expect(px).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(px / 12).toBeCloseTo(Math.round(px / 12), 9);
      expect(px).toBeCloseTo(nameTagFacePx(cssPerUnit), 9);
    }
  });

  it("keeps one size all race: the face does not change with the camera's zoom", () => {
    // Reproduces the jump from 24 to 12 px when a racer starts and stops moving (1920 x 1080 is 2 css px per unit).
    for (const cssPerUnit of letterboxes) {
      const sizes = zooms.map((zoom) => face(cssPerUnit, zoom));
      for (const size of sizes) expect(size).toBeCloseTo(sizes[0]!, 9);
    }
    expect(face(2, 0.8)).toBeCloseTo(24, 9);
    expect(face(2, 1)).toBeCloseTo(24, 9);
  });

  it("puts a portrait phone's tag at twelve css px", () => {
    // 390 css px across 960 logical units.
    expect(nameTagFacePx(390 / 960)).toBe(12);
  });

  it("treats a scale it cannot measure as no scale", () => {
    expect(nameTagScale(0, 1)).toBe(1);
    expect(nameTagScale(Number.NaN, 1)).toBe(1);
    expect(nameTagFacePx(Number.NaN)).toBe(12);
  });

  it("keeps a face that is not on the grid at least twelve css px, and leaves a large one alone (the lava marker)", () => {
    expect(minimumFaceScale(2, 14)).toBe(1);
    expect(minimumFaceScale(0.4, 14) * 0.4 * 14).toBeGreaterThanOrEqual(12);
  });
});

describe("the resolution a tag is drawn at", () => {
  it("makes one texel one device pixel", () => {
    // A 24 css px face on a 2x screen is 48 device px, over 11 logical units.
    expect(nameTagResolution(24, 2, NAME_TAG_FONT_SIZE)).toBeCloseTo(48 / 11, 3);
  });

  it("falls back to 1 where it cannot be measured", () => {
    expect(nameTagResolution(Number.NaN, 2, NAME_TAG_FONT_SIZE)).toBe(1);
  });
});

describe("draw order", () => {
  it("puts the focused racer above every seat", () => {
    const seats = [0, 1, 2, 3].map((seat) => racerZIndex(`p${seat}`, "p0", seat));
    expect(seats[0]).toBeGreaterThan(Math.max(...seats.slice(1)));
  });

  it("orders the rest by seat, so a later seat never covers the focus", () => {
    expect(racerZIndex("p1", "p0", 1)).toBeLessThan(racerZIndex("p2", "p0", 2));
    expect(racerZIndex("p3", "p0", 3)).toBeLessThan(racerZIndex("p0", "p0", 0));
  });

  it("falls back to seat order when nobody is focused", () => {
    expect(racerZIndex("p2", undefined, 2)).toBe(2);
  });
});

describe("a name tag", () => {
  const parts = (tag: NameTag) => ({
    plate: tag.root.getChildByLabel("name-tag-plate") as Graphics,
    badge: tag.root.getChildByLabel("name-tag-seat") as Text,
    name: tag.root.getChildByLabel("name-tag-name") as Text,
    marker: tag.root.getChildByLabel("local-marker") as Graphics,
  });

  it("sets the seat number apart from the name", () => {
    const tag = new NameTag(0, "scarlet");
    tag.setName("Wolfgang-Amadeus");
    expect(parts(tag).badge.text).toBe("1");
    expect(parts(tag).name.text).toBe("Wolfgang-Ama…");
  });

  it("hides the seat number in the story, where it would read as a place, and closes the gap it left", () => {
    const tag = new NameTag(1, "cyan");
    tag.setName("Frog");
    const withSeat = parts(tag).name.x;
    tag.setSeatShown(false);
    expect(parts(tag).badge.visible).toBe(false);
    expect(parts(tag).name.x).toBeLessThan(withSeat);
    tag.setSeatShown(true);
    expect(parts(tag).name.x).toBe(withSeat);
  });

  it("sits on an opaque plate in the chip fill", () => {
    const tag = new NameTag(1, "cyan");
    tag.setName("Sable");
    const plate = parts(tag).plate;
    expect(plate.alpha).toBe(1);
    // The plate's fill is the chip swatch; Pixi keeps the last fill style.
    expect(plate.fillStyle.color).toBe(roleTint("uiChipFill"));
  });

  it("keeps a restrained dark edge around the focused name's opaque backing", () => {
    const tag = new NameTag(0, "scarlet");
    tag.setName("Kite");
    tag.setFocus(true);
    expect(parts(tag).plate.strokeStyle.color).toBe(roleTint("uiChipEdge"));
    expect(parts(tag).plate.strokeStyle.width).toBe(1);
    expect(parts(tag).marker.visible).toBe(true);
  });

  it("shows the marker and the bright name only when focused", () => {
    const tag = new NameTag(2, "gold");
    tag.setName("Wren");
    expect(parts(tag).marker.visible).toBe(false);
    expect(parts(tag).name.style.fill).toBe(roleTint("uiMuted"));
    tag.setFocus(true);
    expect(tag.focused).toBe(true);
    expect(parts(tag).marker.visible).toBe(true);
    expect(parts(tag).name.style.fill).toBe(roleTint("uiText"));
  });
});
