/**
 * Dawn Refraction is the bounded optical pass used behind non-gameplay UI.
 *
 * Quality is compiled into the shader so the driver sees a fixed tap count.
 * All offsets remain in the 960 x 540 logical composition and every texture
 * read is clamped to Pixi's active filter frame, never pooled texture memory.
 */

import { Filter, GlProgram } from "pixi.js";
import type { ViewRect } from "../stage-port";
import { QUALITY_LEVEL, type QualityLevel } from "../../profile/quality";
import { DEFAULT_FILTER_VERT } from "./default-vert";

export const DAWN_REFRACTION_LOOP_SECONDS = 18;
export const DAWN_REFRACTION_STILL_SECONDS = 6.75;

type RefractionUniforms = {
  uResolution: Float32Array;
  uLogicalOrigin: Float32Array;
  uTargetSize: Float32Array;
  uTime: number;
  uIntensity: number;
};

export type DawnRefractionFilter = Filter & {
  resources: { refractionUniforms: { uniforms: RefractionUniforms } };
};

export type RefractionProfile = "menu" | "gameplay" | "glass";

/**
 * How much of each quality constant a profile keeps.
 *
 * Two profiles because the same optics read differently at rest and in motion.
 * Behind a still menu an optical swell is the whole point; behind a course the
 * camera is following a racer across, the same swell reads as swim. So the
 * gameplay profile scales the constants that move geometry, and halves the
 * caustic gain because the sky is mostly empty and a caustic there is a
 * highlight with nothing to catch it.
 *
 * The numbers are the spec's 0.45 / 0.45 / 0.5. Combined with gameplay's 0.65
 * intensity they bound the high profile's warp to about 2.7 logical units,
 * which is what makes "visibly refracted, never swimming" a measurement rather
 * than an opinion. The menu profile is unity: its look is unchanged.
 */
export const REFRACTION_PROFILES = {
  menu: { warp: 1, radius: 1, caustic: 1, diffusion: 1 },
  gameplay: { warp: 0.45, radius: 0.45, caustic: 0.5, diffusion: 1 },
  /**
   * Clear glass, for the city (launch polish spec §2.9): the warp alone,
   * gentler than the sky's, with no diffusion and no caustic, sampled at
   * texel centres. The skyline ripples as if seen through glass and every
   * pixel stays a hard-edged palette pixel -- blur stays confined to the sky.
   */
  glass: { warp: 0.35, radius: 0, caustic: 0, diffusion: 0 },
} as const satisfies Record<
  RefractionProfile,
  { warp: number; radius: number; caustic: number; diffusion: number }
>;

/**
 * The authored constants, per quality, before any profile scaling.
 *
 * Data rather than shader text because the profile has to multiply them and a
 * string cannot be multiplied. The emitted `#define` values are the product,
 * so the driver still sees a fixed tap count and fixed constants.
 */
const BASE_CONSTANTS = {
  high: { taps: 9, warpA: 6.0, warpB: 3.2, radiusMin: 7.0, radiusMax: 12.0, causticGain: 0.28 },
  medium: { taps: 5, warpA: 3.5, warpB: 1.8, radiusMin: 5.5, radiusMax: 8.5, causticGain: 0.16 },
  low: { taps: 5, warpA: 0.0, warpB: 0.0, radiusMin: 4.0, radiusMax: 4.0, causticGain: 0.0 },
} as const;

export type RefractionCoefficients = {
  taps: 9 | 5;
  warpA: number;
  warpB: number;
  radiusMin: number;
  radiusMax: number;
  causticGain: number;
  /** 1 where the frosted diffusion runs, 0 for clear glass. */
  diffusion: number;
};

/** The constants a given quality and profile actually compile to. */
export function refractionCoefficients(
  quality: QualityLevel,
  profile: RefractionProfile = "menu",
): RefractionCoefficients {
  const base = BASE_CONSTANTS[quality];
  const scale = REFRACTION_PROFILES[profile];
  return {
    taps: base.taps,
    warpA: base.warpA * scale.warp,
    warpB: base.warpB * scale.warp,
    radiusMin: base.radiusMin * scale.radius,
    radiusMax: base.radiusMax * scale.radius,
    causticGain: base.causticGain * scale.caustic,
    diffusion: scale.diffusion,
  };
}

/**
 * Formats a coefficient the way the shader source has always spelled them.
 *
 * A sub-unit constant loses its leading zero, which is how `.28` was written by
 * hand; generating from data has to reproduce that or the menu profile would
 * compile to a different string from the one the existing assertions describe.
 */
const formatCoefficient = (value: number): string => {
  let text = value.toFixed(3).replace(/0+$/, "");
  if (text.endsWith(".")) text += "0";
  if (value !== 0 && text.startsWith("0.")) text = text.slice(1);
  return text;
};

