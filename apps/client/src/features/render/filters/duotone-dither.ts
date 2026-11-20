/**
 * Duotone dither.
 *
 * Redraws whatever it filters in two tones, a shadow and a highlight, chosen
 * per pixel by an ordered dither on the source's brightness -- the 1-bit print
 * look, on palette colours, so the palette lock has nothing to move.
 *
 * It holds two such pairs and swings between them, there and back, on a
 * `phase` from 0 (the first pair) to 1 (the second). The swing is dithered
 * too: as the phase rises, pixels change pair one Bayer step at a time, so the
 * second pair stipples in across the frame rather than cross-fading through
 * colours the palette does not have.
 *
 * The motion lives in `duotonePhase`, not in the shader. Each leg of the ping
 * pong eases in -- it starts slow and ramps up hard at the end -- so the swap
 * dawdles and then snaps home, like a ball dropping onto the floor it bounces
 * off. The shader only draws a phase; a caller that wants a still frame, or a
 * swing driven by something other than time, sets one itself.
 *
 * The dither's pattern can move as well: `offset` slides the Bayer table
 * under the image by whole cells, so the stipple crawls over art that stays
 * put -- the same grain, shuffled, rather than a new noise every frame.
 *
 * Written for the splash and meant to be reused: nothing in it knows what it
 * is drawing over.
 */

import { Filter, GlProgram } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";

/** One pair of tones: what the dark half of the image becomes, and the light. */
export type DuotonePair = Readonly<{ shadow: number; highlight: number }>;

export type DuotoneDitherOptions = Readonly<{
  /** The pair at phase 0. */
  from: DuotonePair;
  /** The pair at phase 1. */
  to: DuotonePair;
  /**
   * The brightness taken as black and as white, before dithering. A source
   * that never reaches either end still spans both tones. Defaults to [0, 1].
   */
  levels?: readonly [number, number];
}>;

/**
 * How hard a leg eases in. The power of the curve: 1 is linear, and every
 * step above it holds the start longer and spends the leg's travel later.
 */
export const DUOTONE_EASE_POWER = 4;

/** Slow, then fast: `progress` in [0, 1] to eased [0, 1]. */
export function easeIn(progress: number, power = DUOTONE_EASE_POWER): number {
  return Math.min(1, Math.max(0, progress)) ** power;
}

/**
 * The phase at a moment of a ping pong between the two pairs.
 *
 * `legSeconds` is one way across. Both legs ease in, so the swing arrives at
 * each pair at its fastest -- the snap -- and leaves it at its slowest.
 */
export function duotonePhase(seconds: number, legSeconds: number, power = DUOTONE_EASE_POWER): number {
  if (legSeconds <= 0) return 0;
  const legs = Math.max(0, seconds) / legSeconds;
  const leg = Math.floor(legs);
  const eased = easeIn(legs - leg, power);
  return leg % 2 === 0 ? eased : 1 - eased;
}

/** The 4x4 Bayer table, in sixteenths, as the shader holds it. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

const bayerAt = (x: number, y: number): number => BAYER[(x & 3) + (y & 3) * 4]! / 16;

/**
 * Which tone a pixel is drawn in: the shader's choice, in TypeScript, so it can
 * be asserted without a GPU. `cellX`/`cellY` are the dither cell's position.
 */
export function duotoneToneAt(
  brightness: number,
  phase: number,
  x: number,
  y: number,
  levels: readonly [number, number] = [0, 1],
  offset: readonly [number, number] = [0, 0],
): { pair: "from" | "to"; tone: "shadow" | "highlight" } {
  const cellX = x + offset[0];
  const cellY = y + offset[1];
  const span = Math.max(1e-4, levels[1] - levels[0]);
  const level = Math.min(1, Math.max(0, (brightness - levels[0]) / span));
  // The pair swap reads the table transposed and shifted, so it does not
  // stipple in the same cells the tones do and the two patterns stay apart.
  const pair = phase > bayerAt(cellY + 2, cellX + 1) ? "to" : "from";
  return { pair, tone: level > bayerAt(cellX, cellY) ? "highlight" : "shadow" };
}

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec3 uFromShadow;
uniform vec3 uFromHighlight;
uniform vec3 uToShadow;
uniform vec3 uToHighlight;
uniform vec2 uLevels;
uniform float uPhase;
uniform float uCell;
uniform vec2 uOffset;

