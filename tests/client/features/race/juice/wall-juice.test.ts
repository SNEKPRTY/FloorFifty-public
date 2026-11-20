import { describe, expect, it } from "vitest";
import { Container, Texture } from "pixi.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import {
  JuiceDirector,
  type JuiceFrame,
  type SideContact,
} from "../../../../../apps/client/src/features/race/juice/juice-director";
import { DustPool } from "../../../../../apps/client/src/features/race/juice/dust-pool";
import { LeanBook } from "../../../../../apps/client/src/features/race/juice/lean";

const JUICE = GENERATED_CONTENT.content.juice;
const TUNING = {
  BOUNCE_VELOCITY: 268.2,
  FAST_FALL_VELOCITY: -1341,
  PLAYER_HEIGHT: 40,
  PLAYER_SPRITE_SIZE: 32,
  FLOOR_GAP_MIN: 128.57,
};

function createHarness(reduced = false) {
  const cues: Array<{ alias: string; key: string; options?: any }> = [];
  const leans: Array<[string, number]> = [];
  const squashes: Array<[string, number, number]> = [];

  const view = {
    dustLayer: new Container(),
    streakLayer: new Container(),
    setSquash: (id: PlayerId, x: number, y: number) => {
      squashes.push([id, x, y]);
    },
    setLean: (id: PlayerId, radians: number) => {
      leans.push([id, radians]);
    },
    setKick: () => {},
    setHitStop: () => {},
    textureOf: () => Texture.WHITE,
  };

  const director = new JuiceDirector({
    view,
    juice: () => JUICE,
    reduced: () => reduced,
    texture: Texture.WHITE,
    tuning: TUNING,
    dustTints: () => [roleTint("dust")],
    cue: (alias, key, options) => {
      cues.push({ alias, key, options });
    },
    floorCount: () => 50,
  });

  return { director, cues, leans, squashes, view };
}

describe("wall-ride juice and presentation", () => {
  it("DustPool.emitWallSparks emits downward vertical spark particles", () => {
    const pool = new DustPool(Texture.WHITE, () => 100);
    expect(pool.live).toBe(0);

    // emit wall sparks on right wall (facing left = false)
    pool.emitWallSparks(50, 100, false, 0, false);
    expect(pool.live).toBeGreaterThanOrEqual(4);
    expect(pool.live).toBeLessThanOrEqual(8);
  });

  it("DustPool.emitWallSparks wraps coordinates crossing horizontal screen boundaries", () => {
    const pool = new DustPool(Texture.WHITE, () => 100);
    // 475 is near the boundary (480 is viewport half-width)
    pool.emitWallSparks(475, 100, false, 0, false);
    expect(pool.live).toBeGreaterThan(0);
    for (const child of pool.root.children) {
      // should remain bounded within [-480, 480]
      expect(Math.abs(child.position.x)).toBeLessThanOrEqual(485);
    }
  });

  it("LeanBook applies lateral wall-brace tilt toward wall face for 100ms", () => {
    const book = new LeanBook();
    const pid = "p1" as PlayerId;

    // Trigger wall brace facing right (wall on right, tilt positive)
    book.brace(pid, false, 1000);
    // At nowMs = 1050 (within 100ms), tilt should be ~18 degrees (~0.314 rad)
    const leanMid = book.drawnOf(pid, 1050);
    expect(Math.abs(leanMid)).toBeGreaterThan(0.25);
    expect(Math.abs(leanMid)).toBeLessThan(0.40);

    // After 100ms expires (nowMs = 1150), brace clears
    const leanAfter = book.drawnOf(pid, 1150);
    expect(leanAfter).toBe(0);
  });

  it("JuiceDirector reacts to side contacts by spawning wall sparks and calling cue('sfx.wallScuff')", () => {
    const { director, cues } = createHarness();
    const sideContact: SideContact = {
      tick: 10, floorId: "f1",
      playerId: "p1" as PlayerId,
      x: 30,
      y: 120,
      facingLeft: false,
    };

    const frame: JuiceFrame = {
      tick: 10,
      nowMs: 1000,
      localId: "p1" as PlayerId,
      racers: [
        {
          id: "p1" as PlayerId,
          x: 30,
          y: 120,
          vx: 50,
          vy: 200,
          colour: "scarlet",
          facingRight: true,
        },
      ],
      sampled: new Map(),
      sideContacts: [sideContact],
    };

    director.frame(frame);

    expect(cues.some((c) => c.alias === "sfx.wallScuff")).toBe(true);
    expect(director.liveParticles).toBeGreaterThan(0);
  });

  it("JuiceDirector suppresses sparks and tilt under reduced motion", () => {
    const { director, cues } = createHarness(true);
    const sideContact: SideContact = {
      tick: 10, floorId: "f1",
      playerId: "p1" as PlayerId,
      x: 30,
      y: 120,
      facingLeft: false,
    };

    const frame: JuiceFrame = {
      tick: 10,
      nowMs: 1000,
      localId: "p1" as PlayerId,
      racers: [
        {
          id: "p1" as PlayerId,
          x: 30,
          y: 120,
          vx: 50,
          vy: 200,
          colour: "scarlet",
          facingRight: true,
        },
      ],
      sampled: new Map(),
      sideContacts: [sideContact],
    };

    director.frame(frame);

    // Sound still plays
    expect(cues.some((c) => c.alias === "sfx.wallScuff")).toBe(true);
    // Particles suppressed under reduced motion
    expect(director.liveParticles).toBe(0);
  });
});

it("deduplicates wall contact frames and limits continuing audio and spark bursts to 100 ms", () => {
  const { director, cues } = createHarness();
  const contact = { tick: 1, floorId: "f1", playerId: "p1" as PlayerId, x: 0, y: 100, facingLeft: false };
  const draw = (nowMs: number, tick: number, same = false) => director.frame({ tick, nowMs, localId: contact.playerId, racers: [], sampled: new Map(), sideContacts: [{ ...contact, tick: same ? 1 : tick }] });
  draw(0, 1);
  draw(7, 1, true);
  draw(99, 2);
  expect(cues.filter((cue) => cue.alias === "sfx.wallScuff")).toHaveLength(1);
  draw(100, 3);
  expect(cues.filter((cue) => cue.alias === "sfx.wallScuff")).toHaveLength(2);
  director.destroy();
});

it.each([-1, 1])("wraps a spark emitted beyond the %s seam into the course", (side) => {
  const pool = new DustPool(Texture.WHITE, () => 100);
  pool.emitWallSparks(side * 500, 100, false, 0, false);
  pool.update(0);
  const visible = pool.root.children.filter((child) => child.visible);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.every((child) => Math.abs(child.x) <= 480)).toBe(true);
  pool.destroy();
});
