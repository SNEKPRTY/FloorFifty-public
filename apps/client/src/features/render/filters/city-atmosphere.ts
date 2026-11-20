/**
 * City atmosphere.
 *
 * Window glow and a soft bloom on emissive pixels. Both are keyed off the
 * window swatch: a pixel that matches it is a light, and nothing else in the
 * frame is treated as one. That keeps the glow off a player's costume, which
 * shares hues with the warm end of the palette.
 *
 * Two filters rather than one. The scenery no longer uses the bloom -- it is a
 * blur, and the city is drawn crisp -- but the world's marks still glow
 * through it. The beat's glow reaches the city's windows through the twinkle
 * pass instead, as a brightening of the lit pixels (`setCityGlow`).
 *
 * Each window's brightness is computed in the shader rather than per sprite,
 * because a lit window is a pixel rather than a display object and there are
 * several hundred of them. Every window rests at its own step of a four-swatch
 * warm ramp and breathes around it on its own period, which is what makes the
 * Aquarian board's city look lived in: a few windows burn pale, most are
 * amber, some have sunk low. Which window a pixel belongs to is baked into the
 * texture (`window-code.ts`), so the rhythm stays with the window as it moves.
 */

import { Filter, GlProgram } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";

const TWINKLE_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec3 uWindow;
uniform vec3 uDim;
uniform vec3 uBright;
uniform vec3 uHot;
uniform float uCoded;
uniform float uTime;
uniform float uGlow;
// A set piece's lights-out wave (Wonder spec §6.4): how far up the screen it
// has climbed, 0 to 1; whether the lights it covers go dark (0) or blaze (1);
// and how far the lights have come back on, from the bottom up, 0 to 1.
uniform vec3 uLightsOut;

// How far a window's level rises per unit of glow. The song's and a slam's
// lift is capped at one unit (\`WINDOW_SWING\` in gameplay-backdrop.ts) and
// rate-limited there, so on the beat a window climbs at most one step of the
// ramp, under three times a second: the windows dance, the city never flashes.
const float GLOW_GAIN = 0.3;

float hash(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  vec3 rgb = source.rgb / max(source.a, 0.001);

  bool isWindow = source.a > 0.0 && distance(rgb, uWindow) < 0.08;
  if (!isWindow) {
    finalColor = source;
    return;
  }

  // Which window this is. Baked into the texel (see window-code.ts), so it
  // travels with the window however the city scrolls. Without the bake, the
  // screen cell stands in for it, as the twinkle always did.
  float id;
  if (uCoded > 0.5) {
    vec3 code = floor((rgb - uWindow) * 255.0 + 0.5);
    id = clamp(code.g, 0.0, 7.0) * 8.0 + clamp(code.b, 0.0, 7.0);
  } else {
    id = floor(hash(dot(floor(vTextureCoord * uInputSize.xy / 4.0), vec2(1.0, 157.0))) * 64.0);
  }

  // Each window keeps its own resting brightness and breathes around it on its
  // own slow period, four to twelve seconds, so the city never pulses as one.
  float phase = hash(id * 1.7 + 0.3);
  float base = hash(id * 3.1 + 1.9);
  float rate = 0.5 + phase * 1.0;
  float level = 0.2 + base * 0.6 + 0.2 * sin(uTime * rate + phase * 6.2831) + uGlow * GLOW_GAIN;

  // Swatch steps rather than a blend: every tone is already on the palette.
  vec3 tone = level < 0.3 ? uDim : level < 0.6 ? uWindow : level < 0.85 ? uBright : uHot;

  // Now and then a light goes out for a moment, as the twinkle always had.
  float lit = step(0.08, fract(phase * 7.0 + uTime * 0.05));

  // The wave climbs from the bottom of the screen, and the lights come back
  // the same way: covered between the wave's top and the relit band's top.
  float below = step(0.001, uLightsOut.x) * step(1.0 - uLightsOut.x, vTextureCoord.y) * step(vTextureCoord.y, 1.0 - uLightsOut.z);
  lit = mix(lit, uLightsOut.y > 0.5 ? 1.0 : 0.0, below);
  tone = mix(tone, uHot, below * step(0.5, uLightsOut.y));
  finalColor = vec4(tone * lit * source.a, source.a);
}
`;

const BLOOM_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec3 uWindow;
uniform vec3 uKeyB;
uniform vec3 uKeyC;
uniform float uKeyCount;
uniform float uTolerance;
uniform float uStrength;

void main() {
  vec4 source = texture(uTexture, vTextureCoord);

  // Emissive-only, and keyed by colour rather than by brightness: a pixel
  // glows because it is one of the things that emits, never because it is
  // light. A costume shares hues with the warm end of the palette, and a
  // luminance-keyed bloom would set the racers alight.
  //
  // The tolerance is a uniform because how close is close enough depends on
  // what else is on the layer. The pending-floor mark sits 0.081 from the
  // scarlet racer in unit RGB, which is inside the tolerance the city uses, so
  // the pass that blooms the marks runs tighter than the pass that blooms
  // windows -- otherwise one seat would catch fire and no other would.
  float glowA = 0.0;
  float glowB = 0.0;
  float glowC = 0.0;

  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      vec4 near = texture(uTexture, vTextureCoord + vec2(float(i), float(j)) * uInputSize.zw);
      if (near.a <= 0.0) continue;
      vec3 rgb = near.rgb / max(near.a, 0.001);
      if (distance(rgb, uWindow) < uTolerance) glowA += 0.04;
      if (uKeyCount > 1.5 && distance(rgb, uKeyB) < uTolerance) glowB += 0.04;
      if (uKeyCount > 2.5 && distance(rgb, uKeyC) < uTolerance) glowC += 0.04;
    }
  }

  vec3 added = (uWindow * glowA + uKeyB * glowB + uKeyC * glowC) * uStrength;
  float coverage = (glowA + glowB + glowC) * uStrength;
  finalColor = vec4(source.rgb + added, max(source.a, coverage));
}
`;

