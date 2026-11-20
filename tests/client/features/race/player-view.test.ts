import { roleTint } from "@floor-fifty/asset-contract/roles";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Container, Graphics, Text, Texture, TextureSource } from "pixi.js";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { WorldCamera } from "../../../../apps/client/src/features/race/camera";
import { GameplayView } from "../../../../apps/client/src/features/race/gameplay-view";
import {
  ANIMATION_FALLBACK,
  PlayerView, IDLE_BOB_HZ, idleBob, RIVAL_BODY_ALPHA, RIVAL_BODY_TINT } from "../../../../apps/client/src/features/race/player-view";
import type {
  SheetAnimations,
  SheetDataProvider,
  TextureProvider,
} from "../../../../apps/client/src/features/render/textures";
import { emptyTextures, noSheetData } from "../../../../apps/client/src/features/render/textures";
import { NameTag } from "../../../../apps/client/src/features/race/name-tag";

/**
 * The animation table from the manifest the client serves.
 *
 * Read from disk rather than restated, so a retimed row in the art manifest
 * moves this test rather than silently disagreeing with it. Deliberately the
 * *served* manifest and not `assets/art-manifest.json`: this pins what reaches
 * the browser, which is the sync tool's output and a different shape.
 *
 * That output is generated and git-ignored, so a checkout that has never run
 * `pnpm assets:sync` does not have it. Saying so beats an ENOENT from four
 * frames down.
 */
const SERVED_MANIFEST = resolve(
  import.meta.dirname,
  "../../../../apps/client/public/assets/manifest.json",
);

