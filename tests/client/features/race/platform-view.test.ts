// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Graphics } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { PlatformSnapshot } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { PlatformView } from "../../../../apps/client/src/features/race/platform-view";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { LOCAL_ID, REMOTE_ID } from "../../support/snapshots";

/**
 * The two indicator states, resolved through the palette rather than restated.
 *
 * The reference's `Color::ORANGE_RED` and `Color::GREEN` are not Resurrect 64
 * swatches, and approximating them here would be authoring a colour -- the one
 * thing the palette contract forbids. These read the same roles the view does,
 * so the cases assert which state is drawn rather than which hex value it is.
 * What those roles have to clear to stay readable is pinned in
 * `tests/asset-contract/palette.test.ts`, which is the right place for it: it is a fact
 * about the palette, not about this display list.
 */
const UNCOLLECTED = roleTint("floorPending");
const COLLECTED = roleTint("floorTaken");

const barOf = (view: PlatformView, id: string): Graphics =>
  view["entries"].get(id)!.indicator;

describe("the collected indicator", () => {
  it("is the pending colour until the local player has taken the floor", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] }], LOCAL_ID);
    expect(barOf(view, "floor-0").fillStyle.color).toBe(UNCOLLECTED);
  });

  it("turns the taken colour once the local player has taken it", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [LOCAL_ID] }], LOCAL_ID);
    expect(barOf(view, "floor-0").fillStyle.color).toBe(COLLECTED);
  });

  it("reads the local player's own progress, not another racer's", () => {
    // The room broadcasts one snapshot to everyone, so the set travels and
    // each client resolves it against its own id. A floor another player has
    // taken must not read as taken here.
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [REMOTE_ID] }], LOCAL_ID);
    expect(barOf(view, "floor-0").fillStyle.color).toBe(UNCOLLECTED);
  });
});

/**
 * The mark under the bar.
 *
 * The bar alone carries status in colour, which is the one channel a player
 * with a colour-vision difference cannot read. The mark is the second channel,
 * and the property that matters as much as its existence is that it changes
 * nothing else: the slab is the box the server resolves, and a cosmetic
 * flourish that resized or moved it would be a cosmetic flourish that moved the
 * floor a player is aiming at.
 */
describe("the status mark beneath the slab", () => {
  const spriteOf = (view: PlatformView, id: string) =>
    view["entries"].get(id)!.sprite as unknown as {
      width: number;
      height: number;
      position: { x: number; y: number };
    };

  const slabBox = (view: PlatformView, id: string) => {
    const sprite = spriteOf(view, id);
    return {
      width: sprite.width,
      height: sprite.height,
      x: sprite.position.x,
      y: sprite.position.y,
    };
  };

  const platform: PlatformSnapshot = {
    id: "floor-0",
    x: 12,
    y: -40,
    direction: 1,
    collectedBy: [],
  };

  it("redraws the mark when the floor is taken, and touches nothing else", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([platform], LOCAL_ID);

    const before = slabBox(view, "floor-0");
    const bar = barOf(view, "floor-0");
    // Read now: the graphics object is reused across updates, so this is only
    // the pending state's mark until the next `apply` overwrites it.
    const pendingStroke = bar.strokeStyle.color;

    view.apply([{ ...platform, collectedBy: [LOCAL_ID] }], LOCAL_ID);

    // The collision-facing claim: a status update changes the indicator and
    // only the indicator.
    expect(slabBox(view, "floor-0")).toEqual(before);
    expect(barOf(view, "floor-0").fillStyle.color).toBe(COLLECTED);

    // And the mark itself was redrawn in the other state. Asserted on the
    // stroke's colour rather than on the bounds: a Graphics caches its bounds,
    // so two differently shaped marks can report the same rectangle and the
    // test would pass while drawing nothing.
    expect(pendingStroke).toBe(UNCOLLECTED);
    expect(bar.strokeStyle.color).toBe(COLLECTED);
  });

  it("redraws a bar only when its floor's state changes", () => {
    // `apply` runs every frame. A Graphics that is cleared and redrawn is
    // re-triangulated and its geometry re-uploaded, so redrawing every bar on
    // every frame cost the race a rebuild per floor per frame for a picture
    // that had not changed.
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([platform], LOCAL_ID);
    const bar = barOf(view, "floor-0");
    const clears = vi.spyOn(bar, "clear");

    for (let frame = 0; frame < 5; frame += 1) view.apply([{ ...platform, x: platform.x + frame }], LOCAL_ID);
    expect(clears).not.toHaveBeenCalled();
    // It still follows its floor.
    expect(bar.position.x).toBe(platform.x + 4);

    view.apply([{ ...platform, collectedBy: [LOCAL_ID] }], LOCAL_ID);
    expect(clears).toHaveBeenCalledTimes(1);
    expect(bar.fillStyle.color).toBe(COLLECTED);
    view.apply([{ ...platform, collectedBy: [LOCAL_ID] }], LOCAL_ID);
    expect(clears).toHaveBeenCalledTimes(1);
  });

  it("draws a mark in both states, below the bar", () => {
    // Without this the status is colour-only, which is what the mark exists to
    // fix. Both are checked because "the pending floor has no mark" would be
    // just as broken and rather less obvious.
    const view = new PlatformView(emptyTextures, resolveTuning());
    const barHeight = resolveTuning().FLOOR_HEIGHT / 6;

    for (const collectedBy of [[], [LOCAL_ID]]) {
      view.apply([{ ...platform, collectedBy }], LOCAL_ID);
      const bounds = barOf(view, "floor-0").getLocalBounds();

      // The mark hangs under the bar, so the whole indicator is taller than the
      // bar alone.
      expect(bounds.height).toBeGreaterThan(barHeight);
    }
  });
});