const variantFor = (quality: QualityLevel, profile: RefractionProfile): string => {
  const c = refractionCoefficients(quality, profile);
  return `#define FF_TAPS ${c.taps}
#define FF_WARP_A ${formatCoefficient(c.warpA)}
#define FF_WARP_B ${formatCoefficient(c.warpB)}
#define FF_RADIUS_MIN ${formatCoefficient(c.radiusMin)}
#define FF_RADIUS_MAX ${formatCoefficient(c.radiusMax)}
#define FF_CAUSTIC_GAIN ${formatCoefficient(c.causticGain)}
#define FF_DIFFUSION ${c.diffusion > 0 ? 1 : 0}
#define FF_NEAREST ${profile === "glass" ? 1 : 0}`;
};

/**
 * The caustic band that rolls across the refracted sky, as GLSL.
 *
 * Shared so a pass downstream can find the band without guessing at it: the
 * scene bloom damps its white key along exactly this ridge (`scene-bloom.ts`).
 * `p` is logical position over the logical height; `phase` is one loop in
 * radians.
 */
export const DAWN_CAUSTIC_GLSL = `float dawnCaustic(vec2 p, float phase) {
  float ridgeA = sin(p.x * 3.2 + p.y * 1.3 + phase);
  float ridgeB = sin(-p.x * 1.5 + p.y * 2.8 - phase * 2.0);
  return pow(clamp(.5 + .25 * (ridgeA + ridgeB), 0.0, 1.0), 6.0);
}`;

const fragmentFor = (quality: QualityLevel, profile: RefractionProfile): string => `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
// Pixi's filter globals, declared by the default vertex stage too.
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uResolution;
uniform vec2 uLogicalOrigin;
uniform vec2 uTargetSize;
uniform float uTime;
uniform float uIntensity;

${variantFor(quality, profile)}

${DAWN_CAUSTIC_GLSL}

vec4 sampleFrame(vec2 coord) {
#if FF_NEAREST
  // Clear glass: the warp moves which texel is read, never blends two, so a
  // rippled skyline keeps its hard pixel edges.
  coord = (floor(coord * uInputSize.xy) + 0.5) * uInputSize.zw;
#endif
  return texture(uTexture, clamp(coord, uInputClamp.xy, uInputClamp.zw));
}

// No tap from straight below: texture y runs down the screen, so a (0, 1)
// tap smeared each rooftop's colour up into the sky above it, which the
// palette lock then hardened into blue drips. The weights left still sum to
// one: the dropped tap's share is spread over the rest.
#if FF_TAPS == 9
const vec2 TAP_OFFSETS[8] = vec2[8](
  vec2(0.0), vec2(1.0, 0.0), vec2(-1.0, 0.0),
  vec2(0.0, -1.0),
  vec2(.707, .707), vec2(-.707, .707),
  vec2(.707, -.707), vec2(-.707, -.707)
);
const float TAP_WEIGHTS[8] = float[8](
  .20 / .88, .12 / .88, .12 / .88, .12 / .88, .08 / .88, .08 / .88, .08 / .88, .08 / .88
);
#define FF_TAP_COUNT 8
#else
const vec2 TAP_OFFSETS[4] = vec2[4](
  vec2(0.0), vec2(1.0, 0.0), vec2(-1.0, 0.0),
  vec2(0.0, -1.0)
);
const float TAP_WEIGHTS[4] = float[4](.28 / .82, .18 / .82, .18 / .82, .18 / .82);
#define FF_TAP_COUNT 4
#endif

void main() {
  const float PI = 3.141592653589793;
  float phase = uTime / 18.0 * 2.0 * PI;
  // vTextureCoord is not frame-relative. The filter renders into a pooled
  // texture at least as large as the frame, and the frame covers only
  // uOutputFrame.zw * uInputSize.zw of it -- a fraction that differs per
  // axis. Reading it as if the frame were the whole texture stretched the warp
  // unevenly and moved it with device pixel ratio. So every coordinate is made
  // frame-relative first, and converted back only to sample.
  vec2 frameToTexture = uOutputFrame.zw * uInputSize.zw;
  vec2 frameUv = vTextureCoord / frameToTexture;
  // Frame-relative, the frame is exactly the logical rectangle the target was
  // fitted to, so the mapping is one multiply and one add, and no pooled
  // texture dimension appears in it.
  vec2 logical = uLogicalOrigin + frameUv * uResolution;
  vec2 p = logical / uResolution.y;

  vec2 warpA = vec2(
    sin(p.y * 5.0 + phase),
    sin(p.x * 4.0 - phase)
  );
  vec2 warpB = vec2(
    sin((p.x + p.y) * 3.0 - phase * 2.0),
    sin((p.x - p.y) * 3.5 + phase * 2.0)
  );
  // Warp and radius are authored in logical units -- the 960-wide composition
  // -- and become frame coordinates by dividing by the logical size.
  vec2 warped = frameUv + (warpA * FF_WARP_A + warpB * FF_WARP_B)
    * uIntensity / uResolution;

  // One reach everywhere, the middle of the authored range. The frame is
  // pinned to the screen and the scenery scrolls through it as the camera
  // climbs, so a reach drawn per screen cell changed under every edge as it
  // crossed one: the skyline boiled while climbing and settled when still.
  float radiusPx = 0.5 * (FF_RADIUS_MIN + FF_RADIUS_MAX);
  vec4 centre = sampleFrame(warped * frameToTexture);
#if FF_DIFFUSION
  vec4 diffused = vec4(0.0);
  for (int i = 0; i < FF_TAP_COUNT; i++) {
    vec2 tap = warped + TAP_OFFSETS[i] * radiusPx / uResolution;
    diffused += sampleFrame(tap * frameToTexture) * TAP_WEIGHTS[i];
  }
#endif

  float caustic = dawnCaustic(p, phase);

#if FF_DIFFUSION
  vec4 softened = mix(centre, diffused, uIntensity);
#else
  vec4 softened = centre;
#endif
  softened.rgb *= 1.0 + caustic * FF_CAUSTIC_GAIN * uIntensity;
  finalColor = vec4(clamp(softened.rgb, 0.0, 1.0), softened.a);
}
`;