const shippedSheetData: SheetDataProvider = (alias) => {
  if (!existsSync(SERVED_MANIFEST)) {
    throw new Error(
      `${SERVED_MANIFEST} is missing. It is generated and git-ignored; run \`pnpm assets:sync\` first.`,
    );
  }
  const manifest = JSON.parse(readFileSync(SERVED_MANIFEST, "utf8")) as {
    bundles: { assets: { alias: string[]; data?: { animations?: SheetAnimations } }[] }[];
  };

  for (const bundle of manifest.bundles) {
    const asset = bundle.assets.find((entry) => entry.alias.includes(alias));
    if (asset !== undefined) return asset.data?.animations;
  }
  return undefined;
};
import { CAMERA, LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";
import { fontUiFor } from "../../../../apps/client/src/features/i18n/fonts";
import { applyLocale, installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { memoryStorage } from "../../support/fakes/settings";

const tuning = resolveTuning();
const makeView = () =>
  new GameplayView(
    resolveStagePresentation(undefined),
    emptyTextures,
    tuning,
    () => LOCAL_ID,
  );

describe("the world camera", () => {
  it("zooms out while moving and back in while stationary", () => {
    const camera = new WorldCamera();
    camera.update({ moving: true }, 1.0);
    const movingScale = camera.scale;
    camera.update({ moving: false }, 2.0);
    expect(movingScale).toBeGreaterThan(camera.scale);
  });

  it("never reveals more world than one wrap period", () => {
    // The course wraps every viewport width, so a frame wider than that shows
    // the far side of the course beside the near side -- two of the same ninja
    // rather than one cut in half at the edge. The letterbox mask crops at the
    // logical viewport, which is that same width, so holding the zoom inside
    // 1.0 is what lands the crop exactly on the seam.
    //
    // It is the one number here that is not the reference's: `game_camera.rs`
    // zooms to 1.1. The reference can afford it because its window is its play
    // field and it simply pops the player across; a wrap drawn continuously
    // cannot show past the seam at all.
    const camera = new WorldCamera();
    // Far past the point the lerp settles, so this is the widest frame the
    // camera will ever produce.
    camera.update({ moving: true }, 100);

    expect((LOGICAL_VIEWPORT.width / 2) * camera.scale).toBeLessThanOrEqual(VIEWPORT.width / 2);
  });

  it("waits out the stationary delay before settling in", () => {
    const camera = new WorldCamera();
    camera.update({ moving: true }, 1.0);
    const movingScale = camera.scale;
    // Shorter than the dwell the reference requires, so the zoom holds.
    camera.update({ moving: false }, CAMERA.stationaryDelaySeconds / 2);
    expect(camera.scale).toBeCloseTo(movingScale, 1);
  });

  it("never lets a camera effect change logical world coordinates", () => {
    const camera = new WorldCamera();
    const before = camera.worldToLogical({ x: 100, y: 100 });
    camera.update({ moving: true, targetY: 900 }, 1.0);
    expect(camera.worldToLogical({ x: 100, y: 100 })).toEqual(before);
  });

  it("follows the local player vertically without reaching them instantly", () => {
    const camera = new WorldCamera();
    camera.update({ moving: false, targetY: 1000 }, 1 / 60);
    expect(camera.y).toBeGreaterThan(0);
    expect(camera.y).toBeLessThan(1000);
  });

  it("flips the y sign exactly once, at the screen boundary", () => {
    const camera = new WorldCamera();
    camera.reset(0);
    const ground = camera.logicalToScreen({ x: 0, y: 0 });
    const above = camera.logicalToScreen({ x: 0, y: 100 });
    // Logical y points up; screen y points down.
    expect(above.y).toBeLessThan(ground.y);
  });
});

describe("gameplay display reconciliation", () => {
  /**
   * The HUD is not here any more.
   *
   * Three cases used to live at this point, asserting that the drawn HUD stayed
   * in fixed screen coordinates and was never parented under the camera. They
   * are obsolete rather than dropped: the HUD is DOM now, so it is outside the
   * Pixi stage entirely and cannot be reached by the camera transform at all.
   * What they were protecting -- that a readout never moves with the world --
   * is now structural, and `race-hud.test.ts` holds the placement requirement
   * they also carried.
   */

  it("creates one display per player and reuses it across snapshots", () => {
    const view = makeView();
    const players = [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Ninja 2", x: 40 })];

    view.applySnapshot(snapshotAt(10, { players }), LOCAL_ID);
    view.applySnapshot(snapshotAt(13, { players }), LOCAL_ID);

    expect(view.playerCount).toBe(2);
  });

  it("draws each player's character in the player's colour", () => {
    const asked: string[] = [];
    const view = new GameplayView(
      resolveStagePresentation(undefined),
      (alias) => {
        asked.push(alias);
        return Texture.EMPTY;
      },
      tuning,
      () => LOCAL_ID,
      noSheetData,
      { sheetAliasFor: (characterId, colour) => `${characterId}.${colour}` },
    );
    const players = [
      playerSnapshot(),
      playerSnapshot({ id: REMOTE_ID, name: "Frog", characterId: "frog", colour: "cyan", x: 40 }),
    ];

    view.applySnapshot(snapshotAt(10, { players }), LOCAL_ID);

    expect(asked).toContain("ninja.scarlet");
    expect(asked).toContain("frog.cyan");
  });

  it("removes a display for a player who left the room", () => {
    const view = makeView();
    view.applySnapshot(
      snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID })] }),
      LOCAL_ID,
    );
    view.applySnapshot(snapshotAt(13, { players: [playerSnapshot()] }), LOCAL_ID);

    expect(view.playerCount).toBe(1);
  });

  it("creates one display per platform the snapshot carries", () => {
    const view = makeView();
    view.applySnapshot(
      snapshotAt(10, {
        platforms: [
          { id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] },
          { id: "floor-1", x: 50, y: 120, direction: 1, collectedBy: [] },
        ],
      }),
      LOCAL_ID,
    );
    expect(view.platformCount).toBe(2);
  });

  it("draws logical y upward on a screen whose y points down", () => {
    const view = makeView();
    view.applySnapshot(
      snapshotAt(10, { players: [playerSnapshot({ id: LOCAL_ID, y: 500 })] }),
      LOCAL_ID,
    );
    const display = view["players"].displayFor(LOCAL_ID);
    expect(display?.root.position.y).toBe(-500);
  });

  it("fades a ghost rather than moving or removing them", () => {
    const view = makeView();
    view.applySnapshot(
      snapshotAt(10, {
        players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, status: "ghost", x: 90 })],
      }),
      LOCAL_ID,
    );
    const ghost = view["players"].displayFor(asPlayerId(REMOTE_ID));
    expect(ghost?.root.alpha).toBeLessThan(1);
    expect(ghost?.root.position.x).toBe(90);
  });

  it("draws every other racer dimmed and see-through, so your own racer is the one that reads", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 90 })] }), LOCAL_ID);
    const you = view["players"].displayFor(LOCAL_ID)!;
    const rival = view["players"].displayFor(asPlayerId(REMOTE_ID))!;
    expect(you.sprite.alpha).toBe(1);
    expect(you.sprite.tint).toBe(0xffffff);
    for (const sprite of [rival.sprite, rival.wrapped.sprite]) {
      expect(sprite.alpha).toBe(RIVAL_BODY_ALPHA);
      expect(sprite.tint).toBe(RIVAL_BODY_TINT);
    }
    // The nameplate stays solid: who is who still reads at a glance.
    expect(rival.tag.root.alpha).toBe(1);
  });

  it("keeps a rival dimmed through a flicker, the two together", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 90 })] }), LOCAL_ID);
    view.setBodyAlpha(asPlayerId(REMOTE_ID), 0.5);
    expect(view["players"].displayFor(asPlayerId(REMOTE_ID))!.sprite.alpha).toBeCloseTo(0.5 * RIVAL_BODY_ALPHA);
    view.applySnapshot(snapshotAt(11, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 91 })] }), LOCAL_ID);
    expect(view["players"].displayFor(asPlayerId(REMOTE_ID))!.sprite.alpha).toBeCloseTo(0.5 * RIVAL_BODY_ALPHA);
  });

  it("dims nobody when there is no racer of one's own to follow", () => {
    const view = new GameplayView(resolveStagePresentation(undefined), emptyTextures, tuning, () => undefined);
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 90 })] }), undefined);
    expect(view["players"].displayFor(asPlayerId(REMOTE_ID))!.sprite.alpha).toBe(1);
  });

  it("pops a CPU's word over its nameplate in its colour, and lets it go after its moment", () => {
    const view = makeView();
    const snapshot = snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 90, cpu: true, colour: "gold" })] });
    view.applySnapshot(snapshot, LOCAL_ID);
    view.showBark(asPlayerId(REMOTE_ID), "Ta-da!", "gold");
    view.applySnapshot(snapshot, LOCAL_ID, 16);
    const display = view["players"].displayFor(asPlayerId(REMOTE_ID))!;
    const bark = display.bark!;
    expect(bark.root.text).toBe("Ta-da!");
    expect(bark.root.visible).toBe(true);
    expect(bark.root.y).toBeLessThan(display.tag.root.y);
    for (let frame = 0; frame < 100; frame += 1) view.applySnapshot(snapshot, LOCAL_ID, 16);
    expect(bark.root.visible).toBe(false);
  });

  it("keeps a CPU's word below the HUD (owner: the HUD covered it)", () => {
    const view = makeView();
    const snapshot = snapshotAt(10, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, x: 90, cpu: true, colour: "gold" })] });
    view.applySnapshot(snapshot, LOCAL_ID);
    view.showBark(asPlayerId(REMOTE_ID), "Ta-da!", "gold");
    view.applySnapshot(snapshot, LOCAL_ID, 200);
    const display = view["players"].displayFor(asPlayerId(REMOTE_ID))!;
    const bark = display.bark!;
    // A HUD whose bottom sits level with the nameplate.
    const ceiling = display.tag.root.y;
    view["players"].setBarkCeiling(ceiling);
    view.applySnapshot(snapshot, LOCAL_ID, 16);
    expect(bark.root.y - bark.root.height).toBeGreaterThanOrEqual(ceiling);
  });

  it("dims the body and never the nameplate", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot()] }), LOCAL_ID);
    view.setBodyAlpha(LOCAL_ID, 0.2);
    const display = view["players"].displayFor(LOCAL_ID)!;
    expect(display.sprite.alpha).toBe(0.2);
    expect(display.wrapped.sprite.alpha).toBe(0.2);
    expect(display.tag.root.alpha).toBe(1);
    expect(display.root.alpha).toBe(1);
  });
});

