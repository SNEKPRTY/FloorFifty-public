import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { Container, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTENT } from "../../../../../apps/server/src/content/generated-content";
import { BOUNCE_GAIN, RIVAL_LANDING_SHARE, SLAM_GAIN } from "../../../../../apps/client/src/features/race/race-cues";
import {
  JuiceDirector,
  seatTint,
  type JuiceDeps,
  type JuiceFrame,
} from "../../../../../apps/client/src/features/race/juice/juice-director";

const JUICE = GENERATED_CONTENT.content.juice;
const TUNING = { BOUNCE_VELOCITY: 268.2, FAST_FALL_VELOCITY: -1341, PLAYER_HEIGHT: 40, PLAYER_SPRITE_SIZE: 32, FLOOR_GAP_MIN: 128.57 };

function harness(
  reduced: boolean | (() => boolean) = false,
  juice: () => typeof JUICE | undefined = () => JUICE,
  keyPrefix?: () => string,
  off?: () => boolean,
) {
  const squashes: Array<[string, number, number]> = [];
  const leans: Array<[string, number]> = [];
  const kicks: number[] = [];
  const hitStops: boolean[] = [];
  const cues: string[] = [];
  const cueOptions: Array<{ readonly gain?: number; readonly rate?: number; readonly vary?: boolean } | undefined> = [];
  const view = {
    dustLayer: new Container(),
    streakLayer: new Container(),
    setSquash: (id: PlayerId, x: number, y: number) => {
      squashes.push([id, x, y]);
    },
    setLean: (id: PlayerId, radians: number) => {
      leans.push([id, radians]);
    },
    setKick: (units: number) => {
      kicks.push(units);
    },
    setHitStop: (frozen: boolean) => {
      hitStops.push(frozen);
    },
    textureOf: () => Texture.WHITE,
  };
  const director = new JuiceDirector({
    view,
    juice,
    reduced: typeof reduced === "function" ? reduced : () => reduced,
    texture: Texture.WHITE,
    tuning: TUNING,
    dustTints: () => [roleTint("dust")],
    cue: (alias, key, options) => {
      cues.push(`${alias}:${key}`);
      cueOptions.push(options);
    },
    floorCount: () => 50,
    ...(keyPrefix === undefined ? {} : { keyPrefix }),
    ...(off === undefined ? {} : { off }),
  });
  return { director, squashes, leans, kicks, hitStops, cues, cueOptions, view };
}

type Harness = ReturnType<typeof harness>;

const racer = (vy: number, id = "p1", x = 0, colour: SeatColour = "scarlet", vx = 0) => ({
  id: id as PlayerId,
  x,
  y: 100,
  vy,
  vx,
  colour,
  facingRight: true,
});

const frame = (
  tick: number,
  vy: number,
  nowMs: number,
  id = "p1",
  holdUntilTick?: number,
  localLanding = false,
): JuiceFrame => ({
  tick,
  nowMs,
  localId: "p1" as PlayerId,
  localLanding,
  racers: [racer(vy, id)],
  sampled: new Map([[id as PlayerId, { x: 0, y: 100, holdUntilTick }]]),
});

const dust = (h: Pick<Harness, "view">) => h.view.dustLayer.children[0]!.children.filter((child) => child.visible);

const landed = (playerId: string, tick: number) =>
  ({ id: `${tick}:floorLanded:${playerId}:f`, tick, type: "floorLanded", playerId, floorId: "f", floorIndex: 1 }) as RaceEvent;
const reset = (playerId: string, tick: number) =>
  ({ id: `${tick}:playerReset:${playerId}:fall`, tick, type: "playerReset", playerId, reason: "fall" }) as RaceEvent;
const finished = (winnerId: string, tick: number) =>
  ({ id: `${tick}:raceFinished:${winnerId}:`, tick, type: "raceFinished", winnerId }) as RaceEvent;

