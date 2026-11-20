// @vitest-environment node
import type { SetPieceContent } from "@floor-fifty/shared/content/game-content";
import { describe, expect, it } from "vitest";
import type { ActiveGroup } from "../../../../apps/client/src/features/render/set-piece-clock";
import { SetPieceDirector, SKY_FLASH_TINTS } from "../../../../apps/client/src/features/render/set-piece-director";
import { MOOD_TINTS } from "../../../../apps/client/src/features/render/filters/palette-lock";
import type { QualityLevel } from "../../../../apps/client/src/features/profile/quality";

/** A backdrop, particles and camera that record what they were told. */
function harness(options: { quality?: QualityLevel; reduced?: boolean; off?: () => boolean } = {}) {
  const moods: Array<[readonly number[], number]> = [];
  const lights: Array<[number, boolean, number]> = [];
  const flashes: Array<[readonly number[], number]> = [];
  const bursts: Array<{ particle: string; density: number; reduced: boolean }> = [];
  let stops = 0;
  const kicks: number[] = [];
  let quality: QualityLevel = options.quality ?? "high";
  const backdrop = {
    setMood: (tint: readonly [number, number, number], mix: number) => moods.push([tint, mix]),
    setLightsOut: (share: number, invert: boolean, relit = 0) => lights.push([share, invert, relit]),
    setSkyFlash: (tint: readonly [number, number, number], strength: number) => flashes.push([tint, strength]),
  };
  let current = backdrop;
  const director = new SetPieceDirector({
    backdrop: () => current,
    particles: {
      burst: (spec, _nowMs, reduced) => bursts.push({ ...spec, reduced }),
      stop: () => {
        stops += 1;
      },
    },
    kick: (units) => kicks.push(units),
    quality: () => quality,
    reduced: () => options.reduced === true,
    ...(options.off === undefined ? {} : { off: options.off }),
  });
  return {
    director,
    moods,
    lights,
    flashes,
    bursts,
    kicks,
    stops: () => stops,
    setQuality: (next: QualityLevel) => {
      quality = next;
    },
    rebuild: () => {
      const moods2: Array<[readonly number[], number]> = [];
      const lights2: Array<[number, boolean, number]> = [];
      current = {
        setMood: (tint, mix) => moods2.push([tint, mix]),
        setLightsOut: (share, invert, relit = 0) => lights2.push([share, invert, relit]),
        setSkyFlash: () => 0,
      };
      return { moods2, lights2 };
    },
  };
}

const group = (pieces: SetPieceContent[], startedMs = 0, holdScale = 1): ActiveGroup => ({
  floor: pieces[0]!.floor,
  pieces,
  holdMs: Math.max(...pieces.map((piece) => piece.holdMs)),
  startedMs,
  pass: 0,
  holdScale,
});

/** Steps the director every 16 ms from `fromMs` to `toMs`. */
function run(director: SetPieceDirector, fromMs: number, toMs: number): Array<ReadonlyMap<string, number>> {
  const swarms: Array<ReadonlyMap<string, number>> = [];
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += 16) swarms.push(director.update(nowMs, {}).swarm);
  return swarms;
}