describe("drawing the local player ahead of authority", () => {
  it("draws the local player where prediction puts them, not the delayed sample", () => {
    // The local ninja is the one the player is steering. Drawing it from the
    // same delayed sample as everyone else is what makes the controls feel
    // detached from it.
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    players.apply(
      [
        playerSnapshot({ id: LOCAL_ID, x: 0, y: 0 }),
        playerSnapshot({ id: REMOTE_ID, x: 100, y: 0 }),
      ],
      16.67,
      LOCAL_ID,
      { x: 55, y: 20, vx: 0, vy: 0, facingRight: true },
    );

    expect(players.displayFor(LOCAL_ID)?.root.position.x).toBeCloseTo(55);
    expect(players.displayFor(LOCAL_ID)?.root.position.y).toBeCloseTo(-20);
  });

  it("leaves every other player exactly where authority put them", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    players.apply(
      [
        playerSnapshot({ id: LOCAL_ID, x: 0, y: 0 }),
        playerSnapshot({ id: REMOTE_ID, x: 100, y: 40 }),
      ],
      16.67,
      LOCAL_ID,
      { x: 55, y: 20, vx: 0, vy: 0, facingRight: true },
    );

    expect(players.displayFor(REMOTE_ID)?.root.position.x).toBeCloseTo(100);
    expect(players.displayFor(REMOTE_ID)?.root.position.y).toBeCloseTo(-40);
  });

  it("falls back to authority when there is nothing predicted yet", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    players.apply([playerSnapshot({ id: LOCAL_ID, x: 7, y: 9 })], 16.67, LOCAL_ID);

    expect(players.displayFor(LOCAL_ID)?.root.position.x).toBeCloseTo(7);
  });

  it("follows the predicted height with the camera, not the delayed one", () => {
    // A camera that tracked the delayed sample would leave the predicted sprite
    // sliding around inside the frame.
    const view = makeView();
    view.applySnapshot(
      snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }),
      LOCAL_ID,
      1000,
      { x: 0, y: 500, vx: 0, vy: 0, facingRight: true },
    );

    expect(view.camera.y).toBeGreaterThan(100);
  });
});

describe("scenery outside the play area", () => {
  it("keeps the parallax out of the clipped world so it can fill the canvas", () => {
    // Platforms and players must stay inside the letterbox, or a tall phone
    // sees more course than a wide one. The scenery has no such constraint.
    const view = makeView();

    for (const parallax of [view.skyParallax, view.cityParallax]) {
      expect(parallax.parent).not.toBe(view.world);
      expect(view.world.children).not.toContain(parallax);
    }
  });

  it("moves both scenery roots with the camera exactly as it moves the world", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 400 } }), LOCAL_ID, 1000);

    expect(view.skyParallax.position.x).toBeCloseTo(view.world.position.x);
    expect(view.skyParallax.position.y).toBeCloseTo(view.world.position.y);
    // The city lands on a whole device pixel, so it agrees to within half of one.
    expect(Math.abs(view.cityParallax.position.x - view.world.position.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(view.cityParallax.position.y - view.world.position.y)).toBeLessThanOrEqual(0.5);
    for (const parallax of [view.skyParallax, view.cityParallax]) {
      expect(parallax.scale.x).toBeCloseTo(view.world.scale.x);
    }
  });
});

describe("the crisp city's placement", () => {
  it("puts the city root on a whole device pixel at the stage's density", () => {
    const view = makeView();
    view.setPixelDensity(1.6);
    view.applySnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 413.3 } }), LOCAL_ID, 1000);

    for (const value of [view.cityParallax.position.x, view.cityParallax.position.y]) {
      expect(Math.abs(value * 1.6 - Math.round(value * 1.6))).toBeLessThan(1e-6);
    }
    // Still with the world to within a device pixel.
    expect(Math.abs(view.cityParallax.position.y - view.world.position.y)).toBeLessThanOrEqual(0.5 / 1.6 + 1e-9);
  });
});

