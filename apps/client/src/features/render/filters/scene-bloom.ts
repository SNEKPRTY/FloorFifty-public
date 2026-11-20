/**
 * Scene bloom: light that spills past the edge of what emits it.
 *
 * One pass over the whole canvas, after every palette lock and after the LCD
 * panel, so the glow is the last thing added and nothing folds it back onto
 * the 64 swatches. That is deliberate: a bloom quantized to the palette is a
 * posterized ring, not a glow. The palette guarantee now covers every pixel the
 * picture draws, and the bloom is the light *off* those pixels.
 *
 * Three steps, the classic shape:
 *
 * 1. **Bright pass.** Keeps only what should emit. Not plain luminance: the
 *    dawn sky is pale (`skyLow` sits at luma 215), and a luminance key low
 *    enough to catch an amber window blooms the whole sky into fog. So there
 *    are two keys, and a pixel emits by whichever is stronger -- near-white
 *    (the sun's disc, a flash) and warm, saturated light (the lit windows,
 *    the floor marks). The cool sky passes neither.
 * 2. **Blur**, with Pixi's own separable blur, radius in logical units so the
 *    glow is the same size against the art on a phone and on a desktop.
 * 3. **Add** the blurred light back over the untouched picture.
 *
 * One exception to "whatever is bright emits": the caustic band that rolls
 * across the menu's sky. It lifts the pale sky to white, and after the palette
 * lock those pixels are the same white as the sun's, so no colour key can tell
 * them apart. The band is found by where it is instead -- the refraction's own
 * ridge formula, on the menu's clock -- and the white key is damped along it.
 */

import {
  BlurFilter,
  Filter,
  GlProgram,
  Texture,
  TexturePool,
  type FilterSystem,
  type RenderSurface,
} from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";
import { DAWN_CAUSTIC_GLSL, DAWN_REFRACTION_LOOP_SECONDS } from "./dawn-refraction";

/** The authored look. Radius is in logical units; the rest are unit colour. */
export const SCENE_BLOOM = {
  /** Luma above which a pixel emits however cool it is: the sun's disc. */
  whiteThreshold: 0.88,
  /** Red-over-blue above which a pixel emits as warm light: amber windows. */
  warmThreshold: 0.42,
  /** How much of the light is added back. */
  intensity: 0.9,
  /** Blur radius, in logical units. */
  radius: 6,
  /** How much of the white key the menu's caustic band loses, 0 to 1. */
  bandDamp: 0.8,
} as const;

/**
 * The title and lobby's look: the same keys, pushed. The menu is the city at
 * rest with nothing to read over it, so its lit windows can carry a heavy,
 * wide glow that would wash out a race. The warm key opens a little so the
 * dimmer amber windows join the brighter ones; the white key stays put, or the
 * pale sky would fog.
 */
export const MENU_BLOOM = {
  ...SCENE_BLOOM,
  warmThreshold: 0.32,
  intensity: 2.4,
  radius: 14,
} as const;

/** The look's knobs, as numbers rather than the authored literals. */
export type BloomLook = { [K in keyof typeof SCENE_BLOOM]: number };

/**
 * A beat on top of the look, for a screen that moves to its music: the glow's
 * strength scaled, and the whole picture's saturation, where 1 leaves it be.
 * `tint` colours the glow -- its light kept, its hue that colour's -- by
 * `tintAmount`, 0 to 1. Separate from the look so a screen can pulse whatever
 * look is in place, and stop, without knowing or restoring it.
 */
export type BloomPulse = { intensity: number; saturation: number; tint?: number; tintAmount?: number };

/** The letterboxed 960 x 540 composite, where it sits on the canvas. CSS pixels. */
export type BloomLetterbox = { x: number; y: number; scale: number; canvasWidth: number; canvasHeight: number };

const BRIGHT_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uWhiteThreshold;
uniform float uWarmThreshold;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
// x: damp (0 = no band), y: phase in radians, z: the refraction's intensity.
uniform vec3 uBand;
// xy: composite origin, z: CSS pixels per logical unit, all on the canvas.
uniform vec3 uLetterbox;
uniform vec2 uCanvas;

${DAWN_CAUSTIC_GLSL}