/** Drives a fast fall into a landing at tick 3, nowMs 32. Returns the frame builder for what follows. */
const slamInto = (h: Harness, id = "p1") => {
  const at = (tick: number, vy: number, nowMs: number) => frame(tick, vy, nowMs, id);
  h.director.frame(at(1, -900, 0));
  h.director.frame(at(2, -1341, 16));
  h.director.frame(at(3, 268, 32));
  return at;
};

describe("JuiceDirector, the whisper tier", () => {
  it("answers a bounce with a squash knock that wobbles back to rest on its spring, and a puff (Wonder spec §4.2)", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    expect(h.squashes.at(-1)).toEqual(["p1", 1.25, 0.75]);
    expect(dust(h)).toHaveLength(JUICE.bounce.dust.count);
    for (let i = 3; i < 120; i += 1) h.director.frame(frame(i, 200, i * 16));
    const xs = h.squashes.filter(([id]) => id === "p1").map(([, x]) => x);
    expect(Math.min(...xs)).toBeLessThan(1);
    expect(h.squashes.at(-1)).toEqual(["p1", 1, 1]);
  });

  it("answers every racer's bounce, not only the local one's", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0, "p2"));
    h.director.frame(frame(2, 268, 16, "p2"));
    expect(h.squashes.at(-1)).toEqual(["p2", 1.25, 0.75]);
  });

  it("throws the dust at the racer's feet", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    // Feet: y 100 less half of PLAYER_HEIGHT 40, drawn at -80 in the world's y-down space.
    for (const particle of dust(h)) expect(particle.y).toBe(-80);
  });

  it("gives a bounce its own soft blip and nothing else (Wonder spec §3.2 reverses the silent bounce)", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    expect(h.cues.map((cue) => cue.split(":")[0])).toEqual(["sfx.bounce"]);
  });

  it("under reduced motion, no squash and one still puff frame", () => {
    const h = harness(true);
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    expect(h.squashes.every(([, x, y]) => x === 1 && y === 1)).toBe(true);
    expect(dust(h)).toHaveLength(1);
  });

  it("plays nothing before any content has loaded", () => {
    const h = harness(false, () => undefined);
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    expect(h.squashes.every(([, x, y]) => x === 1 && y === 1)).toBe(true);
    expect(dust(h)).toHaveLength(0);
  });

  it("settles every spring on destroy: the lean, the squash and the kick", () => {
    const h = harness();
    for (let i = 1; i < 20; i += 1) h.director.frame({ ...frame(i, 0, i * 16), racers: [racer(0, "p1", 0, "scarlet", 356)] });
    slamInto(h);
    h.director.destroy();
    expect(h.director["lean"].drawnOf("p1" as PlayerId)).toBe(0);
    expect(h.director["kick"].value).toBe(0);
    expect(h.director["squash"].scaleOf("p1" as PlayerId)).toEqual({ x: 1, y: 1 });
  });

  it("puts its dust in the view's layer and takes it away on destroy", () => {
    const h = harness();
    expect(h.view.dustLayer.children).toHaveLength(1);
    h.director.destroy();
    expect(h.view.dustLayer.children).toHaveLength(0);
  });
});

