/** The lava, drawn (lava spec §5). */
import { describe, expect, it } from "vitest";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { GameplayView, LAVA_LINGER_TICKS } from "../../../../apps/client/src/features/race/gameplay-view";
import { LavaView, lavaSpillBands, type LavaFrame, type LavaSpillFrame } from "../../../../apps/client/src/features/race/lava-view";
import { emptyTextures } from "../../../../apps/client/src/features/render/textures";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const endless = resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 });
const finite = resolveTuning({ COURSE_FLOOR_COUNT: 50 });
const viewWith = (tuning = endless) =>
  new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => LOCAL_ID);
const survival = (players: ReturnType<typeof playerSnapshot>[], tick = 600) =>
  snapshotAt(tick, { raceStartedAtTick: 0, floorCount: 60, tuning: endless, players });

const frame = (overrides: Partial<LavaFrame> = {}): LavaFrame => ({
  edgeY: 800,
  racer: { x: 0, y: 1000 },
  rise: 55,
  deltaMs: 16.67,
  reducedMotion: false,
  viewLeft: -600,
  viewRight: 600,
  viewBottomY: 700,
  markerAt: { x: 480, y: 520 },
  ...overrides,
});

describe("the lava in the view", () => {
  it("is built only for an endless course (review focus 5)", () => {
    expect(viewWith(endless).lava).toBeDefined();
    expect(viewWith(finite).lava).toBeUndefined();
  });

  it("sits between the racers' bodies and their name tags", () => {
    const view = viewWith();
    const players = view.lava!.root.parent!;
    const index = (label: string) => players.children.findIndex((child) => child.label === label);
    expect(index("bodies")).toBeLessThan(players.children.indexOf(view.lava!.root));
    expect(players.children.indexOf(view.lava!.root)).toBeLessThan(index("nameplates"));
  });

  it("puts its surface on the predicted edge, ahead of the sample", () => {
    const view = viewWith();
    const predicted = { x: 0, y: 1100, vx: 0, vy: 0, facingRight: true, floorEdgeY: 900 };
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1100, floorEdgeY: 850 })]), LOCAL_ID, 16.67, predicted);
    expect(view.lava!.surfaceY).toBe(900);
  });

  it("shows no marker once the local racer is out (review focus 3)", () => {
    const view = viewWith();
    const snapshot = survival([
      playerSnapshot({ id: LOCAL_ID, y: 700, floorEdgeY: 720, outAtTick: 500, finishedAtTick: 500 }),
      playerSnapshot({ id: REMOTE_ID, name: "Wren", y: 3000, floorEdgeY: 2800 }),
    ]);
    for (let i = 0; i < 60; i += 1) view.applySnapshot(snapshot, LOCAL_ID);
    expect(view.lava!.markerFloors).toBeUndefined();
    expect(view.lavaDip).toBeUndefined();
  });

  it("reports a dip once, on the frame the local racer first sinks", () => {
    const view = viewWith();
    const half = endless.PLAYER_HEIGHT / 2;
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 800 + half + 20, floorEdgeY: 800 })]), LOCAL_ID);
    expect(view.lavaDip).toBeUndefined();
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 800 + half - 4, floorEdgeY: 800 })]), LOCAL_ID);
    expect(view.lavaDip).toBeDefined();
    view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 800 + half - 6, floorEdgeY: 800 })]), LOCAL_ID);
    expect(view.lavaDip).toBeUndefined();
  });

  const dipTwice = (view: GameplayView, gapMs: number): (string | undefined)[] => {
    const half = endless.PLAYER_HEIGHT / 2;
    const above = survival([playerSnapshot({ id: LOCAL_ID, y: 800 + half + 20, floorEdgeY: 800 })]);
    const under = survival([playerSnapshot({ id: LOCAL_ID, y: 800 + half - 4, floorEdgeY: 800 })]);
    const keys: (string | undefined)[] = [];
    view.applySnapshot(above, LOCAL_ID);
    view.applySnapshot(under, LOCAL_ID);
    keys.push(view.lavaDip);
    view.applySnapshot(above, LOCAL_ID, gapMs);
    view.applySnapshot(under, LOCAL_ID);
    keys.push(view.lavaDip);
    return keys;
  };

  it("sizzles for each dip under reduced motion too: sound is not motion (final review I2)", () => {
    const view = viewWith();
    view.setAmbient(5, true);
    const keys = dipTwice(view, 600);
    expect(keys.every((key) => key !== undefined)).toBe(true);
  });

  it("keys every dip uniquely, across dips and across views, so the mixer never drops one (final review I3)", () => {
    const first = dipTwice(viewWith(), 600);
    const second = dipTwice(viewWith(), 600);
    const keys = [...first, ...second];
    expect(keys.every((key) => key !== undefined)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("drains once the local racer has been out a moment, so a rival below their frozen edge is not drowned (final review I1)", () => {
    const view = viewWith();
    const at = (tick: number) =>
      survival(
        [
          playerSnapshot({ id: LOCAL_ID, y: 2900, floorEdgeY: 2950, outAtTick: 600, finishedAtTick: 600 }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", y: 1500, floorEdgeY: 1300 }),
        ],
        tick,
      );
    view.applySnapshot(at(600), LOCAL_ID);
    expect(view.lava!.surfaceY).toBe(2950);
    view.applySnapshot(at(600 + LAVA_LINGER_TICKS), LOCAL_ID);
    expect(view.lava!.surfaceY).toBeUndefined();
    expect(view.lava!.root.visible).toBe(false);
  });

  it("scales the marker up where the letterbox draws it small, as name tags are (final review I4)", () => {
    const view = viewWith();
    view.setCssPerUnit(0.41);
    // Frames enough for the camera to reach the racer, leaving the lava below the view.
    for (let frame = 0; frame < 240; frame += 1) {
      view.applySnapshot(survival([playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 200 })]), LOCAL_ID);
    }
    expect(view.lava!.marker.visible).toBe(true);
    expect(view.lava!.marker.scale.x).toBeGreaterThan(1);
  });
});