// How strongly the menu's caustic band covers this pixel, 0 to 1.
float bandCover() {
  if (uBand.x <= 0.0) return 0.0;
  vec2 frameUv = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);
  vec2 logical = (frameUv * uCanvas - uLetterbox.xy) / uLetterbox.z;
  if (logical.x < 0.0 || logical.y < 0.0 || logical.x > 960.0 || logical.y > 540.0) return 0.0;
  // Widened past the lift itself, so the band's soft shoulders go too.
  return smoothstep(0.03, 0.35, dawnCaustic(logical / 540.0, uBand.y) * uBand.z);
}

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  if (source.a <= 0.0) {
    finalColor = vec4(0.0);
    return;
  }
  vec3 colour = source.rgb / source.a;
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));

  // Near-white: ramps from the threshold to full white.
  float white = clamp((luma - uWhiteThreshold) / (1.0 - uWhiteThreshold), 0.0, 1.0);
  // Warm light: how far red leads blue past the threshold, scaled by how bright
  // the pixel is, so a dark brick does not glow like a lit window.
  float warmth = colour.r - colour.b;
  float warm = clamp((warmth - uWarmThreshold) / (1.0 - uWarmThreshold), 0.0, 1.0)
    * max(colour.r, colour.g);

  white *= 1.0 - uBand.x * bandCover();

  float emit = max(white, warm);
  finalColor = vec4(colour * emit * source.a, emit * source.a);
}
`;

const COMBINE_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform float uIntensity;
uniform float uSaturation;
// rgb: the pulse's colour, a: how much of the glow takes it.
uniform vec4 uTint;

void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec4 glow = texture(uBloom, vTextureCoord) * uIntensity;
  // The glow's own brightness, in the pulse's colour.
  float glowLuma = dot(glow.rgb, vec3(0.2126, 0.7152, 0.0722));
  glow.rgb = mix(glow.rgb, glowLuma * uTint.rgb, uTint.a);
  // Premultiplied add: light is added, never composited over, so the glow
  // brightens what it lands on instead of painting a halo across it.
  vec3 lit = min(base.rgb + glow.rgb, vec3(1.0));
  // Pushed away from its own grey, glow and all; 1 is the picture as drawn.
  float luma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  lit = clamp(mix(vec3(luma), lit, uSaturation), 0.0, 1.0);
  finalColor = vec4(lit, max(base.a, min(glow.a, 1.0)));
}
`;

type BloomUniforms = { uIntensity: number; uSaturation: number; uTint: Float32Array };
type BrightUniforms = {
  uWhiteThreshold: number;
  uWarmThreshold: number;
  uBand: Float32Array;
  uLetterbox: Float32Array;
  uCanvas: Float32Array;
};

/**
 * The bloom, as one Pixi filter.
 *
 * Its own `apply` runs the three passes; the pooled textures it borrows are
 * returned before it hands back, so it holds no GPU memory between frames.
 */
export class SceneBloomFilter extends Filter {
  private readonly bright: Filter;
  private readonly blur: BlurFilter;
  /** Device pixels per logical unit; see `setPixelsPerUnit`. */
  private pixelsPerUnit = 1;
  private radius: number;