describe("JuiceDirector, the hit tier: the slam", () => {
  it("answers a local slam with a deep squash, a ring, a kick and 50 ms of hit-stop", () => {
    const h = harness();
    slamInto(h);
    expect(h.squashes.at(-1)).toEqual(["p1", 1.5, 0.5]);
    expect(h.kicks.at(-1)).toBe(JUICE.slam.cameraKick.units);
    expect(h.hitStops.at(-1)).toBe(true);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.slam:\d+:p1:slam:3$/)]);
    expect(dust(h)).toHaveLength(JUICE.slam.dust.count + (JUICE.slam.dust.sparks ?? 0));
    expect(dust(h).filter((sprite) => (sprite as unknown as { tint: number }).tint === roleTint("finishBurst"))).toHaveLength(JUICE.slam.dust.sparks ?? 0);
  });

  it("gives a remote racer's slam the squash and ring, but no kick, no hit-stop and no sound", () => {
    const h = harness();
    slamInto(h, "p2");
    expect(h.squashes.at(-1)).toEqual(["p2", 1.5, 0.5]);
    expect(dust(h)).toHaveLength(JUICE.slam.dust.count + (JUICE.slam.dust.sparks ?? 0));
    expect(h.kicks.every((kick) => kick === 0)).toBe(true);
    expect(h.hitStops.every((stop) => !stop)).toBe(true);
    expect(h.cues).toEqual([]);
  });

  it("ends the hit-stop after hitStopMs, and settles the kick back to zero on its spring", () => {
    const h = harness();
    const at = slamInto(h);
    h.director.frame(at(4, 250, 32 + 50));
    expect(h.hitStops.at(-1)).toBe(false);
    for (let i = 5; i < 60; i += 1) h.director.frame(at(i, 240, 32 + i * 16));
    expect(Math.min(...h.kicks.slice(3))).toBeLessThan(0); // it overshoots back up
    expect(h.kicks.at(-1)).toBe(0);
  });

  it("pauses the local racer's squash while hit-stopped, and resumes it after", () => {
    const h = harness();
    const at = slamInto(h);
    // The hit-stop holds the knock for its 50 ms; then the spring takes it back.
    for (let nowMs = 32 + 4; nowMs <= 32 + 48; nowMs += 4) {
      h.director.frame(at(4, 250, nowMs));
      expect(h.squashes.at(-1)).toEqual(["p1", 1.5, 0.5]);
    }
    h.director.frame(at(5, 240, 32 + 110));
    expect(h.squashes.at(-1)![1]).toBeLessThan(1.5);
  });

  it("does not pause a remote racer's squash during the local hit-stop", () => {
    const h = harness();
    h.director.frame({ ...frame(1, -1341, 0), racers: [racer(-1341, "p1"), racer(-200, "p2")] });
    h.director.frame({ ...frame(2, -1341, 16), racers: [racer(-1341, "p1"), racer(-200, "p2")] });
    h.director.frame({ ...frame(3, 268, 32), racers: [racer(268, "p1"), racer(268, "p2")] });
    h.director.frame({ ...frame(4, 250, 32 + 40), racers: [racer(250, "p1"), racer(250, "p2")] });
    expect(h.squashes.filter(([id]) => id === "p2").at(-1)![1]).toBeLessThan(1.25);
  });

  it("can neither move a racer nor reach anything the client sends", () => {
    // The director's only outputs are the view calls and `cue`. Its deps carry
    // no input or network port, so it has no path to anything sent; this
    // fails to compile if one is ever added.
    type Sending = Extract<keyof JuiceDeps, "send" | "input" | "network">;
    const none: [Sending] extends [never] ? true : false = true;
    expect(none).toBe(true);
    // And nothing it calls on the view takes a position.
    const h = harness();
    slamInto(h);
    expect(Object.keys(h.view)).not.toContain("setPosition");
  });

  it("under reduced motion, a slam is one still ring frame: no squash, kick or hit-stop", () => {
    const h = harness(true);
    slamInto(h);
    expect(h.squashes.every(([, x, y]) => x === 1 && y === 1)).toBe(true);
    expect(h.kicks.every((kick) => kick === 0)).toBe(true);
    expect(h.hitStops.every((stop) => !stop)).toBe(true);
    expect(dust(h)).toHaveLength(1);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.slam:\d+:p1:slam:3$/)]);
  });

  it("turning reduced motion on settles running effects", () => {
    let reduced = false;
    const h = harness(() => reduced);
    const at = slamInto(h);
    reduced = true;
    h.director.frame(at(4, 250, 42));
    expect(h.squashes.at(-1)).toEqual(["p1", 1, 1]);
    expect(h.kicks.at(-1)).toBe(0);
    expect(h.hitStops.at(-1)).toBe(false);
  });
});