describe("the lava's band in the view (lava band)", () => {
  it("runs a leader's lava hotter than a trailer's, at the same moment", () => {
    const heatFor = (local: number, rival: number) => {
      const view = viewWith();
      view.applySnapshot(
        survival([
          playerSnapshot({ id: LOCAL_ID, y: 1000, floorEdgeY: 700, bestFloor: local }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", y: 1000, floorEdgeY: 700, bestFloor: rival }),
        ]),
        LOCAL_ID,
      );
      return view.lava!.heat;
    };
    expect(heatFor(16, 10)).toBeGreaterThan(heatFor(10, 10));
    expect(heatFor(10, 16)).toBeLessThan(heatFor(10, 10));
  });
});

describe("LavaView", () => {
  it("shows the marker, with the floor count, while the surface is below the view", () => {
    const lava = new LavaView(endless);
    lava.update(frame({ edgeY: 1000 - endless.FLOOR_GAP_MAX * 2.5, viewBottomY: 900 }));
    expect(lava.markerFloors).toBe(3);
    expect(lava.marker.visible).toBe(true);
    lava.update(frame({ edgeY: 800, viewBottomY: 700 }));
    expect(lava.markerFloors).toBeUndefined();
    expect(lava.marker.visible).toBe(false);
  });

  it("hides everything with no edge", () => {
    const lava = new LavaView(endless);
    lava.update(frame({ edgeY: undefined }));
    expect(lava.root.visible).toBe(false);
    expect(lava.marker.visible).toBe(false);
  });

  it("throws embers when hot, at most 24, and none under reduced motion", () => {
    const hot = new LavaView(endless);
    for (let i = 0; i < 600; i += 1) hot.update(frame({ rise: 150 }));
    expect(hot.embersLive).toBeGreaterThan(0);
    expect(hot.embersLive).toBeLessThanOrEqual(24);
    const still = new LavaView(endless);
    for (let i = 0; i < 600; i += 1) still.update(frame({ rise: 150, reducedMotion: true }));
    still.splash(0);
    expect(still.embersLive).toBe(0);
  });

  it("shares GraphicsContext across all ember and steam particles", () => {
    const lava = new LavaView(endless);
    const emberLayer = lava.root.children.find((child) => child.label === "lava-embers") as any;
    const steamLayer = lava.root.children.find((child) => child.label === "lava-steam") as any;
    expect(emberLayer.children.length).toBeGreaterThan(1);
    expect(steamLayer.children.length).toBeGreaterThan(1);
    const firstEmberContext = emberLayer.children[0].context;
    for (const child of emberLayer.children) {
      expect(child.context).toBe(firstEmberContext);
    }
    const firstSteamContext = steamLayer.children[0].context;
    for (const child of steamLayer.children) {
      expect(child.context).toBe(firstSteamContext);
    }
  });
});


describe("the lava's spill past the play field", () => {
  // A phone held upright: the visible field ends at 1490, the canvas runs to 1900.
  const spill = (surface: number | undefined): LavaSpillFrame => ({
    surface,
    visibleTop: 0,
    visibleBottom: 1490,
    canvasTop: -150,
    canvasBottom: 1900,
    left: -960,
    right: 1920,
  });

  it("fills from the view's foot to the canvas bottom once the surface is in view", () => {
    expect(lavaSpillBands(spill(1200))).toEqual([{ top: 1490, bottom: 1900 }]);
  });

  it("rises from the bottom of the screen before the surface reaches the field", () => {
    expect(lavaSpillBands(spill(1700))).toEqual([{ top: 1700, bottom: 1900 }]);
  });

  it("covers the whole screen, above the field too, once the lava is over the view", () => {
    expect(lavaSpillBands(spill(-400))).toEqual([
      { top: -150, bottom: 0 },
      { top: 1490, bottom: 1900 },
    ]);
  });

  it("draws nothing with no lava, or with the surface below the screen", () => {
    expect(lavaSpillBands(spill(undefined))).toEqual([]);
    expect(lavaSpillBands(spill(2000))).toEqual([]);
  });

  it("covers the landscape bars: the bands are outside what a player can see, not outside the field", () => {
    // 844 x 390 with bars cropping the field to 24..516 of 0..540, the canvas -42..582.
    const bands = lavaSpillBands({ surface: 300, visibleTop: 24, visibleBottom: 516, canvasTop: -42, canvasBottom: 582, left: -960, right: 1920 });
    expect(bands).toEqual([{ top: 516, bottom: 582 }]);
  });

  it("is parented to the effects below the bars, and hides with the lava", () => {
    const view = viewWith();
    const lava = view.lava!;
    expect(view.feelLayer.children).toContain(lava.spill);
    expect(view.frontLayer.children).not.toContain(lava.spill);
    lava.updateSpill(spill(undefined));
    expect(lava.spill.visible).toBe(false);
    lava.updateSpill(spill(1200));
    expect(lava.spill.visible).toBe(true);
    view.destroy();
  });
});
