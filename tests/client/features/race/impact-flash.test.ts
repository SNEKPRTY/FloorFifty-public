import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID } from "../../support/snapshots";

const tuning = resolveTuning();
const makeView = () =>
  new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);

describe("the impact flash coverage on portrait tablet", () => {
  it("covers from the top of the canvas to the very bottom, past the field's bottom band", () => {
    const view = makeView();
    // 820 x 1180 tablet portrait layout: scale ~0.854, fieldTop = 60, bottomBand = 240
    const scale = 820 / 960;
    const scenery = {
      x: 0,
      y: -60 / scale,
      width: 960,
      height: 1180 / scale,
    };
    const fieldHeight = 1030;

    view.setFraming(true, scenery, fieldHeight, false);
    view.setImpact(1);

    expect(view.impactAlpha).toBe(1);
    const bounds = view.impactBounds;
    // Must reach or exceed the canvas top (scenery.y)
    expect(bounds.y).toBeLessThanOrEqual(scenery.y);
    // Must reach or exceed the canvas bottom (scenery.y + scenery.height)
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(scenery.y + scenery.height);
    view.destroy();
  });
});

describe("the impact flash covers the whole screen, bars included", () => {
  // Field units, as `layout` returns `scenery` for each canvas (scale = width / 960).
  const cases = [
    { name: "phone portrait 390 x 844", portrait: true, phone: true, width: 390, height: 844, fieldTop: 60 },
    { name: "phone landscape 844 x 390", portrait: false, phone: false, width: 844, height: 390, fieldTop: -42 },
    { name: "tablet landscape 1180 x 820", portrait: false, phone: false, width: 1180, height: 820, fieldTop: 78 },
  ];
  it.each(cases)("$name", ({ portrait, phone, width, height, fieldTop }) => {
    const view = makeView();
    const scale = width / 960;
    const scenery = { x: 0, y: -fieldTop / scale, width: 960, height: height / scale };
    view.setFraming(portrait, scenery, 1030, phone);
    view.setImpact(1);
    const bounds = view.impactBounds;
    expect(bounds.y).toBeLessThanOrEqual(scenery.y);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(scenery.y + scenery.height);
    expect(bounds.x).toBeLessThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(960);
    view.destroy();
  });

  it("is drawn in the front layer, over the bars, not in the clipped or effects layers", () => {
    const view = makeView();
    expect(view.frontLayer.children.some((child) => child.label === "impact-flash")).toBe(true);
    expect(view.feelLayer.children.some((child) => child.label === "impact-flash")).toBe(false);
    view.destroy();
  });
});
