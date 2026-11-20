/**
 * The gameplay scenery controller.
 *
 * Four things are asserted, and each fails silently. Only the sky may be
 * refracted: the city is drawn crisp, above the sky plate's output, through a
 * chain of its own. Each chain has to end at a palette lock or most of the
 * picture reaches the canvas unquantized.
 * A refraction program that will not compile has to cost refraction and nothing
 * else. And every borrowed object has to go back exactly once -- the lock
 * because the app owns it for the life of the tab, the lease because a texture
 * left behind is a screen-sized leak per race.
 */

import { Container, type Filter } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createPaletteLockFilter } from "../../../../apps/client/src/features/render/filters/palette-lock";
import {
  GAMEPLAY_MUSIC_PULSE,
  WINDOW_SWING,
  GAMEPLAY_REFRACTION_INTENSITY,
  GameplayBackdrop,
} from "../../../../apps/client/src/features/render/gameplay-backdrop";
import {
  createDawnRefractionFilter,
  type DawnRefractionFilter,
} from "../../../../apps/client/src/features/render/filters/dawn-refraction";
import type { QualityLevel } from "../../../../apps/client/src/features/profile/quality";
import { rebuildOnQuality } from "../../../../apps/client/src/features/render/quality-rebuild";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { fakeStage } from "../../support/fakes/stage";

/** A stage dressed the way `app.ts` dresses the real one. */
function dressedStage() {
  const stage = fakeStage();
  const lock = createPaletteLockFilter();
  stage.backdrop.filters = [lock];
  return { stage, lock };
}

const chainOf = (container: Container): Filter[] => (container.filters ?? []) as Filter[];

/** The two scenery roots a race hands the controller. */
const scenery = () => ({ sky: new Container(), city: new Container() });

/** A refraction factory that keeps what it built, so a test can find it. */
const recordingRefraction = () => {
  const created: DawnRefractionFilter[] = [];
  return {
    created,
    create: (quality: QualityLevel) => {
      const filter = createDawnRefractionFilter(quality, "gameplay");
      created.push(filter);
      return filter;
    },
  };
};

