/**
 * Palette lock.
 *
 * Snaps every output pixel to its nearest Resurrect 64 swatch, which is what
 * makes the palette true at runtime rather than only at `assets:check` time.
 * A tint, an alpha blend, and a bloom all produce colours no asset contains;
 * without this they would ship as off-palette pixels that no static check can
 * see.
 *
 * Runs last in the chain, after bloom, for that reason.
 *
 * Distance is weighted toward green to match `nearestSwatch` in the asset
 * contract, so a sprite quantized at build time and a blend quantized at
 * runtime resolve to the same swatch.
 *
 * The swatches reach the shader as a uniform array, not a lookup texture. The
 * search read all 64 for every pixel, and on a phone's canvas that was 64
 * texture fetches over a million and a half pixels, three times a frame: the
 * most expensive pass in the stack. A uniform read is no fetch at all. The
 * values are the same ones the texture held, each channel's byte over 255.
 *
 * And the search no longer reads all 64. Most cannot win for a given colour,
 * so the cube is cut into cells and each cell lists, in palette order, the
 * swatches that can be nearest somewhere in it (`palette-cells.ts`): three or
 * four on average, thirteen at most. The same distance and the same strict
 * comparison over that list pick the same swatch, ties included. A colour
 * outside the cube's margin -- an unpremultiplied low-alpha edge can land
 * there -- takes the full search.
 *
 * Both changes are pixel-identical: `tests/e2e/shader-bench.spec.ts` runs this
 * program and the previous one in one page and compares their output byte for
 * byte, over every opaque 8-bit colour and over noise at every alpha, at rest
 * and in two moods.
 */

import type { SetPieceMood } from "@floor-fifty/shared/content/game-content";
import { RESURRECT64, swatchRgb } from "@floor-fifty/asset-contract/swatches";
import { BufferImageSource, Filter, GlProgram, Texture } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";
import { CELL_TEXTURE, paletteCellTable } from "./palette-cells";

export { DEFAULT_FILTER_VERT };

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uPalette[64];
// Each cell's candidates (palette-cells.ts): 16^3 cells, 5 RGB texels each,
// row-major in a 160-wide texture, indices in red, green and blue, 255 ending
// a list. The numbers here are that module's constants; a test pins them.
uniform sampler2D uCells;
uniform vec3 uMoodTint;
uniform float uMoodMix;
uniform vec3 uMoodCeil;

// The full search's rule for one swatch: kept only if strictly nearer.
void consider(vec3 colour, int i, inout vec3 best, inout float bestDistance) {
  vec3 candidate = uPalette[i];
  vec3 delta = colour - candidate;
  float distance = 2.0 * delta.r * delta.r
                 + 4.0 * delta.g * delta.g
                 + 3.0 * delta.b * delta.b;
  if (distance < bestDistance) {
    bestDistance = distance;
    best = candidate;
  }
}