describe("the platform art", () => {
  const requested = (options?: ConstructorParameters<typeof PlatformView>[2]): string[] => {
    const aliases: string[] = [];
    new PlatformView((alias) => (aliases.push(alias), emptyTextures(alias)), resolveTuning(), options);
    return aliases;
  };

  it("is the stage's own slab", () => {
    expect(requested({ platformAlias: "world.snowShrinePlatform" })).toEqual(["world.snowShrinePlatform"]);
  });

  it("is Rooftops' slab where no stage names one", () => {
    expect(requested()).toEqual(["world.platform"]);
  });
});

describe("a window of floors moving up an endless course (audit remediation D-R9)", () => {
  const floor = (index: number, collectedBy: PlatformSnapshot["collectedBy"] = []): PlatformSnapshot => ({
    id: `floor-${index}`,
    x: index * 10,
    y: index * 100,
    direction: 1,
    collectedBy,
  });
  const window = (from: number) => Array.from({ length: 15 }, (_, i) => floor(from + i));

  it("makes no new sprites once a window's worth are pooled", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply(window(0), LOCAL_ID);
    const warmed = view.created;
    for (let from = 1; from <= 40; from += 1) view.apply(window(from), LOCAL_ID);
    expect(view.created).toBe(warmed);
    expect(view.count).toBe(15);
  });

  it("a reused sprite takes the new floor's position and mark", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([floor(0, [LOCAL_ID])], LOCAL_ID);
    view.apply([floor(20)], LOCAL_ID);
    const entry = view["entries"].get("floor-20")!;
    expect(entry.sprite.label).toBe("floor-20");
    expect(entry.sprite.visible).toBe(true);
    expect(entry.sprite.position.x).toBe(200);
    expect(barOf(view, "floor-20").fillStyle.color).toBe(UNCOLLECTED);
  });

  it("a reused bar is drawn afresh for its new floor, even in the state its last floor had", () => {
    // Pooling clears the bar, so a cached "already drawn pending" must not
    // survive it: the bar would come back empty.
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([floor(0)], LOCAL_ID);
    view.apply([floor(20)], LOCAL_ID);
    const bar = barOf(view, "floor-20");
    expect(bar.fillStyle.color).toBe(UNCOLLECTED);
    expect(bar.getLocalBounds().height).toBeGreaterThan(resolveTuning().FLOOR_HEIGHT / 6);
  });
});

describe("batching efficiency", () => {
  it("groups all indicators and all sprites into dedicated containers to prevent batch breaks", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    const floors = [
      { id: "floor-0", x: 0, y: 0, direction: 1 as const, collectedBy: [] },
      { id: "floor-1", x: 10, y: 100, direction: 1 as const, collectedBy: [] },
    ];
    view.apply(floors, LOCAL_ID);

    // root must contain exactly two layer containers: indicators (under) and sprites (above)
    expect(view.root.children.length).toBe(2);
    const [indicators, sprites] = view.root.children;
    expect(indicators?.label).toBe("platform-indicators");
    expect(sprites?.label).toBe("platform-sprites");
    expect(indicators?.children.length).toBe(2);
    expect(sprites?.children.length).toBe(2);
  });

  it("enables cullable on platform sprites and indicators for view-frustum culling", () => {
    const view = new PlatformView(emptyTextures, resolveTuning());
    view.apply([{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] }], LOCAL_ID);
    const entry = (view as any).entries.get("floor-0")!;
    expect(entry.sprite.cullable).toBe(true);
    expect(entry.indicator.cullable).toBe(true);
  });
});