describe("JuiceDirector with character effects switched off", () => {
  const offHarness = (off: () => boolean = () => true) => harness(false, () => JUICE, undefined, off);

  it("draws nothing for a slam -- no squash, kick, hit-stop or dust -- and keeps the sound", () => {
    const h = offHarness();
    slamInto(h);
    expect(h.squashes.every(([, x, y]) => x === 1 && y === 1)).toBe(true);
    expect(h.kicks.every((kick) => kick === 0)).toBe(true);
    expect(h.hitStops.every((stop) => !stop)).toBe(true);
    expect(h.leans.every(([, radians]) => radians === 0)).toBe(true);
    expect(dust(h)).toHaveLength(0);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.slam:\d+:p1:slam:3$/)]);
  });

  it("throws no burst and pops no HUD, and still sounds the floor", () => {
    const h = offHarness();
    h.director.noteRoomEvents([landed("p1", 30), reset("p1", 30), finished("p1", 30)]);
    h.director.frame(frame(30, 0, 0));
    expect(dust(h)).toHaveLength(0);
    expect(h.director.hudPops).toBe(0);
    expect(h.cues).toEqual([`ui.pop:30:floorLanded:p1:f`]);
  });

  it("drops the wrap streak and its sparks, keeping the sound", () => {
    const h = offHarness();
    const at = (x: number, tick: number): JuiceFrame => ({
      tick,
      nowMs: tick * 16,
      localId: "p1" as PlayerId,
      racers: [{ ...racer(100, "p1", x) }],
      sampled: new Map(),
    });
    h.director.frame(at(470, 1));
    h.director.frame(at(-470, 2));
    expect(h.view.streakLayer.children.filter((child) => child.visible)).toHaveLength(0);
    expect(dust(h)).toHaveLength(0);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.wrap:\d+:p1:wrap:2$/)]);
  });

  it("switching off mid-race settles running effects and clears the dust", () => {
    let off = false;
    const h = offHarness(() => off);
    const at = slamInto(h);
    expect(dust(h).length).toBeGreaterThan(0);
    off = true;
    h.director.frame(at(4, 250, 42));
    expect(h.squashes.at(-1)).toEqual(["p1", 1, 1]);
    expect(h.kicks.at(-1)).toBe(0);
    expect(h.hitStops.at(-1)).toBe(false);
    expect(dust(h)).toHaveLength(0);
  });

  it("still returns the moments, so the words and the stage hear them", () => {
    const h = offHarness();
    h.director.frame(frame(1, -200, 0));
    expect(h.director.frame(frame(2, 268, 16)).moments.map((m) => m.kind)).toEqual(["bounce"]);
  });
});

