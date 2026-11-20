/**
 * The duotone dither: two tones by an ordered dither, two pairs swung between
 * on a ping pong whose every leg starts slow and snaps home fast.
 */

import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import {
  DUOTONE_EASE_POWER,
  createDuotoneDitherFilter,
  duotonePhase,
  duotoneToneAt,
  easeIn,
  setDuotoneCell,
  setDuotoneOffset,
  setDuotonePhase,
} from "../../../../../apps/client/src/features/render/filters/duotone-dither";
import {
  SPLASH_ART,
  SPLASH_DITHER_CELLS_PER_BEAT,
  SPLASH_DUOTONE,
  SPLASH_LEG_SECONDS,
  SplashArt,
} from "../../../../../apps/client/src/features/render/splash-art";
import { FakeContainer, FakeTicker, fakeStage } from "../../../support/fakes/stage";

const uniforms = (filter: ReturnType<typeof createDuotoneDitherFilter>): Record<string, unknown> =>
  (filter.resources["duotoneUniforms"] as { uniforms: Record<string, unknown> }).uniforms;

describe("the easing", () => {
  it("starts slow and ramps up hard at the end", () => {
    expect(easeIn(0)).toBe(0);
    expect(easeIn(1)).toBe(1);
    // Half the time covers a sixteenth of the travel; the last tenth, a third.
    expect(easeIn(0.5)).toBeCloseTo(0.5 ** DUOTONE_EASE_POWER);
    expect(easeIn(1) - easeIn(0.9)).toBeGreaterThan(0.3);
    expect(easeIn(0.1)).toBeLessThan(0.001);
  });
});

describe("the ping pong", () => {
  it("goes to the second pair on one leg and back on the next", () => {
    expect(duotonePhase(0, 1)).toBe(0);
    expect(duotonePhase(0.999, 1)).toBeGreaterThan(0.99);
    expect(duotonePhase(1, 1)).toBeCloseTo(1);
    expect(duotonePhase(1.999, 1)).toBeLessThan(0.01);
    expect(duotonePhase(2, 1)).toBe(0);
  });

  it("leaves each pair slowly and arrives at it fast, both ways", () => {
    // Out: barely moved by the middle of the leg.
    expect(duotonePhase(0.5, 1)).toBeLessThan(0.1);
    // Back: still near the second pair by the middle of the return.
    expect(duotonePhase(1.5, 1)).toBeGreaterThan(0.9);
  });
});

describe("the tone a pixel takes", () => {
  it("is all the first pair at phase 0 and all the second at phase 1", () => {
    for (let x = 0; x < 4; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        expect(duotoneToneAt(0.5, 0, x, y).pair).toBe("from");
        expect(duotoneToneAt(0.5, 1, x, y).pair).toBe("to");
      }
    }
  });

  it("stipples the second pair in cell by cell as the phase rises", () => {
    const share = (phase: number): number => {
      let to = 0;
      for (let x = 0; x < 4; x += 1) for (let y = 0; y < 4; y += 1) if (duotoneToneAt(0.5, phase, x, y).pair === "to") to += 1;
      return to / 16;
    };
    expect(share(0.25)).toBeCloseTo(0.25);
    expect(share(0.5)).toBeCloseTo(0.5);
  });

  it("dithers brightness between the shadow and the highlight, within the levels", () => {
    expect(duotoneToneAt(0, 0, 1, 1).tone).toBe("shadow");
    expect(duotoneToneAt(1, 0, 3, 2).tone).toBe("highlight");
    // Below the black level is shadow everywhere, above the white highlight.
    expect(duotoneToneAt(0.1, 0, 3, 2, [0.2, 0.8]).tone).toBe("shadow");
    expect(duotoneToneAt(0.9, 0, 0, 0, [0.2, 0.8]).tone).toBe("highlight");
  });
});

describe("the filter", () => {
  it("mirrors the TypeScript choice and reads straight colour", () => {
    const filter = createDuotoneDitherFilter(SPLASH_DUOTONE);
    const fragment = String(filter.glProgram?.fragment);
    expect(fragment).toContain("bayer(cell.yx + vec2(2.0, 1.0))");
    expect(fragment).toContain("source.rgb / source.a");
  });

  it("slides its pattern by whole cells, wrapped to the table", () => {
    const filter = createDuotoneDitherFilter(SPLASH_DUOTONE);
    expect(String(filter.glProgram?.fragment)).toContain("+ uOffset");
    setDuotoneOffset(filter, 9, -1);
    expect([...(uniforms(filter)["uOffset"] as Float32Array)]).toEqual([1, 3]);
    // The TypeScript mirror moves the same way: a cell offset by one is its neighbour.
    expect(duotoneToneAt(0.5, 0, 0, 0, [0, 1], [1, 0])).toEqual(duotoneToneAt(0.5, 0, 1, 0));
  });

  it("clamps its phase and keeps a dither cell at least a pixel", () => {
    const filter = createDuotoneDitherFilter(SPLASH_DUOTONE);
    setDuotonePhase(filter, 3);
    expect(uniforms(filter)["uPhase"]).toBe(1);
    setDuotoneCell(filter, 0.2);
    expect(uniforms(filter)["uCell"]).toBe(1);
  });
});