describe("missed floor telegraphing", () => {
  const tuning = resolveTuning();
  const platform: PlatformSnapshot = {
    id: "floor-0",
    x: 0,
    y: 0,
    direction: 1,
    collectedBy: [],
  };

  it("turns crimson with a missed mark when local player climbs beyond FLOOR_GAP_MAX without collecting it in finite race", () => {
    const view = new PlatformView(emptyTextures, tuning);
    const playerY = platform.y + tuning.FLOOR_GAP_MAX + 10;
    view.apply([platform], LOCAL_ID, { playerY, isFinite: true });

    const bar = barOf(view, "floor-0");
    const MISSED = (roleTint as any)("floorStranded");
    expect(bar.fillStyle.color).toBe(MISSED);
    expect(bar.strokeStyle.color).toBe(MISSED);

    const sprite = view["entries"].get("floor-0")!.sprite;
    expect(sprite.tint).toBe(0xffffff);
  });

  it("does not mark platform as missed in infinite (survival) race", () => {
    const view = new PlatformView(emptyTextures, tuning);
    const playerY = platform.y + tuning.FLOOR_GAP_MAX + 10;
    view.apply([platform], LOCAL_ID, { playerY, isFinite: false });

    const bar = barOf(view, "floor-0");
    expect(bar.fillStyle.color).toBe(UNCOLLECTED);
  });

  it("does not mark platform as missed if player already collected it", () => {
    const view = new PlatformView(emptyTextures, tuning);
    const playerY = platform.y + tuning.FLOOR_GAP_MAX + 10;
    view.apply([{ ...platform, collectedBy: [LOCAL_ID] }], LOCAL_ID, { playerY, isFinite: true });

    const bar = barOf(view, "floor-0");
    expect(bar.fillStyle.color).toBe(COLLECTED);
  });

  it("clears missed marks back to uncollected upon reset / lap completion", () => {
    const view = new PlatformView(emptyTextures, tuning);
    const playerY = platform.y + tuning.FLOOR_GAP_MAX + 10;
    view.apply([platform], LOCAL_ID, { playerY, isFinite: true });
    expect(barOf(view, "floor-0").fillStyle.color).toBe((roleTint as any)("floorStranded"));

    // Reset occurs
    (view as any).resetAscent();
    view.apply([platform], LOCAL_ID, { playerY: 0, isFinite: true });

    expect(barOf(view, "floor-0").fillStyle.color).toBe(UNCOLLECTED);
    const sprite = view["entries"].get("floor-0")!.sprite;
    expect(sprite.tint).toBe(0xffffff);
  });
});




describe("missed-floor recovery presentation", () => {
  const tuning = resolveTuning();
  const floor: PlatformSnapshot = { id: "floor-19", x: 0, y: 100, direction: 1, collectedBy: [] };
  it.each(["descent", "collection", "absent", "survival"])("clears the reminder on %s without a reset", (reason) => {
    const view = new PlatformView(emptyTextures, tuning);
    try {
      view.apply([floor], LOCAL_ID, { playerY: 100 + tuning.FLOOR_GAP_MAX + 1, isFinite: true });
      expect(barOf(view, floor.id).fillStyle.color).toBe(roleTint("floorStranded"));
      view.apply([reason === "collection" ? { ...floor, collectedBy: [LOCAL_ID] } : floor], reason === "absent" ? undefined : LOCAL_ID,
        { playerY: reason === "descent" ? 100 + tuning.FLOOR_GAP_MAX : 100 + tuning.FLOOR_GAP_MAX + 1, isFinite: reason !== "survival" });
      expect(barOf(view, floor.id).fillStyle.color).toBe(reason === "collection" ? COLLECTED : UNCOLLECTED);
    } finally { view.destroy(); }
  });
  it("starts only above the distance threshold, and rearms its transition after recovery", () => {
    const view = new PlatformView(emptyTextures, tuning);
    try {
      for (const distance of [tuning.FLOOR_GAP_MAX - 1, tuning.FLOOR_GAP_MAX]) {
        expect(view.apply([floor], LOCAL_ID, { playerY: 100 + distance, isFinite: true })).toBe(false);
      }
      expect(view.apply([floor], LOCAL_ID, { playerY: 101 + tuning.FLOOR_GAP_MAX, isFinite: true })).toBe(true);
      expect(view.apply([floor], LOCAL_ID, { playerY: 101 + tuning.FLOOR_GAP_MAX, isFinite: true })).toBe(false);
      view.apply([floor], LOCAL_ID, { playerY: 100, isFinite: true });
      expect(view.apply([floor], LOCAL_ID, { playerY: 101 + tuning.FLOOR_GAP_MAX, isFinite: true })).toBe(true);
    } finally { view.destroy(); }
  });
});