/** 4x4 ordered dither threshold in [0,1), by cell position. */
float bayer(vec2 cell) {
  int x = int(mod(cell.x, 4.0));
  int y = int(mod(cell.y, 4.0));
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
  if (source.a <= 0.0) {
    finalColor = vec4(0.0);
    return;
  }

  // Pixi hands a filter premultiplied colour; brightness is read from the
  // straight colour, or every soft edge would read as a shadow.
  vec3 color = source.rgb / source.a;
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float level = clamp((brightness - uLevels.x) / max(uLevels.y - uLevels.x, 1e-4), 0.0, 1.0);

  // One dither cell per uCell output pixels, so the pattern is as coarse as
  // the art it sits on rather than as fine as the screen.
  vec2 cell = floor(vTextureCoord * uInputSize.xy / max(uCell, 1.0)) + uOffset;

  // See duotoneToneAt, which this mirrors.
  bool to = uPhase > bayer(cell.yx + vec2(2.0, 1.0));
  vec3 shadow = to ? uToShadow : uFromShadow;
  vec3 highlight = to ? uToHighlight : uFromHighlight;
  vec3 tone = level > bayer(cell) ? highlight : shadow;

  finalColor = vec4(tone * source.a, source.a);
}
`;

const channels = (color: number): Float32Array =>
  new Float32Array([((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255]);

type DuotoneUniforms = { uniforms: { uPhase: number; uCell: number; uOffset: Float32Array } };

export function createDuotoneDitherFilter(options: DuotoneDitherOptions): Filter {
  const [low, high] = options.levels ?? [0, 1];
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: FRAGMENT, name: "duotone-dither" }),
    resources: {
      duotoneUniforms: {
        uFromShadow: { value: channels(options.from.shadow), type: "vec3<f32>" },
        uFromHighlight: { value: channels(options.from.highlight), type: "vec3<f32>" },
        uToShadow: { value: channels(options.to.shadow), type: "vec3<f32>" },
        uToHighlight: { value: channels(options.to.highlight), type: "vec3<f32>" },
        uLevels: { value: new Float32Array([low, high]), type: "vec2<f32>" },
        uPhase: { value: 0, type: "f32" },
        uCell: { value: 1, type: "f32" },
        uOffset: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
      },
    },
  });
}

/** Where the swing is: 0 is the first pair, 1 the second. */
export function setDuotonePhase(filter: Filter, phase: number): void {
  (filter.resources["duotoneUniforms"] as DuotoneUniforms).uniforms.uPhase = Math.min(1, Math.max(0, phase));
}

/**
 * Slides the dither pattern by whole cells. Only the offset within the 4x4
 * table matters, so it is wrapped there. Written in place: the uniform group
 * holds the array by reference.
 */
export function setDuotoneOffset(filter: Filter, x: number, y: number): void {
  const { uOffset } = (filter.resources["duotoneUniforms"] as DuotoneUniforms).uniforms;
  uOffset[0] = ((Math.floor(x) % 4) + 4) % 4;
  uOffset[1] = ((Math.floor(y) % 4) + 4) % 4;
}

/** How many output pixels one dither cell spans; at least one. */
export function setDuotoneCell(filter: Filter, pixels: number): void {
  (filter.resources["duotoneUniforms"] as DuotoneUniforms).uniforms.uCell = Math.max(1, pixels);
}

/**
 * Compiles and links the filter's program against the live context, throwing
 * with the driver's log if it fails -- once, before the filter is attached,
 * so a device that rejects it keeps the unfiltered picture rather than a
 * blank one.
 */
export function validateDuotoneDitherProgram(gl: WebGLRenderingContextBase, filter: Filter): void {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  try {
    if (!vertex || !fragment || !program) throw new Error("Unable to allocate duotone dither validation objects");
    const compile = (shader: WebGLShader, source: string): void => {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "duotone dither shader compilation failed");
      }
    };
    compile(vertex, String(filter.glProgram?.vertex));
    compile(fragment, String(filter.glProgram?.fragment));
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "duotone dither program link failed");
    }
  } finally {
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}