describe("animation states", () => {
  // `PlayerView` takes three arguments: the texture provider, the tuning, and
  // a getter for the local player's id.
  const makePlayerView = () => new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);

  /**
   * Drives a view along one real bounce and returns the pose drawn each frame.
   *
   * The arc is integrated from the same tuning the server steps with, because
   * the poses only misread on the shape the game actually produces: a bounce
   * under `GRAVITY` spends a fifth of a second near its apex, and a rule that
   * cannot tell that apex from a floor is what this fixture exists to catch.
   *
   * `vy` travels with each frame because that is what the server sends and what
   * the pose is read from; the positions are still integrated from it so the
   * two agree the way a real snapshot's do.
   */
  const arc = (hz: number, seconds: number, x: (frame: number) => number = () => 0): string[] => {
    const t = resolveTuning();
    const view = makePlayerView();
    const dt = 1 / hz;
    let y = 0;
    let vy = t.BOUNCE_VELOCITY;
    const poses: string[] = [];
    for (let frame = 0; frame < Math.round(hz * seconds); frame += 1) {
      vy += t.GRAVITY * dt;
      y += vy * dt;
      view.apply([playerSnapshot({ x: x(frame), y, vy })], dt * 1000, LOCAL_ID, undefined);
      poses.push(`${view.animationOf(LOCAL_ID)}`);
    }
    return poses;
  };

  /** The distinct poses in the order they were drawn, runs collapsed. */
  const sequence = (poses: readonly string[]): string[] =>
    poses.filter((pose, index) => pose !== poses[index - 1]);

  // No leading `idle` any more. It was the frame the display was created on,
  // which had no previous position to measure a speed against; `vy` arrives
  // with the first snapshot, so the first drawn frame already knows the racer
  // is rising. The canvas is only ever entered on `racing` (`main-menu.ts`),
  // so that first frame is a bounce in progress rather than a standing start.
  const AIRBORNE = ["jump", "fall"];

  it("holds the airborne pose across the apex instead of touching down in mid-air", () => {
    // The apex is where a bounce's vertical speed passes through zero. A rule
    // that reads "barely moving" as "standing on a floor" fires there, on every
    // single bounce, a fifth of a second before the fall even begins.
    expect(sequence(arc(60, 2))).toEqual(AIRBORNE);
  });

  it("reads the same way however fast the display refreshes", () => {
    // The dead zone of a per-frame distance threshold widens with the refresh
    // rate, so the same bounce read worse on a better monitor.
    expect(sequence(arc(120, 2))).toEqual(AIRBORNE);
    expect(sequence(arc(144, 2))).toEqual(AIRBORNE);
  });

  it("never lands at the top of an arc", () => {
    for (const hz of [60, 120, 144]) expect(arc(hz, 2)).not.toContain("land");
  });

  it("lands where a descent reverses, which is what a floor does here", () => {
    // Every floor contact sets `vy` to `BOUNCE_VELOCITY` (`collision.ts`), so a
    // landing in this game *is* the moment a fall turns into a rise. Nothing
    // else produces that reversal.
    const view = makePlayerView();
    const t = resolveTuning();
    const step = (y: number, vy: number): void => {
      view.apply([playerSnapshot({ x: 0, y, vy })], 16.67, LOCAL_ID, undefined);
    };

    step(100, -200);
    step(80, -200);
    step(60, -200);
    expect(view.animationOf(LOCAL_ID)).toBe("fall");

    // The bounce, which is the contact setting `vy` to `BOUNCE_VELOCITY`.
    step(64, t.BOUNCE_VELOCITY);
    expect(view.animationOf(LOCAL_ID)).toBe("land");
  });

  it("returns to the rise once the landing pose has played out", () => {
    const view = makePlayerView();
    const t = resolveTuning();
    const step = (y: number, vy: number, ms = 16.67): void => {
      view.apply([playerSnapshot({ x: 0, y, vy })], ms, LOCAL_ID, undefined);
    };

    step(100, -200);
    step(60, -200);
    step(64, t.BOUNCE_VELOCITY);
    expect(view.animationOf(LOCAL_ID)).toBe("land");

    // Still climbing, but past the landing flourish's declared length.
    let y = 64;
    for (let frame = 0; frame < 30; frame += 1) {
      y += (t.BOUNCE_VELOCITY * 16.67) / 1000;
      step(y, t.BOUNCE_VELOCITY);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("jump");
  });

  it("idles a player authority is holding still", () => {
    // A finished racer is the only stillness this canvas ever draws -- the
    // countdown is the lobby's screen, not this one -- and it is the only thing
    // `idle` is for.
    const view = makePlayerView();
    for (let frame = 0; frame < 60; frame += 1) {
      view.apply([playerSnapshot({ x: 0, y: 0 })], 16.67, LOCAL_ID, undefined);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("idle");
  });

  it("runs a still player who is moving horizontally", () => {
    const view = makePlayerView();
    const t = resolveTuning();
    for (let frame = 0; frame < 60; frame += 1) {
      view.apply(
        [playerSnapshot({ x: (frame * t.MAX_MOVE_SPEED * 16.67) / 1000, y: 0 })],
        16.67,
        LOCAL_ID,
        undefined,
      );
    }
    expect(view.animationOf(LOCAL_ID)).toBe("run");
  });

  it("keeps falling when the feed stalls rather than landing on the spot", () => {
    // Past its newest snapshot the buffer holds rather than extrapolating, so a
    // dropped packet freezes a player's position for a few frames. Reading that
    // freeze as a touchdown drops a landing pose into open air.
    const view = makePlayerView();
    // The held snapshot holds its `vy` along with its position, which is what
    // keeps the stall reading as the fall it is.
    const vy = -180;
    let y = 200;
    for (let frame = 0; frame < 10; frame += 1) {
      y -= 3;
      view.apply([playerSnapshot({ x: 0, y, vy })], 16.67, LOCAL_ID, undefined);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("fall");

    for (let frame = 0; frame < 6; frame += 1) {
      view.apply([playerSnapshot({ x: 0, y, vy })], 16.67, LOCAL_ID, undefined);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("fall");
  });

  it("plays the landing flourish when vy reverses, wherever the sprite is drawn", () => {
    const view = makePlayerView();

    // Falling, then a contact: vy flips negative to positive. The drawn
    // position deliberately does not move, so a pose read from pixel deltas
    // sees nothing happen and reports a rest instead of a landing.
    view.apply([playerSnapshot({ vy: -200 })], 16, LOCAL_ID, {
      x: 0,
      y: 0,
      vx: 0,
      vy: -200,
      facingRight: true,
    });
    view.apply([playerSnapshot({ vy: 268.2 })], 16, LOCAL_ID, {
      x: 0,
      y: 0,
      vx: 0,
      vy: 268.2,
      facingRight: true,
    });

    expect(view.animationOf(LOCAL_ID)).toBe("land");
  });

  it("holds the crouch, still, while a fast fall pins the racer to a floor", () => {
    // Holding fast fall on a floor stops the ascent: authority keeps `vy` at
    // the fast-fall speed and the racer sits flush on the roof. Read by
    // travel alone that is a fall.
    const t = resolveTuning();
    const view = makePlayerView();
    const floor = { x: 0, y: 0 };
    const y = (t.FLOOR_HEIGHT + t.PLAYER_HEIGHT) / 2;
    for (let frame = 0; frame < 30; frame += 1) {
      view.apply([playerSnapshot({ x: 0, y, vy: t.FAST_FALL_VELOCITY })], 16.67, LOCAL_ID, undefined, [floor]);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("land");
    expect(view.displayFor(LOCAL_ID)?.held).toBe(true);

    // Released, the next contact bounces them off the roof as usual.
    view.apply([playerSnapshot({ x: 0, y, vy: t.BOUNCE_VELOCITY })], 16.67, LOCAL_ID, undefined, [floor]);
    expect(view.displayFor(LOCAL_ID)?.held).toBe(false);
    for (let frame = 0; frame < 30; frame += 1) {
      view.apply([playerSnapshot({ x: 0, y: y + 40, vy: t.BOUNCE_VELOCITY })], 16.67, LOCAL_ID, undefined, [floor]);
    }
    expect(view.animationOf(LOCAL_ID)).toBe("jump");
  });

  it("still falls past a floor it is not standing on", () => {
    const t = resolveTuning();
    const view = makePlayerView();
    const beside = { x: t.FLOOR_WIDTH + t.PLAYER_WIDTH, y: 0 };
    const y = (t.FLOOR_HEIGHT + t.PLAYER_HEIGHT) / 2;
    view.apply([playerSnapshot({ x: 0, y, vy: t.FAST_FALL_VELOCITY })], 16.67, LOCAL_ID, undefined, [beside]);
    expect(view.animationOf(LOCAL_ID)).toBe("fall");
  });

  it("stands the sprite on the collider's floor, and hangs a ceiling grip from its top", () => {
    const t = resolveTuning();
    const view = makePlayerView();
    const floor = { x: 0, y: 0 };
    const below = -(t.FLOOR_HEIGHT + t.PLAYER_HEIGHT) / 2;

    view.apply([playerSnapshot({ x: 0, y: -200, vy: 200 })], 16, LOCAL_ID, undefined, [floor]);
    const sprite = view.displayFor(LOCAL_ID)!.sprite;
    expect(sprite.anchor.y).toBe(1);
    expect(sprite.y).toBeCloseTo(t.PLAYER_HEIGHT / 2);

    view.apply([playerSnapshot({ x: 0, y: below, vy: 200 })], 16, LOCAL_ID, undefined, [floor]);
    expect(view.animationOf(LOCAL_ID)).toBe("ceiling");
    expect(sprite.anchor.y).toBe(0);
    expect(sprite.y).toBeCloseTo(-t.PLAYER_HEIGHT / 2);
    // The copy across the seam stands the same way.
    expect(view.displayFor(LOCAL_ID)!.wrapped.sprite.y).toBe(sprite.y);
  });

  it("does not read a landing from horizontal drift in open air", () => {
    const view = makePlayerView();

    view.apply([playerSnapshot({ vy: -200 })], 16, LOCAL_ID, {
      x: 0,
      y: 0,
      vx: 0,
      vy: -200,
      facingRight: true,
    });
    view.apply([playerSnapshot({ vy: -200 })], 16, LOCAL_ID, {
      x: 60,
      y: 0,
      vx: 0,
      vy: -200,
      facingRight: true,
    });

    expect(view.animationOf(LOCAL_ID)).toBe("fall");
  });

  it("mirrors the local player from the prediction, not the delayed snapshot", () => {
    // Position leads authority and facing did not, so turning around drew a
    // sprite sliding one way while still facing the other for the whole
    // interpolation delay -- the same sprite-lying this prediction exists to
    // end, just on the other axis.
    const view = makePlayerView();

    view.apply([playerSnapshot({ facingRight: true })], 16, LOCAL_ID, {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facingRight: false,
    });

    expect(view.displayFor(LOCAL_ID)!.sprite.scale.x).toBeLessThan(0);
  });

  it("still mirrors everybody else from the wire, so a turn looks the same to the room", () => {
    const view = makePlayerView();

    view.apply([playerSnapshot({ id: REMOTE_ID, facingRight: false })], 16, LOCAL_ID, {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facingRight: true,
    });

    expect(view.displayFor(REMOTE_ID)!.sprite.scale.x).toBeLessThan(0);
  });

  it("reads a remote player's pose from the snapshot's vy, not its drawn motion", () => {
    const view = makePlayerView();
    const remote = (vy: number) => [playerSnapshot({ id: REMOTE_ID, vy })];

    view.apply(remote(-200), 16, LOCAL_ID, undefined);
    view.apply(remote(268.2), 16, LOCAL_ID, undefined);

    expect(view.animationOf(REMOTE_ID)).toBe("land");
  });

  it("cycles airborne frames at the manifest's duration", () => {
    // Driven from the manifest the client actually ships, so this pins the
    // whole chain -- art manifest, `sync-client-assets`, bundle `data` -- and
    // not a copy of it. The airborne poses are deliberately quick: a bounce's
    // whole rise lasts about a second, so a slow cycle would barely read as
    // motion. Idle is the opposite, and deliberately slow: a held pose wants a
    // long dwell, which is what makes pose-to-pose read as intended rather
    // than as dropped frames.
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID, shippedSheetData);

    expect(view.durationFor("jump")).toBe(200);
    expect(view.durationFor("fall")).toBe(200);
    expect(view.durationFor("land")).toBe(220);
    expect(view.durationFor("run")).toBe(400);
    expect(view.durationFor("idle")).toBe(900);
    expect(view.framesFor("run")).toBe(4);
  });

  it("reads its timing from the sheet rather than from a copy of it", () => {
    // The manifest is the art contract's source of truth for frame counts and
    // cycle lengths. A table in this file that happened to agree with it would
    // stop agreeing the first time an artist retimed a row, and nothing would
    // say so.
    const view = new PlayerView(
      emptyTextures,
      resolveTuning(),
      () => LOCAL_ID,
      () => ({ idle: { frames: 4, durationMs: 900 }, jump: { frames: 3, durationMs: 120 } }),
    );

    expect(view.durationFor("idle")).toBe(900);
    expect(view.durationFor("jump")).toBe(120);
    expect(view.framesFor("jump")).toBe(3);
  });

  it("falls back to the art contract's grid for a sheet that declares none", () => {
    // A resolver that goes quiet must not freeze every player on frame zero,
    // so the fallback is a plausible character rather than a still.
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID, noSheetData);
    expect(view.durationFor("land")).toBe(220);
    expect(view.framesFor("land")).toBe(2);
  });
});

describe("the wrapping seam", () => {
  // The course wraps with a period of one viewport width, so a player near an
  // edge is genuinely at two places at once. Drawing only one of them is what
  // makes the crossing a pop: the reference pops too, it just hides more of the
  // sprite behind the screen edge when it does.
  const makePlayerView = () => new PlayerView(emptyTextures, tuning, () => LOCAL_ID);

  it("draws a wrapped copy a viewport width left of a player near the right seam", () => {
    const view = makePlayerView();
    view.apply([playerSnapshot({ x: 470, y: 0 })], 16, LOCAL_ID);

    expect(view.displayFor(LOCAL_ID)?.wrapped.root.position.x).toBeCloseTo(470 - LOGICAL_VIEWPORT.width);
  });

  it("puts the copy on the far side for a player near the left seam", () => {
    const view = makePlayerView();
    view.apply([playerSnapshot({ x: -470, y: 0 })], 16, LOCAL_ID);

    expect(view.displayFor(LOCAL_ID)?.wrapped.root.position.x).toBeCloseTo(
      -470 + LOGICAL_VIEWPORT.width,
    );
  });

  it("draws the copy as the same picture as the player it copies", () => {
    // A copy stuck on frame zero, facing the wrong way, or drawn solid for a
    // ghost would announce itself as a copy the moment it crossed the seam.
    // A real sheet, not `emptyTextures`: `frameOf` short-circuits on
    // `Texture.EMPTY`, so every cell of an empty sheet is the same object and
    // an assertion about which frame is drawn could not fail.
    // The contract's grid: four run frames across, five animation rows down,
    // at the 32-pixel frame the sheets are authored in.
    const source = new TextureSource({ width: 32 * 4, height: 32 * 5 });
    const sheet = new Texture({ source });
    const textures: TextureProvider = () => sheet;
    const view = new PlayerView(textures, tuning, () => LOCAL_ID);
    const player = playerSnapshot({ x: 470, y: 40, facingRight: false, status: "ghost" });
    view.apply([player], 16, LOCAL_ID);
    // Past the first cell of the cycle, so the assertion below cannot pass on a
    // copy that was never advanced. Taken from the contract's own timing: a
    // held pose dwells longer than a frame of a smooth cycle.
    view.apply(
      [player],
      // Three quarters through, not a whole cycle: a full dwell wraps back
    // onto frame zero and the assertion would fail for the wrong reason.
    ANIMATION_FALLBACK["idle"]!.durationMs * 0.75,
      LOCAL_ID,
    );

    const display = view.displayFor(LOCAL_ID)!;
    expect(display.sprite.texture).not.toBe(display.frames.frame(0, 0));
    expect(display.wrapped.sprite.texture).toBe(display.sprite.texture);
    expect(display.wrapped.sprite.scale.x).toBeCloseTo(display.sprite.scale.x);
    expect(display.wrapped.root.alpha).toBeCloseTo(display.root.alpha);
  });

  it("draws the same two positions either side of the wrap itself", () => {
    // The point of the copy. When the player wraps, the sprite and the copy
    // trade places, so the pair of positions on screen shifts by one tick of
    // movement and nothing jumps: the crossing stops being an event the eye
    // can catch.
    const view = makePlayerView();
    const drawnXs = (): number[] => {
      const display = view.displayFor(LOCAL_ID)!;
      return [display.root.position.x, display.wrapped.root.position.x].sort((a, b) => a - b);
    };

    const step = 0.2;
    view.apply([playerSnapshot({ x: LOGICAL_VIEWPORT.width / 2 - step, y: 0 })], 16, LOCAL_ID);
    const before = drawnXs();
    // One tick later the simulation has wrapped them to the far edge.
    view.apply([playerSnapshot({ x: -LOGICAL_VIEWPORT.width / 2 + step, y: 0 })], 16, LOCAL_ID);
    const after = drawnXs();

    expect(after[0]! - before[0]!).toBeCloseTo(2 * step);
    expect(after[1]! - before[1]!).toBeCloseTo(2 * step);
  });
});


it("keeps the fallback animation table in step with the manifest", () => {
  // The fallback exists so an undeclared sheet does not freeze every player on
  // frame zero. A fallback that disagrees with the contract is worse than
  // none, so it is pinned rather than trusted.
  const manifest = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "packages/asset-contract/assets/art-manifest.json"),
      "utf8",
    ),
  );
  const ninja = manifest.bundles.shell.find(
    (a: { alias: string }) => a.alias === "ninja.scarlet",
  );
  for (const [name, row] of Object.entries(ninja.animations) as [string, { frames: number }][]) {
    expect(ANIMATION_FALLBACK[name]?.frames).toBe(row.frames);
  }
});

