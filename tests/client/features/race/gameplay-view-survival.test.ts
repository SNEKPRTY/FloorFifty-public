/** Survival's camera in the gameplay view (lava spec §4). */
import { describe, expect, it, vi } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import { LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const tuning = resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 });
const makeView = () => new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);
const survival = (players: ReturnType<typeof playerSnapshot>[]) =>
  snapshotAt(600, { raceStartedAtTick: 0, floorCount: 60, tuning, players });

describe("Survival's camera (lava spec §4)", () => {
  it("follows a live racer as a 20 or 50 race does, not their edge", () => {
    const view = makeView();
    for (let frame = 0; frame < 240; frame += 1) {
      view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 700 })]), LOCAL_ID);
    }
    expect(view.camera.y).toBeCloseTo(1000, 0);
  });

  it("glides when the edge moves, rather than cutting with it", () => {
    const view = makeView();
    for (let frame = 0; frame < 240; frame += 1) {
      view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 700 })]), LOCAL_ID);
    }
    const before = view.camera.y;
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 900 })]), LOCAL_ID);
    expect(view.camera.y).toBeCloseTo(before, 6);
  });

  it("lets the music's breath move the picture again", () => {
    const view = makeView();
    view.setSong({ bpm: 146, beatOffsetTicks: 24 });
    view.setAmbient(1, false);
    let breathed = false;
    for (let tick = 600; tick < 700 && !breathed; tick += 1) {
      const snapshot = { ...survival([playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 800 })]), tick };
      view.applySnapshot(snapshot, LOCAL_ID);
      breathed = view.world.position.y !== view.camera.transform().y;
    }
    expect(breathed).toBe(true);
  });

  it("still closes in on danger", () => {
    const view = makeView();
    const calm = makeView();
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 805, floorEdgeY: 800 })]), LOCAL_ID);
    calm.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1400, floorEdgeY: 800 })]), LOCAL_ID);
    expect(view.camera.transform().scale).toBeGreaterThan(calm.camera.transform().scale);
  });

  it("watches the highest racer still standing once the local racer is out", () => {
    const view = makeView();
    const snapshot = survival([
      playerSnapshot({ id: LOCAL_ID, y: 700, floorEdgeY: 720, outAtTick: 500, finishedAtTick: 500 }),
      playerSnapshot({ id: REMOTE_ID, name: "Wren", y: 3000, floorEdgeY: 2800 }),
    ]);
    for (let frame = 0; frame < 240; frame += 1) view.applySnapshot(snapshot, LOCAL_ID);
    expect(view.camera.y).toBeGreaterThan(2900);
  });

  it("leaves a finite race's camera on the racer", () => {
    const view = makeView();
    const finite = snapshotAt(600, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: -265 })] });
    for (let frame = 0; frame < 240; frame += 1) view.applySnapshot(finite, LOCAL_ID);
    expect(view.camera.y).toBeCloseTo(1000, 0);
  });
});

describe("the lava's rise while the edge waits (first-race spec §2)", () => {
  /** The `rise` the view hands the lava for the local racer, one frame at `tick`. */
  function lavaRise(local: Partial<ReturnType<typeof playerSnapshot>>, tick: number): number {
    const view = makeView();
    const update = vi.spyOn(view.lava!, "update");
    view.applySnapshot(
      snapshotAt(tick, { raceStartedAtTick: 0, floorCount: 60, tuning, players: [playerSnapshot({ id: LOCAL_ID, y: 100, floorEdgeY: -265, ...local })] }),
      LOCAL_ID,
    );
    return update.mock.calls[0]![0].rise;
  }

  it("is 0 while the local racer's edge waits, and 0 through the rest that follows", () => {
    expect(lavaRise({ awaitingInput: true, edgeWaitTicks: 200 }, 200)).toBe(0);
    // Her first input came on tick 300: the 3-second rest runs to 480, though 300 is past the old 180.
    expect(lavaRise({ edgeWaitTicks: 300 }, 400)).toBe(0);
  });

  it("is the race clock's rise once the rest is over", () => {
    expect(lavaRise({ edgeWaitTicks: 300 }, 480)).toBeGreaterThan(0);
    expect(lavaRise({}, 180)).toBeGreaterThan(0); // a racer whose edge never waited: as before
  });
});

describe("the tutorial's edge on a finite course (first-race spec §1)", () => {
  const finiteTuning = resolveTuning();
  const finite = snapshotAt(600, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, y: 300, floorEdgeY: -265 })] });
  const viewWithEdge = () =>
    new GameplayView(resolveStagePresentation(undefined), emptyTextures, finiteTuning, () => LOCAL_ID, undefined, { storyEdge: true });

  it("draws the tutorial's edge, and hides the lava when there is none", () => {
    const view = viewWithEdge();
    view.setStoryEdge({ y: 274, rise: 30 });
    view.applySnapshot(finite, LOCAL_ID);
    expect(view.lava!.root.visible).toBe(true);
    expect(view.lava!.surfaceY).toBe(274);
    view.setStoryEdge(undefined);
    view.applySnapshot(finite, LOCAL_ID);
    expect(view.lava!.root.visible).toBe(false);
  });

  it("hands the lava the edge's own rise, not the race clock's", () => {
    const view = viewWithEdge();
    const update = vi.spyOn(view.lava!, "update");
    view.setStoryEdge({ y: 274, rise: 30 });
    view.applySnapshot(finite, LOCAL_ID);
    expect(update.mock.calls[0]![0]).toMatchObject({ edgeY: 274, rise: 30 });
  });

  it("frames the story's lava: an edge under the view's foot pulls the camera down a little until it shows, the racer kept below the HUD (review 2, R1; re-check 3, R1 and R2)", () => {
    const high = (tick: number) => snapshotAt(tick, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, y: 1400 })] });
    const settle = (edge: { y: number; rise: number } | undefined) => {
      const view = viewWithEdge();
      view.setStoryEdge(edge);
      for (let frame = 0; frame < 240; frame += 1) view.applySnapshot(high(600 + frame), LOCAL_ID, 16);
      return view;
    };
    // 260 under the racer: the chase's leash (200 under its floor) with a bounce on top, at the foot of a wide view.
    const framed = settle({ y: 1140, rise: 30 });
    expect(framed.camera.showsY(1140 + 10)).toBe(true);
    // The racer stays in the middle band: never above 35% of the field from its top.
    const racerAt = framed.camera.logicalToScreen({ x: 0, y: 1400 }).y;
    expect(racerAt).toBeGreaterThanOrEqual(LOGICAL_VIEWPORT.height * 0.35);
    // An edge far below is not chased: the look-down is capped, so the racer keeps its place.
    const far = settle({ y: 700, rise: 30 });
    expect(far.camera.logicalToScreen({ x: 0, y: 1400 }).y).toBeGreaterThanOrEqual(LOGICAL_VIEWPORT.height * 0.35);
    // The same camera with no lava holds the racer in the middle, and that edge would be off the foot.
    const plain = settle(undefined);
    expect(plain.camera.showsY(1140 + 10)).toBe(false);
  });

  it("builds no lava for a finite race", () => {
    expect(new GameplayView(resolveStagePresentation(undefined), emptyTextures, finiteTuning, () => LOCAL_ID).lava).toBeUndefined();
  });
});