describe("JuiceDirector, the beat tier and the room's events", () => {
  it("pops the HUD on the authoritative local floorLanded, when the drawn tick reaches it, never before", () => {
    const h = harness();
    h.director.noteRoomEvents([landed("p1", 30)]);
    h.director.frame(frame(29, 0, 0));
    expect(h.director.hudPops).toBe(0);
    h.director.frame(frame(30, 0, 16));
    expect(h.director.hudPops).toBe(1);
    expect(h.cues).toEqual([`ui.pop:30:floorLanded:p1:f`]);
    expect(dust(h)).toHaveLength(JUICE.collect.dust.count);
  });

  it("never pops the HUD for a remote racer's floor", () => {
    const h = harness();
    h.director.noteRoomEvents([landed("p2", 30)]);
    h.director.frame(frame(30, 0, 0));
    expect(h.director.hudPops).toBe(0);
    expect(h.cues).toEqual([]);
  });

  it("a replayed batch starts nothing twice", () => {
    const h = harness();
    const batch = [landed("p1", 30), reset("p1", 30)];
    h.director.noteRoomEvents(batch);
    h.director.frame(frame(30, 0, 0));
    const live = dust(h).length;
    h.director.noteRoomEvents(batch);
    h.director.frame(frame(31, 0, 16));
    expect(h.director.hudPops).toBe(1);
    expect(dust(h)).toHaveLength(live);
    expect(h.cues.filter((cue) => cue.startsWith("ui.pop"))).toHaveLength(1);
  });

  it("bursts at the spawn on playerReset", () => {
    const h = harness();
    h.director.noteRoomEvents([reset("p1", 30)]);
    h.director.frame(frame(30, 0, 0));
    expect(dust(h)).toHaveLength(JUICE.burst.spawn.dust.count);
  });

  it("bursts at the spawn when a lap hold ends, once, as authority sends it: the hold is gone on the release tick", () => {
    const h = harness();
    // Held while tick < holdUntilTick; the simulation deletes the field on the
    // release tick itself (`input.ts`), so no sample shows it reached.
    h.director.frame(frame(40, 0, 400, "p1", 48));
    expect(dust(h)).toHaveLength(0);
    h.director.frame(frame(48, 0, 528, "p1"));
    expect(dust(h)).toHaveLength(JUICE.burst.spawn.dust.count);
    h.director.frame(frame(49, 0, 544, "p1"));
    expect(dust(h)).toHaveLength(JUICE.burst.spawn.dust.count);
  });

  it("does not burst for a hold that ended before the racer was first seen", () => {
    const h = harness();
    h.director.frame(frame(60, 0, 0, "p1"));
    expect(dust(h)).toHaveLength(0);
  });

  it("bursts at the winner on raceFinished, in the winner's seat colour and the finish highlight", () => {
    const h = harness();
    h.director.noteRoomEvents([finished("p1", 90)]);
    h.director.frame(frame(90, 0, 0));
    const tints = new Set(dust(h).map((sprite) => (sprite as unknown as { tint: number }).tint));
    expect(tints).toEqual(new Set([seatTint("scarlet"), roleTint("finishBurst")]));
    expect(dust(h)).toHaveLength(JUICE.burst.finish.dust.count + (JUICE.burst.finish.dust.sparks ?? 0));
  });

  it("under reduced motion, every burst is one still frame", () => {
    const h = harness(true);
    h.director.noteRoomEvents([finished("p1", 90)]);
    h.director.frame(frame(90, 0, 0));
    expect(dust(h)).toHaveLength(1);
  });
});

describe("JuiceDirector, a respawn is not a landing", () => {
  it("answers a remote racer's respawn after a fast fall with the spawn burst, never a slam", () => {
    const h = harness();
    h.director.frame(frame(8, -1341, 0, "p2"));
    h.director.frame(frame(9, -1341, 16, "p2"));
    // The room's reset reaches the picture on the frame the racer reappears, rising.
    h.director.noteRoomEvents([reset("p2", 10)]);
    h.director.frame(frame(10, 268, 32, "p2"));
    expect(h.squashes.some(([, x]) => x === 1.5)).toBe(false);
    expect(dust(h)).toHaveLength(JUICE.burst.spawn.dust.count);
  });

  it("answers the local racer's predicted respawn the same way: no slam, no kick, no hit-stop, no sound", () => {
    const h = harness();
    h.director.frame(frame(8, -1341, 0));
    h.director.frame(frame(9, -1341, 16));
    h.director.notePredictedResets([reset("p1", 10)]);
    h.director.frame(frame(10, 268, 32));
    expect(h.squashes.some(([, x]) => x === 1.5)).toBe(false);
    expect(h.kicks.every((kick) => kick === 0)).toBe(true);
    expect(h.hitStops.every((stop) => !stop)).toBe(true);
    expect(h.cues).toEqual([]);
  });

  it("still hears the next real landing after a respawn", () => {
    const h = harness();
    h.director.notePredictedResets([reset("p1", 10)]);
    h.director.frame(frame(10, 268, 0));
    h.director.frame(frame(11, -200, 16));
    h.director.frame(frame(12, 268, 32));
    expect(h.squashes.at(-1)).toEqual(["p1", 1.25, 0.75]);
  });
});