describe("de-stacked nameplates", () => {
  const plateOf = (view: PlayerView, id: string) => view.displayFor(asPlayerId(id))!.tag.root;

  it("shows the local plate and one ×4 chip for four racers in one spot", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    const racers = [LOCAL_ID, "p2", "p3", "p4"].map((id, index) =>
      playerSnapshot({ id: asPlayerId(id), name: `R${index}`, x: 100 + index, y: 200 }),
    );

    view.apply(racers, 100, LOCAL_ID);
    view.apply(racers, 100, LOCAL_ID);

    expect(plateOf(view, LOCAL_ID).visible).toBe(true);
    for (const id of ["p2", "p3", "p4"]) expect(plateOf(view, id).visible, id).toBe(false);
    const chips = view.tags.children.filter((child) => child.label === "nameplate-chip" && child.visible);
    expect(chips).toHaveLength(1);
    const chip = chips[0] as Container;
    const plate = chip.getChildByLabel("nameplate-chip-plate") as Graphics;
    const count = chip.getChildByLabel("nameplate-chip-count") as Text;
    expect(count?.text).toBe("×4");
    expect(plate?.alpha, "cluster count has an opaque backing over the sun").toBe(1);
    expect(plate?.fillStyle.color).toBe(roleTint("uiChipFill"));
    expect(count.style.fill).toBe(roleTint("uiText"));
  });

  it("keeps the count above a fourth-seat local plate at phone scale", () => {
    const local = asPlayerId("p4");
    const view = new PlayerView(emptyTextures, resolveTuning(), () => local);
    view.setTagScale(3);
    const racers = [LOCAL_ID, "p2", "p3", local].map((id, index) =>
      playerSnapshot({ id: asPlayerId(id), name: `R${index}`, x: 100 + index, y: 200 }),
    );
    view.apply(racers, 100, local);
    view.apply(racers, 100, local);
    const chip = view.tags.children.find((child) => child.label === "nameplate-chip" && child.visible)!;
    const plate = plateOf(view, local);
    expect(chip.getBounds().maxY).toBeLessThan(plate.getBounds().minY);
  });

  it("gives every racer its plate back once they spread out", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    const at = (spread: number) =>
      [LOCAL_ID, "p2"].map((id, index) =>
        playerSnapshot({ id: asPlayerId(id), name: `R${index}`, x: index * spread, y: 0 }),
      );
    view.apply(at(1), 200, LOCAL_ID);
    view.apply(at(1), 200, LOCAL_ID);
    view.apply(at(400), 200, LOCAL_ID);
    view.apply(at(400), 200, LOCAL_ID);

    expect(plateOf(view, "p2").visible).toBe(true);
    expect(view.tags.children.filter((child) => child.label === "nameplate-chip" && child.visible)).toEqual([]);
  });
});

