/**
 * The sky.
 *
 * Three swatches and an ordered dither between them, rather than a baked
 * gradient. A 64-colour palette has too few steps along any ramp to carry a
 * 540-pixel gradient smoothly, so a blended plate bands; a 4x4 Bayer threshold
 * trades that banding for the stipple pixel art is made of.
 *
 * Three tones rather than two. A two-step field between overhead and horizon
 * reads as one flat pale blue; the accepted Aquarian board runs blue overhead,
 * pink through the middle and peach at the horizon, and the middle band is the
 * one that makes it read as dawn rather than as a bright afternoon.
 *
 * `uProgress` moves the horizon as a player climbs, which a baked plate cannot
 * do at all. `uSurge` heaves it up on the music's kick, and `uOffset` slides
 * the Bayer table by whole pixels, so the stipple reshuffles on each beat --
 * the splash's dither jump, on the race's sky.
 *
 * The same Bayer table draws the menu backdrop in `tools/generate-city.ts`, so
 * the menu and the first frame of a race do not stipple differently.
 */

import { Filter, GlProgram } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";

/**
 * Where the grade changes, as fractions of the frame's height, mid-climb.
 *
 * Measured against the accepted extended-stage board, which runs blue overhead
 * for nearly half the frame and turns lilac, then peach, just above the
 * rooflines. The previous grade compressed the whole ramp into the top two
 * fifths and was lilac by a quarter of the way down, which read magenta-peach
 * where the board reads blue-peach (launch polish spec, phase 1).
 *
 * Re-measured against both boards for mockup parity (spec §2.8 item 5): blue
 * holds to just under half the frame, and the lilac is a thin band at the
 * horizon rather than the middle third of the sky.
 *
 * - above `highUntil`: `uHigh` alone;
 * - `highUntil` to `midAt`: `uHigh` dithered into `uMid`;
 * - `midAt` to `lowAt`: `uMid` dithered into `uLow`;
 * - below `lowAt`: `uLow` alone -- the horizon the city stands in front of.
 */
export const SKY_STOPS = { highUntil: 0.46, midAt: 0.56, lowAt: 0.64 } as const;

/**
 * How far the grade travels over a whole climb, in frame heights. Climbing
 * lowers the horizon: the warm band falls away below the climber, so the same
 * height is bluer near the top of the tower -- the extended-stage board's
 * "open-sky finish" is its bluest panel. (The grade used to rise with the
 * climb, which ended every race in a peach field.)
 */
const HORIZON_TRAVEL = 0.35;

export type SkyTone = "high" | "mid" | "low";

/**
 * The two tones dithered at a height, and the share of the second.
 *
 * The shader's arithmetic, in TypeScript, so the grade can be asserted without
 * a GPU. `frameY` is 0 at the top of the frame and 1 at the bottom.
 */
export function skyBlendAt(
  frameY: number,
  progress: number,
  surge = 0,
): { from: SkyTone; to: SkyTone; share: number } {
  const ramp = frameY - (Math.min(1, Math.max(0, progress)) - 0.5) * HORIZON_TRAVEL + surge;
  if (ramp < SKY_STOPS.midAt) {
    const share = (ramp - SKY_STOPS.highUntil) / (SKY_STOPS.midAt - SKY_STOPS.highUntil);
    return { from: "high", to: "mid", share: Math.min(1, Math.max(0, share)) };
  }
  const share = (ramp - SKY_STOPS.midAt) / (SKY_STOPS.lowAt - SKY_STOPS.midAt);
  return { from: "mid", to: "low", share: Math.min(1, Math.max(0, share)) };
}

const stop = (value: number): string => value.toFixed(3);

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

uniform vec3 uHigh;
uniform vec3 uMid;
uniform vec3 uLow;
uniform float uProgress;
uniform float uSurge;
uniform vec2 uOffset;