const channels = (color: number): Float32Array =>
  new Float32Array([
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  ]);

export function createCityFilter(options: {
  window: number;
  /** The ramp a window steps along; see the `cityWindow*` roles. */
  ramp: { dim: number; bright: number; hot: number };
  /** Whether the plates under this filter carry window codes (`window-code.ts`). */
  coded: boolean;
}): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: TWINKLE_FRAGMENT }),
    resources: {
      cityUniforms: {
        uWindow: { value: channels(options.window), type: "vec3<f32>" },
        uDim: { value: channels(options.ramp.dim), type: "vec3<f32>" },
        uBright: { value: channels(options.ramp.bright), type: "vec3<f32>" },
        uHot: { value: channels(options.ramp.hot), type: "vec3<f32>" },
        uCoded: { value: options.coded ? 1 : 0, type: "f32" },
        uTime: { value: 0, type: "f32" },
        uGlow: { value: 0, type: "f32" },
        uLightsOut: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
      },
    },
    // At the canvas's own resolution: this pass is on the crisp city, and a
    // filter at Pixi's default resolution of 1 would halve it on a dense
    // display and upscale the result -- the blur the city exists to avoid.
    resolution: "inherit",
  });
}

/**
 * Sets how brightly the lit windows glow this frame.
 *
 * Driven by the beat clock, so the city breathes with the music. The pattern
 * `setBloomStrength` follows, on the pass that survived the blur's removal.
 */
export function setCityGlow(filter: Filter, strength: number): void {
  const group = filter.resources["cityUniforms"] as { uniforms: { uGlow: number } };
  group.uniforms.uGlow = strength;
}

/** A set piece's lights-out wave: its height up the screen, 0 to 1, and whether it blazes (Wonder spec §6.4). */
export function setCityLightsOut(filter: Filter, share: number, invert: boolean, relit = 0): void {
  const group = filter.resources["cityUniforms"] as { uniforms: { uLightsOut: Float32Array } };
  group.uniforms.uLightsOut[0] = Math.min(1, Math.max(0, share));
  group.uniforms.uLightsOut[1] = invert ? 1 : 0;
  group.uniforms.uLightsOut[2] = Math.min(1, Math.max(0, relit));
}

/** Advances the twinkle clock. Seconds, so the rate is frame-rate independent. */
export function setCityTime(filter: Filter, seconds: number): void {
  const group = filter.resources["cityUniforms"] as { uniforms: { uTime: number } };
  group.uniforms.uTime = seconds;
}

/**
 * The window glow.
 *
 * Carries no clock. Used for the world's marks; the scenery has none.
 */
/**
 * Sets how hard lit windows glow.
 *
 * Driven by the beat clock, so the city breathes with the music. The strength
 * is the only thing that moves: the bloom stays emissive-only, keyed on the
 * window colour, so a pulse brightens the windows and cannot set a racer alight
 * however loud the music gets.
 */
export function setBloomStrength(filter: Filter, strength: number): void {
  const group = filter.resources["bloomUniforms"] as { uniforms: { uStrength: number } };
  group.uniforms.uStrength = strength;
}

export function createBloomFilter(options: {
  /** The colours that emit. The first is required; up to three are honoured. */
  keys: readonly number[];
  strength: number;
  /**
   * How close a pixel must be to a key, in unit RGB.
   *
   * Defaults to the value the city has always used. A layer carrying anything
   * near a key in colour wants a tighter one; see the shader.
   */
  tolerance?: number;
}): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: BLOOM_FRAGMENT }),
    resources: {
      bloomUniforms: {
        uWindow: { value: channels(options.keys[0] ?? 0), type: "vec3<f32>" },
        uKeyB: { value: channels(options.keys[1] ?? 0), type: "vec3<f32>" },
        uKeyC: { value: channels(options.keys[2] ?? 0), type: "vec3<f32>" },
        uKeyCount: { value: Math.min(3, options.keys.length), type: "f32" },
        uTolerance: { value: options.tolerance ?? 0.08, type: "f32" },
        uStrength: { value: options.strength, type: "f32" },
      },
    },
  });
}