describe("the splash art", () => {
  it("is drawn in Resurrect 64 blue and white", () => {
    const hex = (tint: number): string => `#${tint.toString(16).padStart(6, "0")}`;
    const { from, to } = SPLASH_DUOTONE;
    expect([from, to].map((pair) => [hex(pair.shadow), hex(pair.highlight)])).toEqual([
      ["#323353", "#ffffff"],
      ["#4d65b4", "#8fd3ff"],
    ]);
  });

  const withArt = (alias: string): Texture => (alias === SPLASH_ART ? Texture.WHITE : Texture.EMPTY);

  it("covers the canvas and swings the pairs as time passes", () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const art = new SplashArt(stage, { textures: withArt, reducedMotion: () => false });
    expect(art.drawn).toBe(true);
    const backdrop = stage.backdrop as unknown as FakeContainer;
    expect(backdrop.children).toHaveLength(1);

    ticker.tick(590);
    expect(art.phase).toBeGreaterThan(0.8);
    ticker.tick(600);
    expect(art.phase).toBeLessThan(0.2);

    art.dispose();
    expect(backdrop.children).toHaveLength(0);
    expect(ticker.size).toBe(0);
  });

  it("crawls its dither, and spikes the bloom on the song's highs", () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const pulses: ({ intensity: number; saturation: number; tint?: number; tintAmount?: number } | undefined)[] = [];
    stage.setBloomPulse = (pulse) => pulses.push(pulse);
    let high = 0.1;
    const bins = (): Uint8Array => {
      const bins = new Uint8Array(512);
      bins.fill(Math.round(high * 255), 120, 290);
      return bins;
    };
    const art = new SplashArt(stage, {
      textures: withArt,
      reducedMotion: () => false,
      music: () => ({ bins: bins(), decibels: new Float32Array(512).fill(-Infinity), binHz: 48_000 / 1024 }),
    });
    const offset = (): number[] => [...(art["filter"]!.resources["duotoneUniforms"] as { uniforms: { uOffset: Float32Array } }).uniforms.uOffset];

    // In time with the beat: still for the first half of it, a cell on at
    // the half.
    const before = offset();
    const half = (SPLASH_LEG_SECONDS * 1000) / SPLASH_DITHER_CELLS_PER_BEAT;
    ticker.tick(half * 0.5);
    expect(offset()).toEqual(before);
    ticker.tick(half * 0.6);
    expect(offset()).not.toEqual(before);

    // The song coming in is a hit of its own; a steady top end then rests.
    for (let i = 0; i < 60; i++) ticker.tick(1000 / 60);
    expect(pulses.at(-1)!.intensity).toBeCloseTo(1, 2);
    expect(pulses.at(-1)!.saturation).toBeCloseTo(1, 2);
    high = 0.9;
    ticker.tick(1000 / 60);
    expect(pulses.at(-1)!.intensity).toBeGreaterThan(3);
    expect(pulses.at(-1)!.saturation).toBeGreaterThan(1.5);
    // The flare is the duotone's sky blue.
    expect(pulses.at(-1)!.tint).toBe(SPLASH_DUOTONE.to.highlight);
    expect(pulses.at(-1)!.tintAmount).toBeGreaterThan(0.9);

    art.dispose();
    expect(pulses.at(-1)).toBeUndefined();
  });

  it("holds the first pair under reduced motion", () => {
    const ticker = new FakeTicker();
    const art = new SplashArt(fakeStage({ ticker }), { textures: withArt, reducedMotion: () => true });
    ticker.tick(590);
    expect(art.phase).toBe(0);
    expect([...(art["filter"]!.resources["duotoneUniforms"] as { uniforms: { uOffset: Float32Array } }).uniforms.uOffset]).toEqual([0, 0]);
    art.dispose();
  });

  it("draws nothing when the art never arrived", () => {
    const stage = fakeStage();
    const art = new SplashArt(stage, { textures: () => Texture.EMPTY });
    expect(art.drawn).toBe(false);
    expect((stage.backdrop as unknown as FakeContainer).children).toHaveLength(0);
    art.dispose();
  });
});
