/**
 * Heat on the sun: the disc seen through air hot enough to bend it.
 *
 * Three layers, all keyed to one clock, all worked in **disc radii** -- the
 * distance from the sun's centre over its radius -- so the look is the same
 * size on the race's sprite and on the menu's painted plate:
 *
 * - **The silhouette is liquified.** The disc is sampled through a polar
 *   wobble -- broad lobes, then finer ripples on the lobes -- and a flowing
 *   field of sines fed into sines, so the rim bulges and pinches the way a
 *   liquify brush drags an image, and never holds a circle.
 * - **Heat wisps.** Wavy strokes of the sun's own light hang in the air around
 *   it: some follow the rim in broken rings, some rise and wander as the air
 *   climbs. Drawn over the sky, out to a couple of radii.
 * - **A glow** close around the rim, so the wisps have light to come out of.
 *
 * Hung on the race's sun sprite, the pass covers the sprite and its padding;
 * the padding is re-told as the sun is drawn larger or smaller (`StageLayers`),
 * since the wisps live out in it. On the menu the sun is painted into the
 * plate, so the pass runs over the plate with a **region** -- the painted
 * disc -- and fades out a few radii from it, leaving the rest as drawn. The
 * skyline in front of that sun is inside the fade and bends with the heat,
 * which is what air over a horizon does.
 *
 * The sky plate's palette lock runs after this, so the wisps and the glow land
 * on swatches like everything else in the sky.
 */

import { Filter, GlProgram } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";

/** The authored look. Distances are in disc radii. */
export const SUN_SHIMMER = {
  /** How far the rim bulges and pinches. */
  wobble: 0.16,
  /** How far the flowing warp drags the whole disc. */
  liquify: 0.09,
  /** How strongly the heat wisps show, 0 to 1. */
  wisps: 0.6,
  /** The glow hugging the rim, 0 to 1. */
  glow: 0.35,
  /** Seconds-scale of every motion. Higher is more restless. */
  speed: 1,
  /** Room around the pass, in the pass's own units; the race re-tells it per frame. */
  padding: 16,
} as const;

/** The look's knobs, as numbers rather than the authored literals. */
export type ShimmerLook = { [K in keyof typeof SUN_SHIMMER]: number };

/** How far out the wisps reach, in disc radii. The race pads for this. */
export const SUN_SHIMMER_REACH = 2.4;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uTime;
uniform float uWobble;
uniform float uLiquify;
uniform float uWisps;
uniform float uGlow;
uniform float uSpeed;
// xy: the disc's centre, zw: its radii, in frame-relative UV. Only read when
// uMasked is set; otherwise the disc is the frame less its padding.
uniform vec4 uRegion;
uniform float uMasked;
// The pass's padding, in the units of uOutputFrame.
uniform float uPadding;

const float TAU = 6.283185307179586;
const float REACH = ${SUN_SHIMMER_REACH.toFixed(2)};

vec4 sampleFrame(vec2 frameUv, vec2 frameToTexture) {
  return texture(uTexture, clamp(frameUv * frameToTexture, uInputClamp.xy, uInputClamp.zw));
}

// The flowing drag: each axis a sine whose phase is a sine of the other, so
// the flow folds and curls. Two octaves, and it rises.
vec2 flow(vec2 d, float t) {
  vec2 q = d * 1.3 + vec2(0.0, t * 0.35);
  vec2 f = vec2(
    sin(q.y * 2.1 + t * 1.3 + 1.5 * sin(q.x * 1.7 - t * 0.7)),
    sin(q.x * 1.9 - t * 0.9 + 1.5 * sin(q.y * 2.3 + t * 1.1))
  );
  f += 0.45 * vec2(sin(q.y * 4.7 - t * 2.1 + q.x * 1.3), sin(q.x * 4.3 + t * 1.7 - q.y * 0.9));
  return f / 1.45;
}

// How far the rim is pushed out (+) or pulled in (-) at angle a: a few broad
// lobes that drift round, and finer ripples riding on them.
float rimWobble(float a, float t) {
  float lobes = sin(3.0 * a + t * 0.6 + 1.2 * sin(2.0 * a - t * 0.4));
  float ripples = sin(7.0 * a - t * 1.4 + 0.8 * sin(5.0 * a + t * 0.9));
  float fine = sin(13.0 * a + t * 2.3);
  return lobes * 0.6 + ripples * 0.3 + fine * 0.1;
}

// Wavy strokes of heat around the disc, 0 to 1. r and a are polar, in radii.
float wisps(vec2 d, float r, float a, float t) {
  // Broken rings following the rim: wavy in radius, cut into dashes that
  // slide round the disc.
  float ringR = r + 0.12 * sin(5.0 * a + t * 1.1) + 0.06 * sin(11.0 * a - t * 1.7);
  float ring = pow(max(0.0, sin(ringR * 9.0 - t * 1.2)), 10.0);
  ring *= smoothstep(0.1, 0.7, sin(a * 4.0 + ringR * 3.0 + t * 0.5));

  // Rising strands: vertical lines bent by the air, cut short so they read
  // as strokes, and climbing.
  float x = d.x + 0.22 * sin(d.y * 3.2 - t * 1.6 + d.x * 1.3) + 0.07 * sin(d.y * 9.0 - t * 2.8);
  float strand = pow(max(0.0, sin(x * 5.5)), 14.0);
  float column = floor(x * 5.5 / TAU + 0.5);
  strand *= smoothstep(0.2, 0.8, sin(d.y * 1.7 + column * 2.3 - t * 0.9));

  float band = smoothstep(1.02, 1.25, r) * (1.0 - smoothstep(REACH - 0.7, REACH, r));
  return max(ring, strand * 0.85) * band;
}