describe("portrait framing", () => {
  // A 390 x 844 phone: the canvas measured in logical units around the field.
  const SCENERY = { y: -148, height: 2077 };

  it("holds the racer at the field's middle and sinks the city into the lower third", () => {
    const view = makeView();
    view.setFraming(true, SCENERY, 540);
    view.applySnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }), LOCAL_ID, 5000);

    // The racer at y = 0 is drawn at the world's own origin.
    expect(view.world.position.y).toBeCloseTo(LOGICAL_VIEWPORT.height / 2, 0);

    const lowerThird = SCENERY.y + (SCENERY.height * 2) / 3;
    const root = view.cityParallax;
    for (const child of root.children.filter((c) => !c.label.endsWith(".skirt"))) {
      const top = root.position.y + root.scale.y * (child.position.y - (child as unknown as { height: number }).height);
      expect(top, child.label).toBeGreaterThanOrEqual(lowerThird - 1);
    }
  });

  it("changes nothing in landscape", () => {
    const view = makeView();
    view.setFraming(false, { y: 0, height: 540 }, 540);
    view.applySnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }), LOCAL_ID, 5000);

    expect(view.world.position.y).toBeCloseTo(LOGICAL_VIEWPORT.height / 2, 0);
  });

  it("scales tags up so they are at least nine css px on a portrait phone", () => {
    const view = makeView();
    view.setFraming(true, SCENERY, 540, true);
    view.setCssPerUnit(390 / 960);
    view.applySnapshot(snapshotAt(10, { player: { id: LOCAL_ID, x: 0, y: 0 } }), LOCAL_ID, 16);
    const tag = view["players"].displayFor(LOCAL_ID)!.tag;
    const onScreen = tag.root.scale.x * view.world.scale.x * (390 / 960) * 11;
    expect(onScreen).toBeGreaterThanOrEqual(9 - 1e-6);
    view.destroy();
  });
});

