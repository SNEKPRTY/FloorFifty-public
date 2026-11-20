import { Container, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import { NAME_TAG_FONT_SIZE, nameTagFacePx, nameTagResolution } from "../../../../apps/client/src/features/race/name-tag";
import type { PlayerView } from "../../../../apps/client/src/features/race/player-view";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const tuning = resolveTuning();
const CSS_PER_UNIT = 1.5; // 1440 x 900
const PIXEL_RATIO = 1;

/** The racers' view, which the game view keeps private. */
const playersOf = (view: GameplayView): PlayerView => (view as unknown as { players: PlayerView }).players;

function attached(): { view: GameplayView; host: Container } {
  const view = new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);
  const host = new Container();
  view.setCssPerUnit(CSS_PER_UNIT);
  view.setPixelDensity(CSS_PER_UNIT * PIXEL_RATIO);
  view.attachTagLayer(host);
  return { view, host };
}

const race = (tick: number, y: number) =>
  snapshotAt(tick, { players: [playerSnapshot({ id: LOCAL_ID, y }), playerSnapshot({ id: REMOTE_ID, y: y + 40, x: 300 })] });

describe("the name tags' layer", () => {
  it("holds the tags outside the world, so the composite does not resample them", () => {
    const { view, host } = attached();
    view.applySnapshot(race(30, 0), LOCAL_ID);

    expect(host.children).toContain(view.tagLayer);
    expect(view.tagLayer.children).toContain(playersOf(view).tags);
    let parent: Container | null = playersOf(view).tags.parent;
    while (parent !== null && parent !== view.tagLayer) parent = parent.parent;
    expect(parent).toBe(view.tagLayer);
    let inWorld: Container | null = playersOf(view).tags;
    while (inWorld !== null && inWorld !== view.world) inWorld = inWorld.parent;
    expect(inWorld).toBeNull();
  });

  it("carries the world's transform, on whole device pixels", () => {
    const { view } = attached();
    view.applySnapshot(race(30, 0), LOCAL_ID);
    view.applySnapshot(race(60, 500), LOCAL_ID);

    expect(view.tagLayer.scale.x).toBe(view.world.scale.x);
    const density = CSS_PER_UNIT * PIXEL_RATIO;
    expect(view.tagLayer.x * density).toBeCloseTo(Math.round(view.tagLayer.x * density), 6);
    expect(view.tagLayer.y * density).toBeCloseTo(Math.round(view.tagLayer.y * density), 6);
    // Where the world draws a point, the layer draws it too, to a device pixel.
    expect(Math.abs(view.tagLayer.x - (view.world.x + playersOf(view).root.x * view.world.scale.x))).toBeLessThanOrEqual(0.5 / density);
  });

  it("keeps a tag's face one size on screen at every camera zoom", () => {
    const { view } = attached();
    const faces = new Set<number>();
    for (const [tick, y] of [[30, 0], [90, 800], [150, 1600]] as const) {
      view.applySnapshot(race(tick, y), LOCAL_ID);
      const tag = playersOf(view).displayFor(LOCAL_ID)!.tag.root;
      faces.add(Math.round(tag.scale.x * view.world.scale.x * CSS_PER_UNIT * NAME_TAG_FONT_SIZE * 1000));
    }
    expect([...faces]).toEqual([nameTagFacePx(CSS_PER_UNIT) * 1000]);
  });

  it("draws each tag's text at the resolution that makes a texel a device pixel", () => {
    const { view } = attached();
    view.applySnapshot(race(30, 0), LOCAL_ID);
    const text = playersOf(view).displayFor(LOCAL_ID)!.tag.root.children.filter((child): child is Text => child instanceof Text);
    expect(text.length).toBeGreaterThan(0);
    for (const item of text) expect(item.resolution).toBe(nameTagResolution(nameTagFacePx(CSS_PER_UNIT), PIXEL_RATIO, NAME_TAG_FONT_SIZE));
  });
});
