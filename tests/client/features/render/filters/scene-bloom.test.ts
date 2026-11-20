import { RenderTexture, TexturePool, type Filter } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { MENU_BLOOM, SCENE_BLOOM, createSceneBloomFilter } from "../../../../../apps/client/src/features/render/filters/scene-bloom";

type BrightUniforms = { uBand: Float32Array; uLetterbox: Float32Array; uCanvas: Float32Array };
const brightOf = (bloom: ReturnType<typeof createSceneBloomFilter>): BrightUniforms =>
  (bloom["bright"].resources["brightUniforms"] as { uniforms: BrightUniforms }).uniforms;

/**
 * Records what the bloom asks the filter system to draw, and draws nothing.
 *
 * Pixi's blur is recorded as one draw rather than run: it needs a live
 * renderer, and how it blurs is Pixi's to test. What is the bloom's is that it
 * blurs the extracted light into the texture it then binds.
 */
const fakeFilterSystem = (bloom?: ReturnType<typeof createSceneBloomFilter>) => {
  const calls: { filter: Filter; input: unknown; output: unknown }[] = [];
  if (bloom !== undefined) {
    const blur = bloom["blur"];
    vi.spyOn(blur, "apply").mockImplementation((_system, input, output) => {
      calls.push({ filter: blur, input, output });
    });
  }
  return {
    calls,
    system: {
      applyFilter: (filter: Filter, input: unknown, output: unknown) => calls.push({ filter, input, output }),
    } as never,
  };
};

describe("the scene bloom's band", () => {
  it("is off until the menu names one", () => {
    const bloom = createSceneBloomFilter();
    expect(brightOf(bloom).uBand[0]).toBe(0);
    bloom.destroy();
  });

  it("lands on the refraction's phase, wrapped to its 18-second loop", () => {
    // Breaks if the phase is computed on a different loop from the one the
    // refraction draws the band on: the damp would drift off the band.
    const bloom = createSceneBloomFilter({ bandDamp: 0.8 });
    bloom.setBand({ timeSeconds: 4.5, intensity: 0.9 });
    const band = brightOf(bloom).uBand;
    expect(band[0]).toBeCloseTo(0.8);
    // A quarter of the loop is a quarter turn.
    expect(band[1]).toBeCloseTo(Math.PI / 2, 5);
    expect(band[2]).toBeCloseTo(0.9);

    // One loop later is the same moment.
    bloom.setBand({ timeSeconds: 22.5, intensity: 0.9 });
    expect(band[1]).toBeCloseTo(Math.PI / 2, 5);
    bloom.destroy();
  });

  it("turns off again when the band goes", () => {
    const bloom = createSceneBloomFilter();
    bloom.setBand({ timeSeconds: 1, intensity: 1 });
    bloom.setBand(undefined);
    expect(brightOf(bloom).uBand[0]).toBe(0);
    bloom.destroy();
  });

  it("is told where the composite sits on the canvas", () => {
    const bloom = createSceneBloomFilter();
    bloom.setLetterbox({ x: 40, y: 12, scale: 1.25, canvasWidth: 1280, canvasHeight: 700 });
    const { uLetterbox, uCanvas } = brightOf(bloom);
    expect([...uLetterbox]).toEqual([40, 12, 1.25]);
    expect([...uCanvas]).toEqual([1280, 700]);
    bloom.destroy();
  });
});