void main() {
  vec2 frameToTexture = uOutputFrame.zw * uInputSize.zw;
  vec2 frameUv = vTextureCoord / frameToTexture;

  vec2 padUv = uPadding / max(uOutputFrame.zw, vec2(1.0));
  vec4 region = uMasked > 0.5 ? uRegion : vec4(0.5, 0.5, 0.5 - padUv.x, 0.5 - padUv.y);
  vec2 centre = region.xy;
  vec2 radius = max(region.zw, vec2(1e-4));

  // Disc space: the rim is at length 1.
  vec2 d = (frameUv - centre) / radius;
  float r = length(d);
  // Nothing past the reach is touched, which on the menu is most of the plate.
  float cover = 1.0 - smoothstep(REACH - 0.5, REACH, r);
  if (cover <= 0.0) {
    finalColor = sampleFrame(frameUv, frameToTexture);
    return;
  }

  float t = uTime * uSpeed;
  float a = atan(d.y, d.x);

  // Heat is below: the lower half moves more, but the top never sits still.
  float heat = mix(0.7, 1.15, smoothstep(-1.0, 1.2, d.y));

  // The liquify: read from a rim pushed in or out, then dragged by the flow.
  // Scaling the sampled radius by the wobble moves the silhouette itself; the
  // falloff keeps the wobble on the rim rather than smearing the centre.
  float onRim = smoothstep(0.0, 0.8, r) * (1.0 - smoothstep(1.4, REACH, r));
  float push = rimWobble(a, t) * uWobble * heat * onRim;
  vec2 bent = d / (1.0 + push);
  bent += flow(d, t) * uLiquify * heat * cover;
  vec4 picture = sampleFrame(centre + bent * radius, frameToTexture);

  // The sun's own light, from its heart, colours what the heat carries.
  vec4 heart = sampleFrame(centre, frameToTexture);
  vec3 light = heart.a > 0.0 ? heart.rgb / heart.a : vec3(1.0);
  light = mix(light, vec3(1.0), 0.25);

  // The glow, falling off from the (wobbling) rim.
  float rimR = r / (1.0 + push);
  float glow = uGlow * exp(-max(0.0, rimR - 1.0) * 3.0) * smoothstep(0.85, 1.0, rimR) * cover;
  // The wisps, drawn over sky and glow alike.
  float stroke = uWisps * wisps(d, r, a, t) * heat * cover;

  float lift = clamp(max(glow, stroke), 0.0, 1.0);
  // Premultiplied, and opaque where the sun's light lands: over an empty sky
  // the sprite has nothing under it, so the light must bring its own alpha.
  finalColor = vec4(light * lift, lift) + picture * (1.0 - lift);
}
`;

type ShimmerUniforms = { uTime: number; uPadding: number };

export type SunShimmerFilter = Filter & {
  resources: { shimmerUniforms: { uniforms: ShimmerUniforms } };
};

/**
 * Where on the frame the painted sun is, for a sun painted into a larger plate.
 *
 * Frame-relative UV: the disc's centre and radii as fractions of the frame's
 * width and height. Omitted, the disc is the frame less its padding -- the
 * race's sun sprite.
 */
export type ShimmerRegion = { x: number; y: number; radiusX: number; radiusY: number };

export function createSunShimmerFilter(
  options: Partial<ShimmerLook> & { region?: ShimmerRegion } = {},
): SunShimmerFilter {
  const { region, ...rest } = options;
  const look = { ...SUN_SHIMMER, ...rest };
  const area = region ?? { x: 0.5, y: 0.5, radiusX: 0.5, radiusY: 0.5 };
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: FRAGMENT }),
    resources: {
      shimmerUniforms: {
        uTime: { value: 0, type: "f32" },
        uWobble: { value: look.wobble, type: "f32" },
        uLiquify: { value: look.liquify, type: "f32" },
        uWisps: { value: look.wisps, type: "f32" },
        uGlow: { value: look.glow, type: "f32" },
        uSpeed: { value: look.speed, type: "f32" },
        uRegion: { value: new Float32Array([area.x, area.y, area.radiusX, area.radiusY]), type: "vec4<f32>" },
        uMasked: { value: region === undefined ? 0 : 1, type: "f32" },
        uPadding: { value: look.padding, type: "f32" },
      },
    },
    padding: look.padding,
    // The disc is placed in the frame's UV, so the frame must be the whole
    // sprite or plate even where it hangs past the screen.
    clipToViewport: false,
  }) as SunShimmerFilter;
}

/** Advances the heat. Seconds, off the ambient clock. */
export function setSunShimmerTime(filter: SunShimmerFilter, seconds: number): void {
  filter.resources.shimmerUniforms.uniforms.uTime = seconds;
}

/**
 * Sets the room around the pass, and tells the shader, which needs it to find
 * the disc inside the padded frame.
 */
export function setSunShimmerPadding(filter: SunShimmerFilter, padding: number): void {
  filter.padding = padding;
  filter.resources.shimmerUniforms.uniforms.uPadding = padding;
}