export const refractionSampleCount = (quality: QualityLevel): 9 | 5 =>
  quality === "high" ? 9 : 5;

/**
 * The `?refraction=` level an inspection build asked for, or undefined.
 *
 * Split from `refractionQualityFor` so the player's quality setting can sit
 * between the override and the default (launch polish §3.1.2).
 */
export function refractionOverrideFor(
  search: string,
  allowInspectionOverride: boolean,
): QualityLevel | undefined {
  if (!allowInspectionOverride) return undefined;
  const value = new URLSearchParams(search).get("refraction");
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export function refractionQualityFor(
  search: string,
  allowInspectionOverride: boolean,
): QualityLevel {
  return refractionOverrideFor(search, allowInspectionOverride) ?? QUALITY_LEVEL;
}

export function createDawnRefractionFilter(
  quality: QualityLevel,
  profile: RefractionProfile = "menu",
): DawnRefractionFilter {
  return new Filter({
    glProgram: GlProgram.from({
      vertex: DEFAULT_FILTER_VERT,
      fragment: fragmentFor(quality, profile),
    }),
    resources: {
      refractionUniforms: {
        // Defaults describe the menu's case: the logical composition, no
        // origin, and a target equal to the logical size. A bounded scenery
        // target overwrites all three through `setDawnRefractionViewport`, and
        // a filter that is never told keeps the behaviour it had before there
        // was a target at all.
        uResolution: { value: new Float32Array([960, 540]), type: "vec2<f32>" },
        uLogicalOrigin: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        uTargetSize: { value: new Float32Array([960, 540]), type: "vec2<f32>" },
        uTime: { value: 0, type: "f32" },
        uIntensity: { value: 0.85, type: "f32" },
      },
    },
    // The glass shades the city at the canvas's own resolution; a filter at
    // Pixi's default of 1 would halve it on a dense display. The sky's
    // profiles run inside their bounded target and keep the default.
    ...(profile === "glass" ? { resolution: "inherit" as const } : {}),
  }) as DawnRefractionFilter;
}

/**
 * Tells the pass which piece of the logical world the frame it is shading
 * covers, and how many pixels it has to do it in.
 *
 * Written in place rather than by replacing the arrays: the uniform group holds
 * these by reference, and a fresh array would be a second object the uploader
 * never looks at.
 */
export function setDawnRefractionViewport(
  filter: DawnRefractionFilter,
  logicalRect: ViewRect,
  targetSize: { width: number; height: number },
): void {
  const uniforms = filter.resources.refractionUniforms.uniforms;
  uniforms.uResolution[0] = logicalRect.width;
  uniforms.uResolution[1] = logicalRect.height;
  uniforms.uLogicalOrigin[0] = logicalRect.x;
  uniforms.uLogicalOrigin[1] = logicalRect.y;
  uniforms.uTargetSize[0] = targetSize.width;
  uniforms.uTargetSize[1] = targetSize.height;
}

/** Compile and link Pixi's exact sources against the active renderer. */
export function validateDawnRefractionProgram(
  gl: WebGLRenderingContextBase,
  filter: DawnRefractionFilter,
): void {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    throw new Error("Unable to allocate Dawn Refraction WebGL validation objects");
  }

  try {
    const compile = (shader: WebGLShader, source: string): void => {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Dawn Refraction shader compilation failed");
      }
    };

    compile(vertex, String(filter.glProgram?.vertex));
    compile(fragment, String(filter.glProgram?.fragment));
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Dawn Refraction program link failed");
    }
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
  }
}

export function setDawnRefractionFrame(
  filter: DawnRefractionFilter,
  timeSeconds: number,
  intensity: number,
): void {
  const uniforms = filter.resources.refractionUniforms.uniforms;
  uniforms.uTime = Math.max(0, timeSeconds) % DAWN_REFRACTION_LOOP_SECONDS;
  uniforms.uIntensity = Math.min(1, Math.max(0, intensity));
}