describe("the gameplay scenery controller", () => {
  it("renders only the sky through the bounded lease", () => {
    const { stage } = dressedStage();
    const { sky, city } = scenery();

    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });

    expect(stage.leases).toHaveLength(1);
    expect(stage.leases[0]!.filterRoot).toBe(sky);
    expect(backdrop.bounded).toBe(true);
    expect(backdrop.targetSize).toBeDefined();

    backdrop.destroy();
  });

  it("chains the sky through refraction to the borrowed lock", () => {
    for (const quality of ["high", "medium", "low"] as const) {
      const { stage, lock } = dressedStage();
      const { sky, city } = scenery();
      const refraction = recordingRefraction();

      const backdrop = new GameplayBackdrop(stage, { sky, city }, {
        quality,
        createRefraction: refraction.create,
      });

      // Sky, then refraction (low's variant is the static diffusion), then the
      // lock the app built for the layer.
      const chain = chainOf(sky);
      expect(chain).toHaveLength(3);
      expect(chain[1]).toBe(refraction.created[0]);
      expect(chain[2]).toBe(lock);

      backdrop.destroy();
    }
  });

  it("draws the city above the sky plate's output, through its own lock", () => {
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();

    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });

    const children = stage.backdrop.children as unknown[];
    const output = stage.leases[0]!.output;
    expect(children).toContain(city);
    expect(children.indexOf(city)).toBeGreaterThan(children.indexOf(output));

    // A third instance, built for the city: one live filter cannot serve two
    // targets, and the app's two are the composite's and the sky's.
    const chain = chainOf(city);
    expect(chain).toHaveLength(3);
    expect(chain[2]).toBe(stage.paletteLocks[0]);
    expect(chain[1]).not.toBe(lock);
    // Nothing on the city blurs: the sky's diffusing refraction never reaches
    // it as the same instance; the city has a soft refraction of its own.
    expect(chain).not.toContain(chainOf(sky)[1]);

    backdrop.destroy();
  });

  it("carries the soft refraction onto the city, blur and all (after review)", () => {
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();
    const refraction = recordingRefraction();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, {
      quality: "high",
      createRefraction: refraction.create,
    });

    // Two refractions, one per target. The user asked for the background
    // layers blurred again, so the city's diffuses like the sky's.
    const chain = chainOf(city);
    expect(chain).toHaveLength(3);
    const glass = chain[1] as DawnRefractionFilter;
    expect(glass).not.toBe(chainOf(sky)[1]);
    expect(String(glass.glProgram?.fragment)).toContain("#define FF_DIFFUSION 1");
    expect(String(glass.glProgram?.fragment)).toContain("#define FF_NEAREST 0");
    expect(chain[2]).not.toBe(lock);
    expect(backdrop.cityRefractionActive).toBe(true);

    backdrop.update(3.5);
    expect(glass.resources.refractionUniforms.uniforms.uTime).toBeCloseTo(3.5);

    backdrop.setViewport({ x: -10, y: -20, width: 1000, height: 600 }, 2);
    expect([...glass.resources.refractionUniforms.uniforms.uResolution]).toEqual([1000, 600]);
    expect([...glass.resources.refractionUniforms.uniforms.uTargetSize]).toEqual([2000, 1200]);

    const destroyGlass = vi.spyOn(glass, "destroy");
    backdrop.destroy();
    backdrop.destroy();
    expect(destroyGlass).toHaveBeenCalledOnce();
  });

  it("keeps the city's chain when its refraction will not compile", () => {
    const { stage } = dressedStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, {
      quality: "high",
      createCityRefraction: () => {
        throw new Error("bad glass");
      },
    });

    expect(chainOf(city)).toHaveLength(2);
    expect(backdrop.cityRefractionActive).toBe(false);
    expect(backdrop.refractionActive).toBe(true);
    backdrop.destroy();
  });

  it("clears the layer while the race owns the lock instance", () => {
    // One live Pixi filter carries per-target render state, so the app's single
    // lock may not be attached to the target and the layer at once.
    const { stage } = dressedStage();
    const backdrop = new GameplayBackdrop(stage, scenery(), { quality: "high" });

    expect(stage.backdrop.filters).toEqual([]);

    backdrop.destroy();
  });

  it("loses only refraction when the program will not compile", () => {
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, {
      quality: "high",
      createRefraction: () => {
        throw new Error("bad fragment");
      },
    });

    // The sky is still painted and still locked; the city keeps its own
    // chain, glass included -- a separate program the sky's failure can't take.
    expect(chainOf(sky)).toHaveLength(2);
    expect(chainOf(sky).at(-1)).toBe(lock);
    expect(chainOf(city)).toHaveLength(3);
    expect(backdrop.refractionActive).toBe(false);

    backdrop.destroy();
  });

  it("draws both on the backdrop directly when no bounded target can be made", () => {
    // The fallback the spec names: keep the direct backdrop and its baseline
    // chain, and do not add an unbounded refraction pass.
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();
    stage.mountBackdrop = (() => {
      throw new Error("no target");
    }) as never;

    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });

    expect(backdrop.bounded).toBe(false);
    expect(backdrop.targetSize).toBeUndefined();
    expect(stage.backdrop.children).toContain(sky as never);
    expect(stage.backdrop.children).toContain(city as never);
    // The sky's baseline chain sits on the layer, so the sky paints the whole
    // canvas as it always has; the city keeps exactly the chain it has bounded.
    expect(chainOf(stage.backdrop)).toHaveLength(2);
    expect(chainOf(stage.backdrop).at(-1)).toBe(lock);
    expect(chainOf(city)).toHaveLength(2);
    expect(backdrop.refractionActive).toBe(false);

    backdrop.destroy();
  });

  it("drives the refraction from the time it is handed", () => {
    const stage = fakeStage();
    const refraction = recordingRefraction();
    const backdrop = new GameplayBackdrop(stage, scenery(), {
      quality: "high",
      createRefraction: refraction.create,
    });

    backdrop.update(4.5);

    const uniforms = refraction.created[0]!.resources.refractionUniforms.uniforms;
    expect(uniforms.uTime).toBeCloseTo(4.5);
    // The spec's entry value, and no entry ease: the scenery has been on screen
    // since before the countdown finished, so an ease would be an entrance
    // nobody witnessed.
    expect(uniforms.uIntensity).toBe(GAMEPLAY_REFRACTION_INTENSITY);

    backdrop.destroy();
  });

  it("tells the refraction which logical rectangle it is shading", () => {
    const stage = fakeStage();
    const refraction = recordingRefraction();
    const backdrop = new GameplayBackdrop(stage, scenery(), {
      quality: "high",
      createRefraction: refraction.create,
    });

    // The fake stage hands out a lease for its own scenery rectangle, which is
    // the 960 x 540 logical composition by default.
    const uniforms = refraction.created[0]!.resources.refractionUniforms.uniforms;
    expect([...uniforms.uResolution]).toEqual([960, 540]);
    expect([...uniforms.uLogicalOrigin]).toEqual([0, 0]);

    backdrop.destroy();
  });

  it("breathes the city's windows through the city's own filter", () => {
    // Bloom left the backdrop with the blur; the beat's glow now reaches the
    // windows through the atmosphere pass.
    const stage = fakeStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });

    backdrop.setGlow(1.25);

    const atmosphere = chainOf(city)[0]!;
    const uniforms = atmosphere.resources["cityUniforms"] as { uniforms: { uGlow: number } };
    expect(uniforms.uniforms.uGlow).toBeCloseTo(1.25);

    backdrop.destroy();
  });

  it("adds the heard song to the windows, and heaves and reshuffles the sky on the beat", () => {
    const stage = fakeStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
    const glow = () =>
      (chainOf(city)[0]!.resources["cityUniforms"] as { uniforms: { uGlow: number } }).uniforms.uGlow;
    const skyUniforms = () =>
      (chainOf(sky)[0]!.resources["skyUniforms"] as { uniforms: { uSurge: number; uOffset: Float32Array } })
        .uniforms;

    backdrop.setGlow(1.5);
    backdrop.setMusic({ phase: 0, progress: 0, beats: 3, kick: 1, spike: 0.5 });
    // The song's lift, capped at one window step (the audit's flash rule).
    expect(glow()).toBeCloseTo(1.5 + WINDOW_SWING);
    expect(skyUniforms().uSurge).toBeCloseTo(GAMEPLAY_MUSIC_PULSE.surge);
    expect([...skyUniforms().uOffset]).toEqual([2, 3]);

    // The view's glow moves on its own beat; the heard lift stays on top.
    backdrop.setGlow(2);
    expect(glow()).toBeCloseTo(2 + WINDOW_SWING);

    backdrop.setMusic(undefined);
    expect(glow()).toBeCloseTo(2);
    expect(skyUniforms().uSurge).toBe(0);

    backdrop.destroy();
  });

  it("kicks the windows harder on the beat, and adds the stage's lift and a slam's flash (Wonder spec §6.2–6.3)", () => {
    const stage = fakeStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
    const glow = () =>
      (chainOf(city)[0]!.resources["cityUniforms"] as { uniforms: { uGlow: number } }).uniforms.uGlow;
    expect(GAMEPLAY_MUSIC_PULSE.windowKick).toBeCloseTo(4.8);
    backdrop.setGlow(1);
    backdrop.setStageLift(0.5, 0);
    expect(glow()).toBeCloseTo(1.5);
    backdrop.setStageLift(0.5, 1);
    expect(glow()).toBeCloseTo(1.5 + WINDOW_SWING);
    backdrop.setStageLift(0, 0);
    expect(glow()).toBeCloseTo(1);
    backdrop.destroy();
  });

  it("lifts the windows at most three times a second and never more than one step, however the kick, the highs and a slam stack (audit)", () => {
    const stage = fakeStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
    const glow = () =>
      (chainOf(city)[0]!.resources["cityUniforms"] as { uniforms: { uGlow: number } }).uniforms.uGlow;
    backdrop.setGlow(1);
    let rises = 0;
    let last = glow();
    for (let frame = 0; frame < 120; frame += 1) {
      const t = frame / 60;
      backdrop.update(t);
      // A kick every 50 ms, sixteenth-note highs, and a slam flash every 100 ms: the worst stack.
      backdrop.setMusic({ phase: 0, progress: 0, beats: frame, kick: frame % 3 === 0 ? 1 : 0, spike: frame % 2 === 0 ? 1 : 0 });
      backdrop.setStageLift(0, frame % 6 === 0 ? 1 : 0);
      const now = glow();
      expect(now - 1).toBeLessThanOrEqual(WINDOW_SWING + 1e-9);
      if (now > last + 1e-9) rises += 1;
      last = now;
    }
    expect(rises).toBeLessThanOrEqual(6); // two seconds, at most three a second
    backdrop.destroy();
  });

  describe("set pieces (Wonder spec §6.4)", () => {
    const mood = (filter: Filter) =>
      (filter.resources["moodUniforms"] as { uniforms: { uMoodTint: Float32Array; uMoodMix: number } }).uniforms;
    const lightsOut = (city: Container) =>
      [...((chainOf(city)[0]!.resources["cityUniforms"] as { uniforms: { uLightsOut: Float32Array } }).uniforms.uLightsOut)];
    const cityLock = (city: Container) => chainOf(city).at(-1)!;

    it("tints the city's and the sky's locks toward a mood, and hands the sky's back neutral", () => {
      const { stage, lock } = dressedStage();
      const { sky, city } = scenery();
      const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
      backdrop.setMood([1.2, 0.8, 0.7], 0.5);
      expect(mood(cityLock(city)).uMoodMix).toBe(0.5);
      expect(mood(lock).uMoodMix).toBe(0.5);
      backdrop.destroy();
      expect(mood(lock).uMoodMix).toBe(0);
      expect([...mood(lock).uMoodTint]).toEqual([1, 1, 1]);
    });

    it("runs the lights-out wave through the city's own filter", () => {
      const { stage } = dressedStage();
      const { sky, city } = scenery();
      const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
      backdrop.setLightsOut(0.75, false);
      expect(lightsOut(city)).toEqual([0.75, 0, 0]);
      backdrop.setLightsOut(1, true, 0.5);
      expect(lightsOut(city)).toEqual([1, 1, 0.5]);
      backdrop.destroy();
    });

    it("flashes the sky's lock over its mood, then gives the mood back", () => {
      const { stage, lock } = dressedStage();
      const { sky, city } = scenery();
      const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
      backdrop.setMood([0.7, 0.75, 0.9], 0.75);
      backdrop.setSkyFlash([1.6, 1.6, 1.7], 1);
      expect(mood(lock).uMoodMix).toBe(1);
      expect(mood(lock).uMoodTint[0]).toBeCloseTo(1.6);
      expect(mood(cityLock(city)).uMoodMix).toBe(0.75); // the flash is the sky's alone
      backdrop.setSkyFlash([1.6, 1.6, 1.7], 0);
      expect(mood(lock).uMoodMix).toBe(0.75);
      expect(mood(lock).uMoodTint[0]).toBeCloseTo(0.7);
      backdrop.destroy();
    });

    it("holds the sky's flash under the plate's brightest colour, and only the flash (audit)", () => {
      const { stage, lock } = dressedStage();
      const { sky, city } = scenery();
      const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
      const ceil = (filter: Filter) => [...(filter.resources["moodUniforms"] as { uniforms: { uMoodCeil: Float32Array } }).uniforms.uMoodCeil];
      backdrop.setFlashCeiling([0.9, 0.85, 0.8]);
      backdrop.setSkyFlash([1.6, 1.6, 1.7], 1);
      expect(ceil(lock).map((value) => Number(value.toFixed(2)))).toEqual([0.9, 0.85, 0.8]);
      backdrop.setSkyFlash([1.6, 1.6, 1.7], 0);
      expect(ceil(lock)).toEqual([1, 1, 1]);
      backdrop.destroy();
    });

    it("keeps nothing but the mood at low quality, where the city has no atmosphere pass", () => {
      const { stage, lock } = dressedStage();
      const { sky, city } = scenery();
      const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "low" });
      expect(() => backdrop.setLightsOut(1, false)).not.toThrow();
      backdrop.setMood([1.1, 1.05, 0.95], 1);
      expect(mood(lock).uMoodMix).toBe(1);
      backdrop.destroy();
    });
  });

  it("leaks nothing across three quality rebuilds (launch polish §3.1.2)", () => {
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();
    const settings = new SettingsStore(undefined);
    const mounted = rebuildOnQuality(settings, (quality) => new GameplayBackdrop(stage, { sky, city }, { quality }));

    for (const quality of ["low", "medium", "high"] as const) settings.update({ display: { quality } });

    // One live lease, the app's lock borrowed once (the layer is cleared while
    // a lease holds it, and the lock ends the sky chain), and the city drawn
    // once through the latest build's chain, with nothing left from the others.
    expect(stage.leases.filter((lease) => lease.destroys === 0)).toHaveLength(1);
    expect(stage.leases.at(-1)!.filterRoot).toBe(sky);
    expect(stage.backdrop.filters).toEqual([]);
    expect(chainOf(sky).at(-1)).toBe(lock);
    expect((stage.backdrop.children as unknown[]).filter((child) => child === city)).toHaveLength(1);
    expect(chainOf(sky)).toHaveLength(3);
    expect(chainOf(city)).toHaveLength(3);
    expect(chainOf(city)[2]).toBe(stage.paletteLocks.at(-1));

    mounted.dispose();
    expect(stage.leases.every((lease) => lease.destroys === 1)).toBe(true);
    expect(chainOf(city)).toEqual([]);
    expect(stage.backdrop.filters).toEqual([lock]);
  });

  it("releases the lease, the city and the borrowed filters exactly once", () => {
    const { stage, lock } = dressedStage();
    const { sky, city } = scenery();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, { quality: "high" });
    const lease = stage.leases[0]!;
    const cityLock = stage.paletteLocks[0]!;
    const destroyLock = vi.spyOn(cityLock, "destroy");

    backdrop.destroy();

    expect(lease.destroys).toBe(1);
    expect(stage.backdrop.filters).toEqual([lock]);
    expect(stage.backdrop.children).not.toContain(city as never);
    expect(chainOf(city)).toEqual([]);
    expect(destroyLock).toHaveBeenCalledOnce();

    // Idempotent: a screen that exits twice must not double-free.
    expect(() => backdrop.destroy()).not.toThrow();
    expect(lease.destroys).toBe(1);
    expect(destroyLock).toHaveBeenCalledOnce();
    expect(stage.backdrop.filters).toEqual([lock]);
  });

  it("stops advancing once it is released", () => {
    const stage = fakeStage();
    const refraction = recordingRefraction();
    const backdrop = new GameplayBackdrop(stage, scenery(), {
      quality: "high",
      createRefraction: refraction.create,
    });
    backdrop.update(1);

    backdrop.destroy();
    expect(() => backdrop.update(9)).not.toThrow();
    expect(() => backdrop.setProgress(0.5)).not.toThrow();
    expect(() => backdrop.setGlow(3)).not.toThrow();
  });

  it("validates the program before it is ever attached", () => {
    const { stage } = dressedStage();
    const { sky, city } = scenery();
    const validate = vi.fn();
    const backdrop = new GameplayBackdrop(stage, { sky, city }, {
      quality: "high",
      validateRefraction: validate,
    });

    // Both programs, the sky's refraction and the city's glass.
    expect(validate).toHaveBeenCalledTimes(2);
    expect(chainOf(sky)).toHaveLength(3);

    backdrop.destroy();
  });
});