describe("the standing-idle bob", () => {
  it("lifts by whole pixels, at most 2, at 1.25 Hz", () => {
    const period = 1000 / IDLE_BOB_HZ;
    const samples = Array.from({ length: 40 }, (_, index) => idleBob((index * period) / 40, false));
    expect(new Set(samples)).toEqual(new Set([0, -1, -2]));
    expect(idleBob(0, false)).toBe(0);
    expect(idleBob(period / 2, false)).toBe(-2);
  });

  it("is still under reduced motion", () => {
    expect(idleBob(200, true)).toBe(0);
  });
});

describe("squash (polish spec §4.1)", () => {
  const draw = (players: PlayerView, facingRight = true) =>
    players.apply([playerSnapshot({ id: LOCAL_ID, x: 0, y: 0, facingRight })], 16.67, LOCAL_ID);

  it("squashes the sprite about its feet, and never the nameplate", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    draw(players);
    const display = players.displayFor(LOCAL_ID)!;
    const base = { x: display.sprite.scale.x, y: display.sprite.scale.y, feet: display.sprite.y, plate: display.tag.root.scale.y };

    players.setSquash(LOCAL_ID, 1.3, 0.7);
    draw(players);
    expect(display.sprite.scale.y).toBeCloseTo(base.y * 0.7);
    expect(display.sprite.scale.x).toBeCloseTo(base.x * 1.3);
    expect(display.sprite.y).toBe(base.feet);
    expect(display.tag.root.scale.y).toBe(base.plate);
  });

  it("does not compound from frame to frame", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    draw(players);
    const display = players.displayFor(LOCAL_ID)!;
    const baseY = display.sprite.scale.y;
    players.setSquash(LOCAL_ID, 1.3, 0.7);
    draw(players);
    draw(players);
    expect(display.sprite.scale.y).toBeCloseTo(baseY * 0.7);
    players.setSquash(LOCAL_ID, 1, 1);
    draw(players);
    expect(display.sprite.scale.y).toBeCloseTo(baseY);
  });

  it("keeps the facing sign under squash, and squashes the seam copy alike", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    draw(players, false);
    players.setSquash(LOCAL_ID, 1.2, 0.8);
    draw(players, false);
    const display = players.displayFor(LOCAL_ID)!;
    expect(display.sprite.scale.x).toBeLessThan(0);
    expect(display.wrapped.sprite.scale.y).toBeCloseTo(display.sprite.scale.y);
  });

  it("ignores a squash for a racer it is not drawing", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    expect(() => players.setSquash(REMOTE_ID as never, 1.2, 0.8)).not.toThrow();
  });

  it("skews a racer's sprite and its seam copy by its lean, and leaves the name tag upright (Wonder spec §4.1)", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    draw(players);
    const display = players.displayFor(LOCAL_ID)!;
    players.setLean(LOCAL_ID, -0.2);
    draw(players);
    expect(display.sprite.skew.x).toBeCloseTo(-0.2);
    expect(display.wrapped.sprite.skew.x).toBeCloseTo(-0.2);
    expect(display.tag.root.skew.x).toBe(0);
    players.setLean(LOCAL_ID, 0);
    draw(players);
    expect(display.sprite.skew.x).toBe(0);
  });

  it("ignores a lean for a racer it is not drawing", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    expect(() => players.setLean(REMOTE_ID as never, 0.2)).not.toThrow();
  });
});

describe("hit-stop (polish spec §4.2, D-P5)", () => {
  it("freezes the camera's follow, and lets it resume after", () => {
    const camera = new WorldCamera();
    camera.update({ moving: true, targetY: 0 }, 1 / 60);
    camera.setFrozen(true);
    const before = camera.transform();
    camera.update({ moving: true, targetY: 500 }, 1 / 60);
    expect(camera.transform()).toEqual(before);
    camera.setFrozen(false);
    camera.update({ moving: true, targetY: 500 }, 1 / 60);
    expect(camera.transform().y).not.toBe(before.y);
  });

  it("holds the racer's animation frame, and keeps drawing its position", () => {
    const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
    players.apply([playerSnapshot({ id: LOCAL_ID, x: 0, y: 0, vy: 300 })], 16.67, LOCAL_ID);
    const display = players.displayFor(LOCAL_ID)!;
    players.setHitStop(LOCAL_ID, true);
    const pose = { animation: display.animation, elapsedMs: display.elapsedMs };
    players.apply([playerSnapshot({ id: LOCAL_ID, x: 30, y: 12, vy: -300 })], 16.67, LOCAL_ID);
    expect(display.root.position.x).toBe(30);
    expect(display.root.position.y).toBe(-12);
    expect({ animation: display.animation, elapsedMs: display.elapsedMs }).toEqual(pose);
    // Released, the pose catches up with the fall it was held through.
    players.setHitStop(LOCAL_ID, false);
    players.apply([playerSnapshot({ id: LOCAL_ID, x: 30, y: 12, vy: -300 })], 16.67, LOCAL_ID);
    expect(pose.animation).toBe("jump");
    expect(display.animation).toBe("fall");
  });

  it("is taken by the view for the local racer and the camera together", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot()] }), LOCAL_ID);
    view.setHitStop(true);
    expect(view["players"]["frozen"]).toBe(LOCAL_ID);
    expect(view["camera"]["frozen"]).toBe(true);
    view.setHitStop(false);
    expect(view["players"]["frozen"]).toBeUndefined();
    expect(view["camera"]["frozen"]).toBe(false);
  });
});

