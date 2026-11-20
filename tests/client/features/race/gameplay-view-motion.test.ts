import { Graphics, Sprite, Text, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { asContentId, type StageContent } from "@floor-fifty/shared/content/game-content";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import { ticksPerBeat, type SongTiming } from "../../../../apps/client/src/lib/beat-clock";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const tuning = resolveTuning();
const makeView = () =>
  new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);

// The same song and beat `world-pulse.test.ts` measures an on-beat pulse at.
const SONG: SongTiming = { bpm: 146, beatOffsetTicks: 24 };
const tickAtBeat = (beat: number): number =>
  Math.ceil(SONG.beatOffsetTicks + beat * ticksPerBeat(SONG.bpm));

describe("the world's pulse under reduced motion", () => {
  it("keeps the camera and the platforms still", () => {
    const view = makeView();
    view.setSong(SONG);
    view.setAmbient(1, true);

    view.applySnapshot(snapshotAt(tickAtBeat(4)), LOCAL_ID);

    // A fresh view already breathes (momentum's floor is not zero), so any
    // offset here is the pulse and not the climb.
    expect(view.world.position.y).toBe(view.camera.transform().y);
    expect(view.platformSwell).toBe(1);
  });

  it("still breathes with motion allowed", () => {
    const view = makeView();
    view.setSong(SONG);
    view.setAmbient(1, false);

    view.applySnapshot(snapshotAt(tickAtBeat(4)), LOCAL_ID);

    expect(view.platformSwell).not.toBe(1);
  });
});

describe("the world's pulse on the song as heard", () => {
  it("swells to the song's own beat where it is told it, wherever the tick is", () => {
    const swellAt = (tick: number, songBeat: number | undefined): number => {
      const view = makeView();
      view.setSong(SONG);
      view.setAmbient(1, false);
      view.setSongBeat(songBeat);
      view.applySnapshot(snapshotAt(tick), LOCAL_ID);
      return view.platformSwell;
    };
    // Half a beat off the grid by the tick, on a bar's first beat by the song.
    const between = tickAtBeat(4) + Math.round(ticksPerBeat(SONG.bpm) / 2);
    expect(swellAt(between, 8)).toBe(swellAt(tickAtBeat(2), 8));
    expect(swellAt(between, 8)).toBeGreaterThan(swellAt(between, undefined));
  });
});

describe("the camera on the finish's winner (race-flow spec §5.2)", () => {
  const WINNER_HEIGHT = 2000;
  const scene = () =>
    snapshotAt(30, {
      players: [playerSnapshot({ id: LOCAL_ID, y: 0 }), playerSnapshot({ id: REMOTE_ID, y: WINNER_HEIGHT })],
    });
  const FRAME_MS = 1000 / 60;
  const cameraY = (view: GameplayView): number => view.camera.transform().y;

  /** Frames of the same scene, the camera's height after the first and after about 1.5 s. */
  function frames(focus: "none" | "glide" | "cut") {
    const view = makeView();
    view.setAmbient(1, focus === "cut");
    view.applySnapshot(scene(), LOCAL_ID, FRAME_MS);
    const start = cameraY(view);
    if (focus !== "none") view.focusOn(REMOTE_ID, focus === "cut");
    view.applySnapshot(scene(), LOCAL_ID, FRAME_MS);
    const first = cameraY(view);
    for (let frame = 0; frame < 90; frame += 1) view.applySnapshot(scene(), LOCAL_ID, FRAME_MS);
    const settled = cameraY(view);
    view.destroy();
    return { start, first, settled };
  }

  it("follows the local racer until told otherwise", () => {
    const { start, settled } = frames("none");
    expect(settled).toBeCloseTo(start, 3);
  });

  it("glides to the winner through the camera's own damping", () => {
    const cut = frames("cut");
    const glide = frames("glide");
    const travel = Math.abs(cut.settled - glide.start);
    expect(travel, "the winner is somewhere else").toBeGreaterThan(100);
    expect(Math.abs(glide.first - glide.start), "one frame in, still mostly where it was").toBeLessThan(travel * 0.2);
    expect(Math.abs(glide.settled - cut.settled), "then arrived").toBeLessThan(travel * 0.05);
  });

  it("cuts to the winner on the first frame under reduced motion", () => {
    const cut = frames("cut");
    expect(Math.abs(cut.first - cut.settled)).toBeLessThan(Math.abs(cut.settled - cut.start) * 0.05);
  });

  it("cuts the height alone: the zoom it held while the race moved stays", () => {
    const view = makeView();
    view.setAmbient(1, true);
    // The local racer running sideways, long enough for the motion zoom to settle.
    for (let frame = 0; frame < 120; frame += 1) {
      const moving = snapshotAt(30, {
        players: [playerSnapshot({ id: LOCAL_ID, x: frame * 4, y: 0 }), playerSnapshot({ id: REMOTE_ID, y: WINNER_HEIGHT })],
      });
      view.applySnapshot(moving, LOCAL_ID, FRAME_MS);
    }
    const zoom = view.camera.scale;
    view.focusOn(REMOTE_ID, true);
    view.applySnapshot(
      snapshotAt(30, {
        players: [playerSnapshot({ id: LOCAL_ID, x: 484, y: 0 }), playerSnapshot({ id: REMOTE_ID, y: WINNER_HEIGHT })],
      }),
      LOCAL_ID,
      FRAME_MS,
    );
    expect(view.camera.scale).toBeCloseTo(zoom, 2);
    view.destroy();
  });
});

