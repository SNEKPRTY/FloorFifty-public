import { describe, expect, it } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { PlatformView } from "../../../../apps/client/src/features/race/platform-view";
import {
  ANIMATION_FALLBACK,
  PlayerView,
} from "../../../../apps/client/src/features/race/player-view";

const tuning = resolveTuning();

/**
 * A stand-in for a loaded ninja sheet.
 *
 * The view tests elsewhere pass `emptyTextures`, and `frameOf` short-circuits
 * on `Texture.EMPTY`, so nothing there exercises the path that actually cuts a
 * frame out of a sheet. This provides a real source so it does.
 */
function sheetSource(): { source: TextureSource; sheet: Texture } {
  // The contract's grid: four run frames across, five animation rows down,
  // at the 32-pixel frame the sheets are authored in.
  const source = new TextureSource({ width: 32 * 4, height: 32 * 5 });
  return { source, sheet: new Texture({ source }) };
}

function climbing(id: string, y: number): PlayerSnapshot {
  return {
    id: asPlayerId(id),
    name: id,
    characterId: "ninja",
    colour: "scarlet",
    deviceClass: "desktop",
    cpu: false,
    x: 0,
    y,
    vx: 0,
    vy: 0,
    grounded: false,
    awaitingInput: false,
    lastAckedSequence: 0,
    facingRight: true,
    lap: 1,
    progress: 0,
    ready: true,
    status: "connected",
    bestFloor: 0,
    floorEdgeY: 0,
  };
}

describe("cutting animation frames out of a sheet", () => {
  it("cuts each frame once rather than on every rendered frame", () => {
    // Every `new Texture({source})` subscribes to the source's `resize` event
    // and only unsubscribes on `destroy`. A view that cuts a frame per player
    // per rendered frame therefore leaks a texture and a listener sixty times a
    // second, for the whole race, and nothing ever collects them.
    const { source, sheet } = sheetSource();
    const view = new PlayerView(() => sheet, tuning, () => undefined);
    const players = [climbing("p1", 0), climbing("p2", 0)];

    view.apply(players, 16.67);
    const afterFirstFrame = source.listenerCount("resize");

    for (let frame = 1; frame < 600; frame += 1) {
      view.apply(
        players.map((player) => ({ ...player, y: player.y + frame })),
        16.67,
      );
    }

    expect(source.listenerCount("resize")).toBe(afterFirstFrame);
  });

  it("releases its frames when the view is torn down", () => {
    const { source, sheet } = sheetSource();
    const before = source.listenerCount("resize");

    const view = new PlayerView(() => sheet, tuning, () => undefined);
    view.apply([climbing("p1", 0)], 16.67);
    expect(source.listenerCount("resize")).toBeGreaterThan(before);

    view.destroy();
    expect(source.listenerCount("resize")).toBe(before);
  });

  it("releases the frames of a player who left the room", () => {
    const { source, sheet } = sheetSource();
    const view = new PlayerView(() => sheet, tuning, () => undefined);

    view.apply([climbing("p1", 0)], 16.67);
    const withOne = source.listenerCount("resize");
    view.apply([climbing("p1", 0), climbing("p2", 0)], 16.67);
    expect(source.listenerCount("resize")).toBeGreaterThan(withOne);

    view.apply([climbing("p1", 0)], 16.67);
    expect(source.listenerCount("resize")).toBe(withOne);
  });

  it("still draws a different frame as the animation advances", () => {
    // The fix must not turn the animation into a still: the point is to reuse
    // the cut frames, not to stop changing which one is shown.
    const { sheet } = sheetSource();
    const view = new PlayerView(() => sheet, tuning, () => undefined);

    view.apply([climbing("p1", 0)], 0);
    const first = view.displayFor(asPlayerId("p1"))?.sprite.texture;

    // Past the first cell of the idle cycle, derived from the contract's own
    // timing rather than guessed: a held pose dwells far longer than a frame of
    // a smooth cycle, so a number that worked under the old six-frame rows
    // lands on frame zero under these.
    view.apply(
      [climbing("p1", 0)],
      // Three quarters through, not a whole cycle: a full dwell wraps back
    // onto frame zero and the assertion would fail for the wrong reason.
    ANIMATION_FALLBACK["idle"]!.durationMs * 0.75,
    );
    const later = view.displayFor(asPlayerId("p1"))?.sprite.texture;

    expect(first).toBeDefined();
    expect(later).toBeDefined();
    expect(later).not.toBe(first);
  });
});

describe("cutting the platform frame", () => {
  it("cuts it once and shares it across every floor", () => {
    // Twenty floors draw the same cell. Cutting it twenty times costs twenty
    // textures and twenty source listeners for one image.
    const { source, sheet } = sheetSource();
    const before = source.listenerCount("resize");

    const view = new PlatformView(() => sheet, tuning);
    view.apply(
      Array.from({ length: 20 }, (_unused, index) => ({
        id: `floor-${index}`,
        x: 0,
        y: index * 100,
        direction: 1,
        collectedBy: [],
      })),
      undefined,
    );

    expect(view.count).toBe(20);
    expect(source.listenerCount("resize")).toBe(before + 1);
  });

  it("releases the frame when the view is torn down", () => {
    const { source, sheet } = sheetSource();
    const before = source.listenerCount("resize");

    const view = new PlatformView(() => sheet, tuning);
    view.apply([{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] }], undefined);
    view.destroy();

    expect(source.listenerCount("resize")).toBe(before);
  });
});