void main() {
  vec4 source = texture(uTexture, vTextureCoord);

  // Nothing visible, nothing to quantize: leave the silhouette alone.
  if (source.a == 0.0) {
    finalColor = source;
    return;
  }

  // Pixi composites premultiplied, and a nearest-swatch search on premultiplied
  // channels would quantize toward black wherever alpha is low.
  vec3 colour = source.rgb / max(source.a, 0.001);

  // A set piece's mood (Wonder spec §6.4): tinted before the search, so the
  // lock snaps it onto the palette in swatch steps, never a smooth grade.
  // A flash is held under the plate's brightest colour, so it never goes brighter than the sky can.
  colour = mix(colour, min(clamp(colour * uMoodTint, 0.0, 1.0), uMoodCeil), uMoodMix);

  vec3 best = colour;
  float bestDistance = 1.0e9;

  // Half the cells' margin (CELL_MARGIN, 1/512): inside it, the colour's
  // cell lists every swatch that can win.
  const float REACH = 1.0 / 1024.0;
  if (all(greaterThanEqual(colour, vec3(-REACH))) && all(lessThanEqual(colour, vec3(1.0 + REACH)))) {
    ivec3 q = clamp(ivec3(floor(colour * 16.0)), ivec3(0), ivec3(15));
    int first = ((q.r * 16 + q.g) * 16 + q.b) * 5;
    bool done = false;
    for (int t = 0; t < 5 && !done; t++) {
      int texel = first + t;
      vec3 slots = texelFetch(uCells, ivec2(texel % 160, texel / 160), 0).rgb * 255.0;
      for (int k = 0; k < 3; k++) {
        int i = int(slots[k] + 0.5);
        if (i >= 64) {
          done = true;
          break;
        }
        consider(colour, i, best, bestDistance);
      }
    }
  } else {
    for (int i = 0; i < 64; i++) consider(colour, i, best, bestDistance);
  }

  finalColor = vec4(best * source.a, source.a);
}
`;

/**
 * The 64 swatches as unit channels, in palette order: what `uPalette` holds.
 *
 * Each channel is its byte over 255, the value an 8-bit texel of the same
 * colour samples as, so the search sees exactly what the lookup texture showed
 * it. Exported for the test that pins it.
 */
export function paletteChannels(): Float32Array {
  const channels = new Float32Array(RESURRECT64.length * 3);
  for (let index = 0; index < RESURRECT64.length; index += 1) {
    const [r, g, b] = swatchRgb(index);
    channels[index * 3] = r / 255;
    channels[index * 3 + 1] = g / 255;
    channels[index * 3 + 2] = b / 255;
  }
  return channels;
}

/** Built once: every lock carries the same table, and a uniform group copies it on upload. */
const PALETTE_CHANNELS = paletteChannels();

/**
 * The cell table's texture, built on first use and shared by every lock for
 * the life of the tab, as the lookup texture was: it is 80KB and never changes.
 */
let cellTexture: Texture | undefined;
function cellTable(): Texture {
  cellTexture ??= new Texture({
    source: new BufferImageSource({
      resource: paletteCellTable(RESURRECT64.map((_, index) => swatchRgb(index).map((channel) => channel / 255) as [number, number, number])),
      width: CELL_TEXTURE.width,
      height: CELL_TEXTURE.height,
      format: "rgba8unorm",
      // Read with texelFetch, so filtering never applies; nearest and no
      // mipmaps keep the texture complete for it.
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
    }),
  });
  return cellTexture;
}

export function createPaletteLockFilter(): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: FRAGMENT }),
    resources: {
      paletteUniforms: {
        uPalette: { value: PALETTE_CHANNELS, type: "vec3<f32>", size: RESURRECT64.length },
      },
      uCells: cellTable().source,
      moodUniforms: {
        uMoodTint: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
        uMoodMix: { value: 0, type: "f32" },
        uMoodCeil: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
      },
    },
  });
}

const NO_CEIL: readonly [number, number, number] = [1, 1, 1];

/**
 * The brightest opaque texel of an RGBA image, by luma, as 0–1 channels: the
 * ceiling a sky flash may not pass (Wonder spec §6.6).
 */
export function brightestPixel(data: Uint8ClampedArray): [number, number, number] {
  let best = -1;
  let rgb: [number, number, number] = [1, 1, 1];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const luma = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    if (luma > best) {
      best = luma;
      rgb = [data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255];
    }
  }
  return rgb;
}

/** Each mood's tint, multiplied into the colour before the lock snaps it (Wonder spec §6.4). */
export const MOOD_TINTS: Readonly<Record<SetPieceMood, readonly [number, number, number]>> = {
  sunset: [1.15, 0.85, 0.7],
  storm: [0.7, 0.75, 0.9],
  deepWater: [0.6, 0.85, 1.1],
  aurora: [0.8, 1.1, 1.0],
  night: [0.55, 0.6, 0.8],
  dawn: [1.1, 0.9, 0.85],
  day: [1.1, 1.05, 0.95],
  bright: [1.2, 1.15, 1.05],
};

/**
 * Tints a lock toward `tint` by `mix`, 0 to 1. A filter without the mood (a
 * lock from before this pass, a test's stand-in) is left alone.
 */
export function setPaletteMood(
  filter: Filter,
  tint: readonly [number, number, number],
  mix: number,
  ceil: readonly [number, number, number] = NO_CEIL,
): void {
  const group = filter.resources["moodUniforms"] as
    | { uniforms: { uMoodTint: Float32Array; uMoodMix: number; uMoodCeil: Float32Array } }
    | undefined;
  if (group?.uniforms === undefined) return;
  group.uniforms.uMoodCeil[0] = ceil[0];
  group.uniforms.uMoodCeil[1] = ceil[1];
  group.uniforms.uMoodCeil[2] = ceil[2];
  group.uniforms.uMoodTint[0] = tint[0];
  group.uniforms.uMoodTint[1] = tint[1];
  group.uniforms.uMoodTint[2] = tint[2];
  group.uniforms.uMoodMix = mix;
}