describe("the slam's camera kick (polish spec §4.2)", () => {
  it("moves the world down by the kick, on top of the pulse, and back", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot()] }), LOCAL_ID);
    const restY = view.world.position.y;
    view.setKick(6);
    view.applySnapshot(snapshotAt(11, { players: [playerSnapshot()] }), LOCAL_ID);
    const kickedY = view.world.position.y;
    view.setKick(0);
    view.applySnapshot(snapshotAt(12, { players: [playerSnapshot()] }), LOCAL_ID);
    expect(kickedY - view.world.position.y).toBeCloseTo(6, 0);
    expect(view.world.position.y).toBeCloseTo(restY, 0);
  });

  it("draws the wrap streak behind the racers", () => {
    const view = makeView();
    const order = view.world.children;
    expect(order.indexOf(view.streakLayer)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(view.streakLayer)).toBeLessThan(order.findIndex((child) => child.label === "players"));
  });
});

describe("the juice's place in the world (polish spec §4.1)", () => {
  it("draws the dust over the floors and the racers, inside the world container", () => {
    const view = makeView();
    const order = view.world.children;
    expect(order.indexOf(view.dustLayer)).toBeGreaterThan(order.findIndex((child) => child.label === "players"));
  });

  it("hands a squash to the racer it names", () => {
    const view = makeView();
    view.applySnapshot(snapshotAt(10, { players: [playerSnapshot()] }), LOCAL_ID);
    const display = view["players"].displayFor(LOCAL_ID)!;
    const baseY = display.sprite.scale.y;
    view.setSquash(LOCAL_ID, 1.3, 0.7);
    view.applySnapshot(snapshotAt(11, { players: [playerSnapshot()] }), LOCAL_ID);
    expect(display.sprite.scale.y).toBeCloseTo(baseY * 0.7);
  });
});

describe("nameplates in the player's script (languages plan, review focus 1)", () => {
  it("restyles every nameplate in the new locale's face when the language changes mid-race", async () => {
    const settings = new SettingsStore(memoryStorage());
    const undo = installLocaleStrategy(settings, () => ["en"]);
    try {
      const players = new PlayerView(emptyTextures, tuning, () => LOCAL_ID);
      const racers = [playerSnapshot({ id: LOCAL_ID, x: 0, y: 0 }), playerSnapshot({ id: REMOTE_ID, name: "한결", x: 100, y: 0 })];
      players.apply(racers, 16.67, LOCAL_ID);
      const face = (tag: NameTag) => (tag.root.getChildByLabel("name-tag-name") as Text).style.fontFamily;
      expect(face(players.displayFor(asPlayerId(REMOTE_ID))!.tag)).toBe(fontUiFor("en"));

      await applyLocale("ko");
      players.apply(racers, 16.67, LOCAL_ID);

      for (const id of [LOCAL_ID, REMOTE_ID]) {
        const display = players.displayFor(asPlayerId(id))!;
        expect(face(display.tag)).toBe(fontUiFor("ko"));
        expect(face(display.wrapped.tag)).toBe(fontUiFor("ko"));
      }
    } finally {
      undo();
    }
  });
});

describe("name tags and draw order", () => {
  const four = () =>
    [LOCAL_ID, "p2", "p3", "p4"].map((id, index) =>
      playerSnapshot({ id: asPlayerId(id), name: index === 0 ? "Wolfgang-Amadeus" : `R${index}`, x: 100, y: 200 }),
    );
  const bodyOf = (view: PlayerView, id: string) => view.bodies.getChildByLabel(id)!;

  it("draws every tag on a layer above every body", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    expect(view.root.children.indexOf(view.tags)).toBeGreaterThan(view.root.children.indexOf(view.bodies));
    expect(view.tags.children.filter((child) => child instanceof Container && child.label === "name-tag").length).toBe(8);
  });

  it("draws the local racer's body and tag above the other three", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    const local = bodyOf(view, LOCAL_ID).zIndex;
    for (const id of ["p2", "p3", "p4"]) expect(bodyOf(view, id).zIndex, id).toBeLessThan(local);
    const tag = view.displayFor(LOCAL_ID)!.tag;
    expect(tag.focused).toBe(true);
    expect(tag.root.zIndex).toBeGreaterThan(view.displayFor(asPlayerId("p4"))!.tag.root.zIndex);
  });

  it("moves the top of the stack to whoever is followed", () => {
    // The replay's localPlayerId() returns the followed racer (features/replay/replay.ts).
    let follow = LOCAL_ID;
    const view = new PlayerView(emptyTextures, resolveTuning(), () => follow);
    view.apply(four(), 16);
    follow = asPlayerId("p3");
    view.apply(four(), 16);
    expect(bodyOf(view, "p3").zIndex).toBeGreaterThan(bodyOf(view, LOCAL_ID).zIndex);
    expect(view.displayFor(asPlayerId("p3"))!.tag.focused).toBe(true);
    expect(view.displayFor(LOCAL_ID)!.tag.focused).toBe(false);
  });

  it("reads the name apart from the seat, cut to twelve characters", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    const tag = view.displayFor(LOCAL_ID)!.tag;
    expect((tag.root.getChildByLabel("name-tag-seat") as Text).text).toBe("1");
    expect((tag.root.getChildByLabel("name-tag-name") as Text).text).toBe("Wolfgang-Ama…");
  });

  it("keeps each tag over its racer, in the racer's seat lane", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    const body = bodyOf(view, "p2");
    const tag = view.displayFor(asPlayerId("p2"))!.tag;
    expect(tag.root.x).toBeCloseTo(body.x);
    expect(tag.root.y).toBeLessThan(body.y);
  });

  it("scales every tag together", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    view.setTagScale(2);
    view.apply(four(), 16, LOCAL_ID);
    expect(view.displayFor(asPlayerId("p2"))!.tag.root.scale.x).toBe(2);
  });

  it("is a NameTag, so the DOM pill and the canvas tag share one shape", () => {
    const view = new PlayerView(emptyTextures, resolveTuning(), () => LOCAL_ID);
    view.apply(four(), 16, LOCAL_ID);
    expect(view.displayFor(LOCAL_ID)!.tag).toBeInstanceOf(NameTag);
  });
});