describe("the floors the local racer is drawn against", () => {
  it("are at the predicted moment while the prediction leads, and at the sample otherwise", () => {
    const view = new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);
    const snapshot = snapshotAt(30, {
      platforms: [
        { id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] },
        { id: "floor-3", x: 100, y: 300, direction: 1, collectedBy: [LOCAL_ID] },
      ],
    });
    const entries = (view as unknown as {
      platforms: { entries: Map<string, { sprite: { x: number } }> };
    }).platforms.entries;

    view.applySnapshot(snapshot, LOCAL_ID, 16.67);
    expect(entries.get("floor-3")!.sprite.x).toBe(100);

    // The moving floor, eight ticks further on at the tick the racer is drawn.
    view.applySnapshot(snapshot, LOCAL_ID, 16.67, undefined, new Map([["floor-3", 126]]));
    expect(entries.get("floor-3")!.sprite.x).toBe(126);
    expect(entries.get("floor-0")!.sprite.x).toBe(0);
    view.destroy();
  });
});

describe("a silhouetted stage", () => {
  const stage = (silhouette?: boolean): StageContent => ({
    id: asContentId("dawn"),
    displayName: "Dawn",
    platformAlias: "world.platform",
    courseTuning: {},
    theme: {
      backdropAlias: "world.dawnSky",
      layers: [
        { alias: "world.dawnMist", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
        { alias: "world.dawnNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
      ],
      presentation: {
        profile: "aquarian",
        refractionIntensity: 0.4,
        horizonLift: 12,
        ...(silhouette === undefined ? {} : { silhouette }),
      },
    },
  });
  const viewFor = (silhouette?: boolean) =>
    new GameplayView(resolveStagePresentation(stage(silhouette)), emptyTextures, tuning, () => LOCAL_ID);
  // A collected floor, so its marker is drawn in its meaning colour.
  const snapshot = snapshotAt(1, {
    platforms: [
      { id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [LOCAL_ID] },
      { id: "floor-1", x: 100, y: 100, direction: 1, collectedBy: [] },
    ],
  });
  const descendants = (root: Container): Container[] =>
    root.children.flatMap((child) => [child, ...descendants(child)]);

  it("tints the floors and the racers black, and leaves the nameplates and floor markers alone", () => {
    const view = viewFor(true);
    view.applySnapshot(snapshot, LOCAL_ID, 16);

    const platforms = descendants(view.world.getChildByLabel("platforms")!);
    const floors = platforms.filter((child) => child instanceof Sprite);
    expect(floors.length).toBe(2);
    expect(floors.every((sprite) => sprite.tint === 0x000000)).toBe(true);
    const markers = platforms.filter((child) => child instanceof Graphics);
    expect(markers.length).toBe(2);
    expect(markers.every((marker) => marker.tint === 0xffffff)).toBe(true);

    // The body, and its copy across the seam.
    const players = descendants(view.world.getChildByLabel("players")!);
    const bodies = players.filter((child) => child instanceof Sprite);
    expect(bodies.length).toBe(2);
    expect(bodies.every((sprite) => sprite.tint === 0x000000)).toBe(true);
    const plates = players.filter((child) => child instanceof Text);
    expect(plates.length).toBeGreaterThan(0);
    expect(plates.every((text) => text.tint === 0xffffff)).toBe(true);
    view.destroy();
  });

  it("tints nothing on a stage without it", () => {
    const view = viewFor(undefined);
    view.applySnapshot(snapshot, LOCAL_ID, 16);
    const drawn = descendants(view.world).filter((child) => child instanceof Sprite);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((sprite) => sprite.tint === 0xffffff)).toBe(true);
    view.destroy();
  });
});