describe("JuiceDirector in a replay", () => {
  const slamAt = (h: Harness, startTick: number, startMs: number) => {
    h.director.frame(frame(startTick, -900, startMs));
    h.director.frame(frame(startTick + 1, -1341, startMs + 16));
    h.director.frame(frame(startTick + 2, 268, startMs + 32));
  };

  it("keys its own sounds apart from any other director's, so a replay of a race the mixer heard still sounds", () => {
    const live = harness();
    const replay = harness();
    slamAt(live, 1, 0);
    slamAt(replay, 1, 0);
    expect(live.cues).toHaveLength(1);
    expect(replay.cues).toHaveLength(1);
    expect(replay.cues[0]).not.toBe(live.cues[0]);
  });

  it("answers its moments again after the timeline jumps back (a rewind), under fresh sound keys", () => {
    const h = harness();
    slamAt(h, 100, 0);
    expect(h.squashes.filter(([, x]) => x === 1.5)).toHaveLength(1);
    slamAt(h, 100, 1_000);
    expect(h.squashes.filter(([, x]) => x === 1.5)).toHaveLength(2);
    expect(h.cues).toHaveLength(2);
    expect(new Set(h.cues).size).toBe(2);
  });

  it("puts its owner's key prefix first, so a replay's sounds carry its playthrough", () => {
    let prefix = "replay:7:";
    const h = harness(false, () => JUICE, () => prefix);
    slamAt(h, 1, 0);
    expect(h.cues[0]).toMatch(/^sfx\.slam:replay:7:\d+:p1:slam:3$/);
    prefix = "replay:8:";
    slamAt(h, 1, 100);
    expect(h.cues[1]).toMatch(/^sfx\.slam:replay:8:/);
  });

  it("settles what was running when the timeline jumps back", () => {
    const h = harness();
    slamAt(h, 100, 0);
    h.director.frame(frame(10, 0, 40));
    expect(h.squashes.at(-1)).toEqual(["p1", 1, 1]);
    expect(h.kicks.at(-1)).toBe(0);
    expect(h.hitStops.at(-1)).toBe(false);
  });
});

describe("JuiceDirector, where the room's moments are thrown from", () => {
  // The local racer is drawn from its prediction, which runs ahead of the
  // sample: by the time a respawn or a collect is drawn, it has bounced on.
  const ahead = (tick: number, holdUntilTick?: number): JuiceFrame => ({
    tick,
    nowMs: tick * 16,
    localId: "p1" as PlayerId,
    racers: [{ ...racer(0, "p1", 200), y: 300 }],
    sampled: new Map([["p1" as PlayerId, { x: 0, y: 100, holdUntilTick }]]),
  });
  const xs = (h: Pick<Harness, "view">) => dust(h).map((particle) => particle.x);

  it.each([
    ["a respawn", reset],
    ["a floor collected", landed],
  ])("throws the local racer's %s from where authority has it, not from its prediction", (_name, event) => {
    const h = harness();
    h.director.noteRoomEvents([event("p1", 30)]);
    h.director.frame(ahead(30));
    expect(xs(h).length).toBeGreaterThan(0);
    for (const x of xs(h)) expect(Math.abs(x)).toBeLessThan(100);
  });

  it("throws the local racer's lap release from the spawn authority holds it at", () => {
    const h = harness();
    h.director.frame(ahead(40, 48));
    h.director.frame(ahead(48));
    expect(xs(h).length).toBeGreaterThan(0);
    for (const x of xs(h)) expect(Math.abs(x)).toBeLessThan(100);
  });
});