describe("SetPieceDirector (Wonder spec §6.4, §6.6)", () => {
  it("steps a paletteShift into its mood and back out, in four steps each way", () => {
    const h = harness();
    const sunset = group([{ floor: 34, kind: "paletteShift", holdMs: 2000, mood: "sunset" }]);
    h.director.update(0, { started: sunset });
    run(h.director, 16, 2100);
    const mixes = [...new Set(h.moods.map(([, mix]) => mix))];
    expect(mixes).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(h.moods.at(-1)![1]).toBe(0);
    expect(h.moods.find(([, mix]) => mix === 1)![0]).toEqual(MOOD_TINTS.sunset);
  });

  it("runs lightsOut as a wave up the screen and back on, or inverted to blaze", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 50, kind: "lightsOut", holdMs: 3000, invert: true }]) });
    run(h.director, 16, 3100);
    const shares = h.lights.map(([share]) => share);
    expect(Math.max(...shares)).toBe(1);
    expect(shares.at(-1)).toBe(0);
    expect(h.lights.filter(([share]) => share > 0).every(([, invert]) => invert)).toBe(true);
    expect(new Set(shares).size).toBeLessThanOrEqual(9); // eight steps and rest
    expect(h.lights.at(-1)).toEqual([0, false, 0]);
  });

  it("flashes no more than three times a second, and kicks the camera on a lightning flash", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 45, kind: "skyFlash", holdMs: 600, flashes: 3, tone: "lightning", kick: 3 }]) });
    run(h.director, 16, 2000);
    const onsets: number[] = [];
    let wasOn = false;
    h.flashes.forEach(([, strength], index) => {
      if (strength > 0 && !wasOn) onsets.push(index * 16);
      wasOn = strength > 0;
    });
    expect(onsets).toHaveLength(3);
    for (let i = 1; i < onsets.length; i += 1) expect(onsets[i]! - onsets[i - 1]!).toBeGreaterThanOrEqual(334 - 16);
    expect(h.flashes.find(([, strength]) => strength > 0)![0]).toEqual(SKY_FLASH_TINTS.lightning);
    expect(h.kicks).toEqual([3]);
    expect(h.flashes.at(-1)![1]).toBe(0);
  });

  it("sweeps a swarm's layers by their speed, and settles", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 10, kind: "swarm", holdMs: 500, layers: ["world.clouds"], speed: 8 }]) });
    const swarms = run(h.director, 16, 700);
    expect(swarms[0]!.get("world.clouds")).toBe(8);
    expect(swarms.at(-1)!.size).toBe(0);
  });

  it("bursts weather, surges its named layers, and stops it at the end of its hold", () => {
    const h = harness();
    h.director.update(0, {
      started: group([{ floor: 22, kind: "weatherBurst", holdMs: 500, particle: "snow", density: 0.6, layers: ["world.snowfall"] }]),
    });
    expect(h.bursts).toEqual([{ particle: "snow", density: 0.6, reduced: false }]);
    const swarms = run(h.director, 16, 700);
    expect(swarms[0]!.get("world.snowfall")).toBe(3);
    expect(h.stops()).toBe(1);
  });

  it("ends every piece when its group ends early", () => {
    const h = harness();
    const shift = group([{ floor: 34, kind: "paletteShift", holdMs: 5000, mood: "storm" }]);
    h.director.update(0, { started: shift });
    run(h.director, 16, 600);
    h.director.update(616, { ended: shift });
    expect(h.moods.at(-1)![1]).toBe(0);
  });

  it("draws only the palette shift at low quality", () => {
    const h = harness({ quality: "low" });
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "paletteShift", holdMs: 1000, mood: "storm" },
        { floor: 45, kind: "lightsOut", holdMs: 1000 },
        { floor: 45, kind: "skyFlash", holdMs: 1000, flashes: 1, tone: "lightning", kick: 3 },
        { floor: 45, kind: "swarm", holdMs: 1000, layers: ["world.clouds"], speed: 8 },
        { floor: 45, kind: "weatherBurst", holdMs: 1000, particle: "rain", density: 0.7 },
      ]),
    });
    const swarms = run(h.director, 16, 1100);
    expect(h.moods.some(([, mix]) => mix > 0)).toBe(true);
    expect(h.lights.every(([share]) => share === 0)).toBe(true);
    expect(h.flashes.every(([, strength]) => strength === 0)).toBe(true);
    expect(h.kicks).toEqual([]);
    expect(h.bursts).toEqual([]);
    expect(swarms.every((swarm) => swarm.size === 0)).toBe(true);
  });

  it("a rebuild at low keeps the mood and drops the rest", () => {
    const h = harness();
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "paletteShift", holdMs: 3000, mood: "deepWater" },
        { floor: 45, kind: "lightsOut", holdMs: 3000 },
      ]),
    });
    run(h.director, 16, 1200);
    h.setQuality("low");
    const { moods2, lights2 } = h.rebuild();
    h.director.reapply();
    expect(moods2.at(-1)![1]).toBe(1);
    expect(moods2.at(-1)![0]).toEqual(MOOD_TINTS.deepWater);
    expect(lights2.every(([share]) => share === 0)).toBe(true);
    // And the frames after: the mood steps on, the lights stay out of it.
    run(h.director, 1216, 1600);
    expect(lights2.every(([share]) => share === 0)).toBe(true);
    expect(moods2.at(-1)![1]).toBe(1);
  });

  it("a rebuild at low stops a flash, the weather and a sweep already running", () => {
    const h = harness();
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "skyFlash", holdMs: 3000, flashes: 3, tone: "lightning", kick: 3 },
        { floor: 45, kind: "weatherBurst", holdMs: 3000, particle: "rain", density: 0.7 },
        { floor: 45, kind: "swarm", holdMs: 3000, layers: ["world.clouds"], speed: 8 },
      ]),
    });
    run(h.director, 16, 200);
    h.setQuality("low");
    h.director.reapply();
    const flashesBefore = h.flashes.length;
    const swarms = run(h.director, 216, 2000);
    expect(h.flashes.slice(flashesBefore).every(([, strength]) => strength === 0)).toBe(true);
    expect(h.kicks).toEqual([3]); // the one before the rebuild, never again
    expect(h.stops()).toBe(1);
    expect(swarms.every((swarm) => swarm.size === 0)).toBe(true);
  });

  it("steps the mood and the lights plainly under reduced motion, with no flash, kick or sweep, and still weather", () => {
    const h = harness({ reduced: true });
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "paletteShift", holdMs: 1000, mood: "storm" },
        { floor: 45, kind: "lightsOut", holdMs: 1000 },
        { floor: 45, kind: "skyFlash", holdMs: 1000, flashes: 2, tone: "lightning", kick: 3 },
        { floor: 45, kind: "swarm", holdMs: 1000, layers: ["world.clouds"], speed: 8 },
        { floor: 45, kind: "weatherBurst", holdMs: 1000, particle: "snow", density: 0.6 },
      ]),
    });
    const swarms = run(h.director, 16, 1100);
    expect(h.moods.some(([, mix]) => mix === 1)).toBe(true);
    expect(h.lights.some(([share]) => share > 0)).toBe(true); // a one-second hold climbs part way
    expect(h.flashes.every(([, strength]) => strength === 0)).toBe(true);
    expect(h.kicks).toEqual([]);
    expect(swarms.every((swarm) => swarm.size === 0)).toBe(true);
    expect(h.bursts).toEqual([{ particle: "snow", density: 0.6, reduced: true }]);
  });

  it("halves its holds when the clock scales them for a short race (audit)", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 34, kind: "paletteShift", holdMs: 2000, mood: "sunset" }], 0, 0.5) });
    run(h.director, 16, 1100);
    expect(h.moods.at(-1)![1]).toBe(0);
  });

  it("brings the lights back on from the bottom up (owner)", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 22, kind: "lightsOut", holdMs: 3000 }]) });
    run(h.director, 16, 3100);
    const returning = h.lights.filter(([share, , relit]) => share === 1 && relit > 0).map(([, , relit]) => relit);
    expect(returning.length).toBeGreaterThan(0);
    for (let i = 1; i < returning.length; i += 1) expect(returning[i]!).toBeGreaterThanOrEqual(returning[i - 1]!);
    expect(Math.max(...returning)).toBe(1);
    expect(h.lights.at(-1)).toEqual([0, false, 0]);
  });

  it("builds a sunrise: a staying mood holds, and the next steps on from it, never back to neutral (owner)", () => {
    const h = harness();
    h.director.update(0, { started: group([{ floor: 15, kind: "paletteShift", holdMs: 1000, mood: "night", stay: true }]) });
    run(h.director, 16, 1500);
    expect(h.moods.at(-1)).toEqual([MOOD_TINTS.night, 1]);
    h.director.update(1516, { started: group([{ floor: 30, kind: "paletteShift", holdMs: 1000, mood: "dawn", stay: true }], 1516) });
    run(h.director, 1532, 3000);
    const after = h.moods.slice(h.moods.findIndex(([tint]) => tint !== MOOD_TINTS.night));
    expect(after.every(([, mix]) => mix === 1)).toBe(true);
    expect(h.moods.at(-1)).toEqual([MOOD_TINTS.dawn, 1]);
  });

  it("plays nothing with stage effects switched off: no mood, lights, flash, kick, weather or sweep", () => {
    const h = harness({ off: () => true });
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "paletteShift", holdMs: 1000, mood: "storm" },
        { floor: 45, kind: "lightsOut", holdMs: 1000 },
        { floor: 45, kind: "skyFlash", holdMs: 1000, flashes: 1, tone: "lightning", kick: 3 },
        { floor: 45, kind: "swarm", holdMs: 1000, layers: ["world.clouds"], speed: 8 },
        { floor: 45, kind: "weatherBurst", holdMs: 1000, particle: "rain", density: 0.7 },
      ]),
    });
    const swarms = run(h.director, 16, 1100);
    expect(h.moods.every(([, mix]) => mix === 0)).toBe(true);
    expect(h.lights.every(([share]) => share === 0)).toBe(true);
    expect(h.flashes.every(([, strength]) => strength === 0)).toBe(true);
    expect(h.kicks).toEqual([]);
    expect(h.bursts).toEqual([]);
    expect(swarms.every((swarm) => swarm.size === 0)).toBe(true);
  });

  it("switching stage effects off mid-piece ends it: the mood steps back to neutral and the weather stops", () => {
    let off = false;
    const h = harness({ off: () => off });
    h.director.update(0, {
      started: group([
        { floor: 45, kind: "paletteShift", holdMs: 5000, mood: "storm" },
        { floor: 45, kind: "weatherBurst", holdMs: 5000, particle: "rain", density: 0.7 },
      ]),
    });
    run(h.director, 16, 800);
    expect(h.moods.at(-1)?.[1]).toBeGreaterThan(0);
    off = true;
    const swarms = run(h.director, 816, 1200);
    expect(h.moods.at(-1)).toEqual([[1, 1, 1], 0]);
    expect(h.stops()).toBeGreaterThan(0);
    expect(swarms.every((swarm) => swarm.size === 0)).toBe(true);
  });
});