/** 4x4 ordered dither threshold in [0,1), by pixel position. */
float bayer(vec2 pixel) {
  int x = int(mod(pixel.x, 4.0));
  int y = int(mod(pixel.y, 4.0));
  int index = x + y * 4;
  float table[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return table[index] / 16.0;
}

void main() {
  vec4 source = texture(uTexture, vTextureCoord);

  vec2 pixel = vTextureCoord * uInputSize.xy;
  // Height within the frame, not within the pooled texture the frame sits in:
  // the pool is larger than the frame, by a different amount per axis, so the
  // raw coordinate would move the grade whenever the target is re-fitted.
  float frameY = vTextureCoord.y / (uOutputFrame.w * uInputSize.w);
  // Lower on screen is warmer, and climbing lowers the horizon.
  // The kick's surge lifts the warm bands up the frame.
  float ramp = frameY - (uProgress - 0.5) * ${HORIZON_TRAVEL.toFixed(2)} + uSurge;

  // Three stops over two dithered bands (see SKY_STOPS and skyBlendAt, which
  // this mirrors). Within a band the two tones are ordered-dithered against
  // each other at the pixel's own position, so the field reads as a gradient
  // rather than as hard stripes -- and so the transition stipples instead of
  // banding, which is the whole reason a limited palette dithers at all.
  bool upper = ramp < ${stop(SKY_STOPS.midAt)};
  vec3 below = upper ? uHigh : uMid;
  vec3 above = upper ? uMid : uLow;
  float blend = upper
    ? (ramp - ${stop(SKY_STOPS.highUntil)}) / ${stop(SKY_STOPS.midAt - SKY_STOPS.highUntil)}
    : (ramp - ${stop(SKY_STOPS.midAt)}) / ${stop(SKY_STOPS.lowAt - SKY_STOPS.midAt)};
  blend = clamp(blend, 0.0, 1.0);
  vec3 sky = blend > bayer(pixel + uOffset) ? above : below;

  // Composite what is already drawn OVER the sky, rather than returning early
  // wherever anything has been drawn at all.
  //
  // The early return was wrong for every partially transparent pixel in the
  // layer. The sun is a disc that fades to nothing at its rim, so its falloff
  // has alpha strictly between zero and one; skipping those pixels left no sky
  // behind them, and what showed through instead was the page background. The
  // sun rendered as a dark halo the exact size of its own fade.
  //
  // Pixi hands this pass premultiplied colour, so source-over an opaque
  // background is an add rather than a mix, and the result is opaque.
  finalColor = vec4(source.rgb + sky * (1.0 - source.a), 1.0);
}
`;

const channels = (color: number): Float32Array =>
  new Float32Array([
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  ]);

export function createSkyFilter(options: { high: number; mid: number; low: number }): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: FRAGMENT }),
    resources: {
      skyUniforms: {
        uHigh: { value: channels(options.high), type: "vec3<f32>" },
        uMid: { value: channels(options.mid), type: "vec3<f32>" },
        uLow: { value: channels(options.low), type: "vec3<f32>" },
        uProgress: { value: 0, type: "f32" },
        uSurge: { value: 0, type: "f32" },
        uOffset: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
      },
    },
  });
}

/** Moves the horizon. `progress` is the climb, clamped into `[0, 1]`. */
export function setSkyProgress(filter: Filter, progress: number): void {
  const group = filter.resources["skyUniforms"] as { uniforms: { uProgress: number } };
  group.uniforms.uProgress = Math.min(1, Math.max(0, progress));
}

type SkyMusicUniforms = { uniforms: { uSurge: number; uOffset: Float32Array } };

/**
 * Heaves the horizon up by `surge` frame heights and slides the dither by
 * whole pixels, wrapped to the 4x4 table. The offset is written in place: the
 * uniform group holds the array by reference.
 */
export function setSkyMusic(filter: Filter, surge: number, offsetX: number, offsetY: number): void {
  const { uniforms } = filter.resources["skyUniforms"] as SkyMusicUniforms;
  uniforms.uSurge = Math.max(0, surge);
  uniforms.uOffset[0] = ((Math.floor(offsetX) % 4) + 4) % 4;
  uniforms.uOffset[1] = ((Math.floor(offsetY) % 4) + 4) % 4;
}