describe("JuiceDirector under stress (the frame-budget hook)", () => {
  const all = (tick: number, nowMs: number): JuiceFrame => ({
    tick,
    nowMs,
    localId: "p1" as PlayerId,
    racers: ["p1", "p2", "p3", "p4"].map((id, index) => racer(0, id, index * 40)),
    sampled: new Map(),
  });

  it("slams every racer every 100 ms, with no sound, holding the pool at its limit and never past it", () => {
    const h = harness();
    h.director.setStress(true);
    h.director.frame(all(1, 0));
    expect(new Set(h.squashes.filter(([, x]) => x === 1.5).map(([id]) => id))).toEqual(new Set(["p1", "p2", "p3", "p4"]));
    expect(h.kicks.at(-1)).toBe(JUICE.slam.cameraKick.units);
    expect(h.cues).toEqual([]);
    for (let frame = 2; frame < 60; frame += 1) {
      h.director.frame(all(frame, frame * 16));
      expect(h.director.liveParticles).toBeLessThanOrEqual(JUICE.limits.particles);
    }
    // Faster than the rings die, so the oldest are recycled (Review Focus 5).
    expect(h.director.liveParticles).toBe(JUICE.limits.particles);
  });

  it("hands its slams to the frame's moments, so the words load too, each once (Wonder spec §6.6)", () => {
    const h = harness();
    h.director.setStress(true);
    const first = h.director.frame(all(1, 0));
    expect(first.moments.filter((moment) => moment.kind === "slam").map((moment) => moment.playerId).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(new Set(first.moments.map((moment) => moment.key)).size).toBe(4);
    const later = h.director.frame(all(2, 120));
    expect(later.moments.every((moment) => !first.moments.some((earlier) => earlier.key === moment.key))).toBe(true);
    expect(later.localSlammed).toBe(false); // a stress slam never takes a landing's sound
  });

  it("stops when switched off", () => {
    const h = harness();
    h.director.setStress(true);
    h.director.frame(all(1, 0));
    h.director.setStress(false);
    h.squashes.length = 0;
    h.director.frame(all(2, 400));
    expect(h.squashes.every(([, x]) => x !== 1.5)).toBe(true);
  });
});

describe("JuiceDirector, the wrap", () => {
  const at = (x: number, tick: number): JuiceFrame => ({
    tick,
    nowMs: tick * 16,
    localId: "p1" as PlayerId,
    racers: [{ ...racer(100, "p1", x) }],
    sampled: new Map(),
  });

  it("draws a streak at both seams, with its sound for the local racer", () => {
    const h = harness();
    h.director.frame(at(470, 1));
    h.director.frame(at(-470, 2));
    expect(h.view.streakLayer.children.filter((child) => child.visible).map((child) => child.x).sort((a, b) => a - b)).toEqual([-470, 470]);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.wrap:\d+:p1:wrap:2$/)]);
  });

  it("throws its sparks at both seams, in the finish highlight (Wonder spec §4.3)", () => {
    const h = harness();
    h.director.frame(at(470, 1));
    h.director.frame(at(-470, 2));
    const sparks = dust(h).filter((sprite) => (sprite as unknown as { tint: number }).tint === roleTint("finishBurst"));
    expect(sparks).toHaveLength(JUICE.wrap.sparks * 2);
    expect(sparks.some((sprite) => sprite.x > 400)).toBe(true);
    expect(sparks.some((sprite) => sprite.x < -400)).toBe(true);
  });

  it("keeps its streak for its authored frames", () => {
    const h = harness();
    h.director.frame(at(470, 1));
    h.director.frame(at(-470, 2));
    // The wrap's own frame is the first of its frames.
    const shown = () => h.view.streakLayer.children.filter((child) => child.visible).length;
    for (let tick = 3; tick < 1 + JUICE.wrap.streak.frames; tick += 1) {
      h.director.frame(at(-470, tick));
      expect(shown()).toBe(2);
    }
    h.director.frame(at(-470, 1 + JUICE.wrap.streak.frames));
    expect(shown()).toBe(0);
  });

  it("drops the streak under reduced motion, keeping the sound", () => {
    const h = harness(true);
    h.director.frame(at(470, 1));
    h.director.frame(at(-470, 2));
    expect(h.view.streakLayer.children.filter((child) => child.visible)).toHaveLength(0);
    expect(h.cues).toEqual([expect.stringMatching(/^sfx\.wrap:\d+:p1:wrap:2$/)]);
  });
});