  constructor(options: Partial<BloomLook> = {}) {
    const look = { ...SCENE_BLOOM, ...options };
    super({
      glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: COMBINE_FRAGMENT }),
      resources: {
        bloomUniforms: {
          uIntensity: { value: look.intensity, type: "f32" },
          uSaturation: { value: 1, type: "f32" },
          uTint: { value: new Float32Array([1, 1, 1, 0]), type: "vec4<f32>" },
        },
        // A placeholder until the first `apply` binds the frame's glow.
        uBloom: Texture.EMPTY.source,
      },
      // The canvas's own resolution. Pixi's default of 1 would render the whole
      // picture at one texel per CSS pixel and upscale it: a halved scene.
      resolution: "inherit",
    });
    this.bright = new Filter({
      glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: BRIGHT_FRAGMENT }),
      resources: {
        brightUniforms: {
          uWhiteThreshold: { value: look.whiteThreshold, type: "f32" },
          uWarmThreshold: { value: look.warmThreshold, type: "f32" },
          uBand: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
          uLetterbox: { value: new Float32Array([0, 0, 1]), type: "vec3<f32>" },
          uCanvas: { value: new Float32Array([960, 540]), type: "vec2<f32>" },
        },
      },
    });
    this.blur = new BlurFilter({ strength: look.radius, quality: 4, kernelSize: 7 });
    this.radius = look.radius;
    this.lookIntensity = look.intensity;
    this.bandDamp = look.bandDamp;
  }

  /** The look's own strength, before any pulse scales it. */
  private lookIntensity: number;
  private pulse: BloomPulse | undefined;

  private readonly bandDamp: number;

  private get brightUniforms(): BrightUniforms {
    return (this.bright.resources["brightUniforms"] as { uniforms: BrightUniforms }).uniforms;
  }

  /**
   * Swaps the glow's look -- keys, strength and reach -- for a screen that
   * wants its own, or back to the authored scene look with `undefined`.
   */
  setLook(look: Partial<BloomLook> | undefined): void {
    const next = { ...SCENE_BLOOM, ...look };
    const bright = this.brightUniforms;
    bright.uWhiteThreshold = next.whiteThreshold;
    bright.uWarmThreshold = next.warmThreshold;
    this.lookIntensity = next.intensity;
    this.radius = next.radius;
    this.applyPulse();
  }

  /** Pulses the glow over the current look, or stops with `undefined`. */
  setPulse(pulse: BloomPulse | undefined): void {
    this.pulse = pulse;
    this.applyPulse();
  }

  get saturation(): number {
    return this.bloomUniforms.uSaturation;
  }

  private get bloomUniforms(): BloomUniforms {
    return (this.resources["bloomUniforms"] as { uniforms: BloomUniforms }).uniforms;
  }

  private applyPulse(): void {
    this.intensity = this.lookIntensity * Math.max(0, this.pulse?.intensity ?? 1);
    this.bloomUniforms.uSaturation = Math.max(0, this.pulse?.saturation ?? 1);
    // Written in place: the uniform group holds the array by reference.
    const { uTint } = this.bloomUniforms;
    const tint = this.pulse?.tint ?? 0xffffff;
    uTint[0] = ((tint >> 16) & 0xff) / 255;
    uTint[1] = ((tint >> 8) & 0xff) / 255;
    uTint[2] = (tint & 0xff) / 255;
    uTint[3] = Math.min(1, Math.max(0, this.pulse?.tintAmount ?? 0));
  }

  /** The glow's pulse colour and how much of it, as `[r, g, b, amount]`. */
  get tint(): readonly number[] {
    return [...this.bloomUniforms.uTint];
  }

  /** Where the composite sits on the canvas; re-told on every layout. */
  setLetterbox(box: BloomLetterbox): void {
    const { uLetterbox, uCanvas } = this.brightUniforms;
    uLetterbox[0] = box.x;
    uLetterbox[1] = box.y;
    uLetterbox[2] = Math.max(0.001, box.scale);
    uCanvas[0] = box.canvasWidth;
    uCanvas[1] = box.canvasHeight;
  }

  /**
   * Follows the menu refraction's caustic band, or stops following it.
   *
   * The same time and intensity the menu hands its refraction, so the damp
   * lands exactly where the band is drawn. Written in place: the uniform group
   * holds the array by reference.
   */
  setBand(band: { timeSeconds: number; intensity: number } | undefined): void {
    const { uBand } = this.brightUniforms;
    if (band === undefined) {
      uBand[0] = 0;
      return;
    }
    const loop = Math.max(0, band.timeSeconds) % DAWN_REFRACTION_LOOP_SECONDS;
    uBand[0] = this.bandDamp;
    uBand[1] = (loop / DAWN_REFRACTION_LOOP_SECONDS) * 2 * Math.PI;
    uBand[2] = Math.min(1, Math.max(0, band.intensity));
  }

  get intensity(): number {
    return this.bloomUniforms.uIntensity;
  }

  set intensity(value: number) {
    this.bloomUniforms.uIntensity = Math.max(0, value);
  }

  /** How many device pixels one logical unit is drawn with. */
  setPixelsPerUnit(value: number): void {
    this.pixelsPerUnit = Math.max(0.1, value);
  }

  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    if (this.intensity <= 0) {
      // Off costs one copy, not three passes.
      filterManager.applyFilter(this, input, output, clearMode);
      return;
    }
    const light = TexturePool.getSameSizeTexture(input);
    const glow = TexturePool.getSameSizeTexture(input);
    try {
      this.bright.apply(filterManager, input, light, true);
      this.blur.strength = this.radius * this.pixelsPerUnit;
      this.blur.apply(filterManager, light, glow, true);
      this.resources["uBloom"] = glow.source;
      filterManager.applyFilter(this, input, output, clearMode);
    } finally {
      TexturePool.returnTexture(light);
      TexturePool.returnTexture(glow);
    }
  }

  override destroy(): void {
    this.bright.destroy();
    this.blur.destroy();
    super.destroy();
  }
}

export function createSceneBloomFilter(options: Partial<BloomLook> = {}): SceneBloomFilter {
  return new SceneBloomFilter(options);
}
