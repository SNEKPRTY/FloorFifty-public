import { describe, expect, it, vi } from "vitest";
import {
  DAWN_REFRACTION_LOOP_SECONDS,
  DAWN_REFRACTION_STILL_SECONDS,
  createDawnRefractionFilter,
  refractionCoefficients,
  refractionQualityFor,
  refractionSampleCount,
  setDawnRefractionFrame,
  setDawnRefractionViewport,
  validateDawnRefractionProgram,
} from "../../../../../apps/client/src/features/render/filters/dawn-refraction";

const fragmentOf = (filter: ReturnType<typeof createDawnRefractionFilter>): string =>
  String(filter.glProgram?.fragment);

type RecordingGl = WebGL2RenderingContext & {
  deleteProgram: ReturnType<typeof vi.fn>;
  deleteShader: ReturnType<typeof vi.fn>;
};

function recordingGl(fragmentCompiles: boolean): RecordingGl {
  let shaderType = 0;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: vi.fn((type: number) => {
      shaderType = type;
      return { type };
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => shaderType !== 0x8b30 || fragmentCompiles),
    getShaderInfoLog: vi.fn(() => "bad fragment"),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => "bad link"),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
  } as unknown as RecordingGl;
}

describe("Dawn Refraction", () => {
  it("uses bounded quality variants", () => {
    expect(refractionSampleCount("high")).toBe(9);
    expect(refractionSampleCount("medium")).toBe(5);
    expect(refractionSampleCount("low")).toBe(5);
    expect(fragmentOf(createDawnRefractionFilter("high"))).toContain("#define FF_TAPS 9");
    expect(fragmentOf(createDawnRefractionFilter("medium"))).toContain("#define FF_TAPS 5");
    const lowSource = fragmentOf(createDawnRefractionFilter("low"));
    expect(lowSource).toContain("#define FF_TAPS 5");
    expect(lowSource).toContain("#define FF_WARP_A 0.0");
    expect(lowSource).toContain("#define FF_CAUSTIC_GAIN 0.0");
  });

  it("makes the animated paths unmistakably refractive", () => {
    const high = fragmentOf(createDawnRefractionFilter("high"));
    expect(high).toContain("#define FF_WARP_A 6.0");
    expect(high).toContain("#define FF_WARP_B 3.2");
    expect(high).toContain("#define FF_RADIUS_MIN 7.0");
    expect(high).toContain("#define FF_RADIUS_MAX 12.0");
    expect(high).toContain("#define FF_CAUSTIC_GAIN .28");

    const medium = fragmentOf(createDawnRefractionFilter("medium"));
    expect(medium).toContain("#define FF_WARP_A 3.5");
    expect(medium).toContain("#define FF_WARP_B 1.8");
    expect(medium).toContain("#define FF_RADIUS_MIN 5.5");
    expect(medium).toContain("#define FF_RADIUS_MAX 8.5");
    expect(medium).toContain("#define FF_CAUSTIC_GAIN .16");
  });

  it("clamps every warped lookup to the filter frame", () => {
    const source = fragmentOf(createDawnRefractionFilter("high"));
    expect(source).toContain("uniform vec4 uInputClamp");
    expect(source).toContain("texture(uTexture, clamp(coord, uInputClamp.xy, uInputClamp.zw))");
    expect(source).not.toMatch(/texture\(uTexture,\s*coord\)/);
  });

  it("loops time and clamps entry intensity", () => {
    const filter = createDawnRefractionFilter("high");
    setDawnRefractionFrame(filter, DAWN_REFRACTION_LOOP_SECONDS + 2, 4);
    const uniforms = filter.resources.refractionUniforms.uniforms;
    expect(uniforms.uTime).toBe(2);
    expect(uniforms.uIntensity).toBe(1);
    expect([...uniforms.uResolution]).toEqual([960, 540]);
    expect(DAWN_REFRACTION_STILL_SECONDS).toBeLessThan(DAWN_REFRACTION_LOOP_SECONDS);
  });

  it("accepts a gated low-quality inspection override", () => {
    expect(refractionQualityFor("?refraction=low", true)).toBe("low");
    expect(refractionQualityFor("?refraction=low", false)).toBe("high");
  });

  it("surfaces fragment compile failures and releases temporary WebGL objects", () => {
    const gl = recordingGl(false);
    const filter = createDawnRefractionFilter("high");

    expect(() => validateDawnRefractionProgram(gl, filter)).toThrow("bad fragment");
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
  });

  it("validates and releases a linked program", () => {
    const gl = recordingGl(true);
    const filter = createDawnRefractionFilter("high");

    expect(() => validateDawnRefractionProgram(gl, filter)).not.toThrow();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
  });
});