describe("the scene bloom's look", () => {
  const keys = (bloom: ReturnType<typeof createSceneBloomFilter>) => {
    const bright = (bloom["bright"].resources["brightUniforms"] as {
      uniforms: { uWhiteThreshold: number; uWarmThreshold: number };
    }).uniforms;
    return { white: bright.uWhiteThreshold, warm: bright.uWarmThreshold, intensity: bloom.intensity, radius: bloom["radius"] };
  };

  it("takes the menu's heavier glow and gives it back", () => {
    const bloom = createSceneBloomFilter();
    bloom.setLook(MENU_BLOOM);
    expect(keys(bloom)).toEqual({
      white: MENU_BLOOM.whiteThreshold,
      warm: MENU_BLOOM.warmThreshold,
      intensity: MENU_BLOOM.intensity,
      radius: MENU_BLOOM.radius,
    });
    bloom.setLook(undefined);
    expect(keys(bloom)).toEqual({
      white: SCENE_BLOOM.whiteThreshold,
      warm: SCENE_BLOOM.warmThreshold,
      intensity: SCENE_BLOOM.intensity,
      radius: SCENE_BLOOM.radius,
    });
    bloom.destroy();
  });

  it("pulses over whatever look is in place, and lets go without undoing it", () => {
    const bloom = createSceneBloomFilter();
    expect(String(bloom.glProgram?.fragment)).toContain("uSaturation");
    bloom.setLook(MENU_BLOOM);
    bloom.setPulse({ intensity: 2, saturation: 1.6 });
    expect(bloom.intensity).toBeCloseTo(MENU_BLOOM.intensity * 2);
    expect(bloom.saturation).toBeCloseTo(1.6);
    // A look set mid-pulse is still pulsed.
    bloom.setLook(undefined);
    expect(bloom.intensity).toBeCloseTo(SCENE_BLOOM.intensity * 2);
    bloom.setPulse({ intensity: 1, saturation: 1, tint: 0x8fd3ff, tintAmount: 0.5 });
    expect(bloom.tint.map((value) => Number(value.toFixed(2)))).toEqual([0.56, 0.83, 1, 0.5]);
    bloom.setPulse(undefined);
    expect(bloom.intensity).toBeCloseTo(SCENE_BLOOM.intensity);
    expect(bloom.saturation).toBe(1);
    expect(bloom.tint[3]).toBe(0);
    bloom.destroy();
  });

  it("glows harder and wider on the menu, without opening the white key onto the sky", () => {
    expect(MENU_BLOOM.intensity).toBeGreaterThan(SCENE_BLOOM.intensity * 2);
    expect(MENU_BLOOM.radius).toBeGreaterThan(SCENE_BLOOM.radius * 2);
    expect(MENU_BLOOM.whiteThreshold).toBe(SCENE_BLOOM.whiteThreshold);
  });
});

describe("the scene bloom's passes", () => {
  it("costs a single copy when its intensity is zero", () => {
    const bloom = createSceneBloomFilter({ intensity: 0 });
    const { calls, system } = fakeFilterSystem();
    const input = RenderTexture.create({ width: 8, height: 8 });
    bloom.apply(system, input, input, true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.filter).toBe(bloom);
    bloom.destroy();
  });

  it("extracts, blurs and adds the glow, then returns every texture it borrowed", () => {
    // Breaks if the combine reads a stale or missing glow, or if a pooled
    // texture is kept: that is a screen-sized leak every frame.
    const bloom = createSceneBloomFilter({ intensity: 1 });
    const { calls, system } = fakeFilterSystem(bloom);
    const input = RenderTexture.create({ width: 8, height: 8 });
    const output = RenderTexture.create({ width: 8, height: 8 });
    const returned = vi.spyOn(TexturePool, "returnTexture");

    bloom.apply(system, input, output, true);

    const last = calls[calls.length - 1]!;
    expect(last.filter).toBe(bloom);
    expect(last.input).toBe(input);
    expect(last.output).toBe(output);
    // The first pass reads the picture; the glow the combine binds is one the
    // bloom drew into, not the picture itself.
    expect(calls[0]!.input).toBe(input);
    const glow = bloom.resources["uBloom"];
    expect(glow).not.toBe(input.source);
    const blurred = calls.find((call) => call.filter === bloom["blur"])!;
    expect((blurred.output as RenderTexture).source).toBe(glow);
    // The blur reads the extracted light, not the raw picture.
    expect(blurred.input).toBe(calls[0]!.output);
    expect(returned).toHaveBeenCalledTimes(2);
    returned.mockRestore();
    bloom.destroy();
  });

  it("sizes its blur in logical units, so it matches the art at any zoom", () => {
    // Breaks if the radius is taken as raw pixels: a phone would get a glow
    // several art-pixels wide and a desktop a hairline.
    const bloom = createSceneBloomFilter({ intensity: 1, radius: 6 });
    const { system } = fakeFilterSystem(bloom);
    const input = RenderTexture.create({ width: 8, height: 8 });
    bloom.setPixelsPerUnit(2.5);
    bloom.apply(system, input, input, true);
    expect(bloom["blur"].strength).toBe(15);
    bloom.destroy();
  });
});