describe("the juice's sounds (Wonder spec §3.2)", () => {
  it("cues the local slam at SLAM_GAIN, and says it slammed this frame", () => {
    const h = harness();
    h.director.frame(frame(1, -900, 0));
    h.director.frame(frame(2, -1341, 16));
    const result = h.director.frame(frame(3, 268, 32));
    const slams = h.cues.flatMap((cue, i) => (cue.startsWith("sfx.slam") ? [h.cueOptions[i]] : []));
    expect(slams).toHaveLength(1);
    expect(slams[0]?.gain).toBeCloseTo(SLAM_GAIN, 6);
    expect(result.localSlammed).toBe(true);
  });

  it("says it did not slam on a plain bounce", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0));
    expect(h.director.frame(frame(2, 268, 16)).localSlammed).toBe(false);
  });

  it("blips a local bounce, but not on the frame a landing sounds", () => {
    const h = harness();
    h.director.frame(frame(1, -200, 0));
    h.director.frame(frame(2, 268, 16));
    expect(h.cues.filter((cue) => cue.startsWith("sfx.bounce"))).toHaveLength(1);
    const quiet = harness();
    quiet.director.frame(frame(1, -200, 0, "p1", undefined, true));
    quiet.director.frame(frame(2, 268, 16, "p1", undefined, true));
    expect(quiet.cues.filter((cue) => cue.startsWith("sfx.bounce"))).toEqual([]);
  });

  it("blips a rival's bounce quietly", () => {
    const h = harness();
    h.director.frame({ ...frame(1, -200, 0), racers: [racer(-200, "p1"), racer(-200, "p2", 50)] });
    h.director.frame({ ...frame(2, 268, 16), racers: [racer(0, "p1"), racer(268, "p2", 50)] });
    const i = h.cues.findIndex((cue) => cue.startsWith("sfx.bounce") && cue.includes("p2"));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(h.cueOptions[i]?.gain).toBeCloseTo(BOUNCE_GAIN * RIVAL_LANDING_SHARE, 6);
  });

  it("returns the moments it answered and the room events it reached", () => {
    const h = harness();
    h.director.noteRoomEvents([landed("p1", 2)]);
    h.director.frame(frame(1, -200, 0));
    const result = h.director.frame(frame(2, 268, 16));
    expect(result.moments.map((m) => m.kind)).toEqual(["bounce"]);
    expect(result.reached.map((e) => e.type)).toEqual(["floorLanded"]);
  });
});

describe("JuiceDirector, the lean (Wonder spec §4.1)", () => {
  it("leans a racer moving right toward a negative skew, on lean steps", () => {
    const h = harness();
    for (let i = 1; i < 40; i += 1) h.director.frame({ ...frame(i, 0, i * 16), racers: [racer(0, "p1", 0, "scarlet", 356)] });
    const lean = h.leans.filter(([id]) => id === "p1").at(-1)![1];
    expect(lean).toBeLessThan(0);
    expect(Math.abs(lean / ((JUICE.lean.stepDeg * Math.PI) / 180)) % 1).toBeCloseTo(0, 6);
  });

  it("holds the local racer's lean through hit-stop", () => {
    const h = harness();
    const at = (tick: number, vy: number, nowMs: number, vx: number) => ({ ...frame(tick, vy, nowMs), racers: [racer(vy, "p1", 0, "scarlet", vx)] });
    for (let i = 1; i < 30; i += 1) h.director.frame(at(i, -200, i * 16, 356));
    h.director.frame(at(30, -1341, 30 * 16, 356));
    h.director.frame(at(31, -1341, 31 * 16, 356));
    h.director.frame(at(32, 268, 32 * 16, -356)); // the slam: hit-stop starts
    const held = h.leans.at(-1)![1];
    h.director.frame(at(33, 250, 32 * 16 + 20, -356));
    expect(h.leans.at(-1)![1]).toBe(held);
  });

  it("stands every racer upright under reduced motion", () => {
    const h = harness(true);
    for (let i = 1; i < 30; i += 1) h.director.frame({ ...frame(i, 0, i * 16), racers: [racer(0, "p1", 0, "scarlet", 356)] });
    expect(h.leans.every(([, lean]) => lean === 0)).toBe(true);
  });
});