describe("the gameplay profile", () => {
  it("leaves the menu's constants exactly as they were authored", () => {
    // The default profile is unity. If this drifts, the menu's look changed
    // without anyone deciding to change it.
    expect(refractionCoefficients("high")).toEqual(refractionCoefficients("high", "menu"));
    expect(fragmentOf(createDawnRefractionFilter("high"))).toContain("#define FF_WARP_A 6.0");
    expect(fragmentOf(createDawnRefractionFilter("high"))).toContain("#define FF_CAUSTIC_GAIN .28");
  });

  it("scales the high profile down to the bound the spec states", () => {
    const high = refractionCoefficients("high", "gameplay");

    // 6.0 and 3.2 scaled by 0.45, then multiplied by the 0.65 gameplay
    // intensity: about 2.7 logical units of combined warp. That is what makes
    // "visibly refracted, never swimming" a measurement.
    expect(high.warpA).toBeCloseTo(2.7);
    expect(high.warpB).toBeCloseTo(1.44);
    expect((high.warpA + high.warpB) * 0.65).toBeCloseTo(2.69, 1);
    expect(high.radiusMin).toBeCloseTo(3.15);
    expect(high.radiusMax).toBeCloseTo(5.4);
    expect(high.causticGain).toBeCloseTo(0.14);
  });

  it("compiles the profile into the shader rather than feeding it at runtime", () => {
    // A uniform would let the strength change per frame; a define is what keeps
    // the driver looking at a fixed tap count and fixed constants.
    const gameplay = String(createDawnRefractionFilter("high", "gameplay").glProgram?.fragment);

    expect(gameplay).toContain("#define FF_WARP_A 2.7");
    expect(gameplay).not.toContain("#define FF_WARP_A 6.0");
    expect(gameplay).toContain("#define FF_TAPS 9");
  });

  it("keeps low a static diffusion in either profile", () => {
    for (const profile of ["menu", "gameplay"] as const) {
      const low = refractionCoefficients("low", profile);
      expect(low.warpA).toBe(0);
      expect(low.warpB).toBe(0);
      expect(low.radiusMin).toBe(low.radiusMax);
    }
  });
});

describe("mapping the active frame onto the logical rectangle", () => {
  const logical = { x: -40, y: -120, width: 489, height: 1059 };
  const target = { width: 504, height: 1092 };

  it("records the rectangle and the surface it is shaded into", () => {
    const filter = createDawnRefractionFilter("high", "gameplay");
    setDawnRefractionViewport(filter, logical, target);
    const uniforms = filter.resources.refractionUniforms.uniforms;

    expect([...uniforms.uResolution]).toEqual([489, 1059]);
    expect([...uniforms.uLogicalOrigin]).toEqual([-40, -120]);
    expect([...uniforms.uTargetSize]).toEqual([504, 1092]);
  });

  it("writes in place, so the uploader sees the change", () => {
    // The uniform group holds these arrays by reference; a replaced array
    // would be a second object nothing ever reads.
    const filter = createDawnRefractionFilter("high");
    const before = filter.resources.refractionUniforms.uniforms.uResolution;

    setDawnRefractionViewport(filter, logical, target);

    expect(filter.resources.refractionUniforms.uniforms.uResolution).toBe(before);
  });

  it("derives the coordinates from the logical size, not a pooled one", () => {
    // The whole point of the mapping. A pooled width in this expression is what
    // made the effect change strength with device pixel ratio, and what made a
    // frost cell crawl when a target was re-fitted.
    const source = String(createDawnRefractionFilter("high", "gameplay").glProgram?.fragment);

    // Every coordinate is made frame-relative first. `vTextureCoord` spans the
    // active frame only as a fraction of the pooled texture, and that fraction
    // differs per axis, so using it directly stretched the warp.
    expect(source).toContain("frameToTexture");
    expect(source).toContain("uLogicalOrigin + frameUv * uResolution");
    expect(source).toContain("/ uResolution");
  });

  it("blurs by one reach everywhere, so a scrolling skyline does not boil", () => {
    // The frame is pinned to the screen and the scenery scrolls through it as
    // the camera climbs. A reach drawn per 8 px cell changed under every edge
    // as it crossed a cell, which read as the skyline boiling while climbing.
    for (const quality of ["high", "medium", "low"] as const) {
      const source = String(createDawnRefractionFilter(quality, "menu").glProgram?.fragment);
      expect(source).not.toContain("hashCell");
      expect(source).toContain("float radiusPx = 0.5 * (FF_RADIUS_MIN + FF_RADIUS_MAX);");
    }
  });

  it("takes no tap from straight below, so a rooftop does not drip into the sky", () => {
    // Texture y runs down the screen: a (0, 1) tap reads the pixel below, and
    // smeared each rooftop's colour up into the sky above it.
    for (const quality of ["high", "medium"] as const) {
      const source = String(createDawnRefractionFilter(quality, "gameplay").glProgram?.fragment);
      expect(source).not.toContain("vec2(0.0, 1.0)");
    }
  });
});

describe("the clear-glass profile (spec §2.9)", () => {
  it("warps without diffusing, and samples texel centres", () => {
    const source = String(createDawnRefractionFilter("high", "glass").glProgram?.fragment);
    expect(source).toContain("#define FF_DIFFUSION 0");
    expect(source).toContain("#define FF_NEAREST 1");
    // The glass keeps the warp, gentler than the sky's.
    const glass = refractionCoefficients("high", "glass");
    const sky = refractionCoefficients("high", "gameplay");
    expect(glass.warpA).toBeGreaterThan(0);
    expect(glass.warpA).toBeLessThan(sky.warpA);
    expect(glass.causticGain).toBe(0);
  });

  it("leaves the sky's profiles diffusing as before", () => {
    for (const profile of ["menu", "gameplay"] as const) {
      const source = String(createDawnRefractionFilter("high", profile).glProgram?.fragment);
      expect(source, profile).toContain("#define FF_DIFFUSION 1");
      expect(source, profile).toContain("#define FF_NEAREST 0");
    }
  });

  it("renders the glass at the canvas's own resolution", () => {
    expect(createDawnRefractionFilter("high", "glass").resolution).toBe("inherit");
  });
});
