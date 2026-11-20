/**
 * Character outline and rim light.
 *
 * A transparent pixel with an opaque neighbour becomes outline; an opaque pixel
 * whose upper neighbour is transparent takes the rim. Eight neighbours rather
 * than four: sampling only the cardinals leaves every diagonal of a sprite's
 * silhouette open, and a broken outline reads worse than none at all.
 *
 * The outline is drawn here rather than baked into the sprite so that figure
 * and ground separate by construction. The generator's output quality then
 * decides how good a character looks, not whether a player can find it.
 *
 * This is the same rule the world is drawn to -- every foreground mass carries
 * a heavy dark border -- applied to the one layer that cannot bake it in,
 * because a character is generated art rather than drawn art.
 *
 * **The rim is a light, not a line.** It was one row of pixels at a fixed
 * strength, which reads as a highlight drawn on rather than as a surface
 * catching something. It now falls off over two pixels and wraps the upper
 * diagonals, weighted so the pixel directly under open sky takes the most: a
 * shoulder curving away from the light dims gradually, which is the whole of
 * what makes a rim read as directional.
 *
 * **The rim is fixed to the upward edge rather than aimed at the sun.** The
 * spec asks for "a light rim on the side facing the sun", and the sun sits low
 * in the frame (`SUN_HORIZON_OFFSET` in `gameplay-view.ts`), so aiming it there
 * would uplight every racer from below. Two reasons it is not worth the
 * machinery: the direction the sun is in changes per sprite as the camera
 * climbs, which means a uniform fed per player per frame; and a rim under a
 * figure reads as a figure floating rather than a figure lit. Lit-from-above is
 * the convention the parallax is drawn to as well. Recorded as a departure in
 * `docs/art/resurrect-arcade-review.md`.
 */

import { Filter, GlProgram } from "pixi.js";
import { DEFAULT_FILTER_VERT } from "./default-vert";

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec3 uOutlineColor;
uniform vec3 uRimColor;
uniform float uThickness;
uniform float uRimStrength;

float alphaAt(vec2 offset) {
  return texture(uTexture, vTextureCoord + offset * uInputSize.zw * uThickness).a;
}

void main() {
  vec4 source = texture(uTexture, vTextureCoord);

  if (source.a > 0.0) {
    // Lit from above, and falling off rather than stopping.
    //
    // How much open sky is over this pixel, weighted by how directly. The row
    // immediately above carries most of it; the row beyond that and the two
    // upper diagonals carry the rest, which is what lets the light wrap a
    // shoulder instead of ending at it.
    float open =
        (1.0 - alphaAt(vec2( 0.0, -1.0))) * 0.55
      + (1.0 - alphaAt(vec2( 0.0, -2.0))) * 0.20
      + (1.0 - alphaAt(vec2(-1.0, -1.0))) * 0.125
      + (1.0 - alphaAt(vec2( 1.0, -1.0))) * 0.125;

    if (open > 0.0) {
      // Squared, so the falloff is weighted toward the lit edge rather than
      // spread evenly down the sprite. Linear read as a wash.
      float strength = clamp(open * open * uRimStrength, 0.0, 1.0);
      vec3 unpremultiplied = source.rgb / max(source.a, 0.001);
      finalColor = vec4(mix(unpremultiplied, uRimColor, strength) * source.a, source.a);
      return;
    }
    finalColor = source;
    return;
  }

  float neighbours =
      alphaAt(vec2(-1.0,  0.0)) + alphaAt(vec2(1.0,  0.0))
    + alphaAt(vec2( 0.0, -1.0)) + alphaAt(vec2(0.0,  1.0))
    + alphaAt(vec2(-1.0, -1.0)) + alphaAt(vec2(1.0, -1.0))
    + alphaAt(vec2(-1.0,  1.0)) + alphaAt(vec2(1.0,  1.0));

  if (neighbours > 0.0) {
    finalColor = vec4(uOutlineColor, 1.0);
    return;
  }

  finalColor = source;
}
`;

const channels = (color: number): Float32Array =>
  new Float32Array([
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  ]);

export function createOutlineFilter(options: {
  outlineColor: number;
  rimColor: number;
  thickness: number;
  /**
   * How hard the lit edge is pushed toward the rim colour, at its strongest.
   *
   * One replaces the surface entirely; the default leaves enough of the seat's
   * own colour in the lit edge that a player can still tell the four apart by
   * the top of a head, which is the part of a racer that clears a platform
   * first and is often all that is visible.
   */
  rimStrength?: number;
}): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment: FRAGMENT }),
    // Room to draw into. The pass writes outline into the transparent pixels
    // just outside the silhouette, and a filter's texture is its target's
    // bounds exactly; without padding those pixels fall outside it and the
    // border is clipped off the very edges it exists to draw.
    padding: Math.ceil(options.thickness) + 1,
    resources: {
      outlineUniforms: {
        uOutlineColor: { value: channels(options.outlineColor), type: "vec3<f32>" },
        uRimColor: { value: channels(options.rimColor), type: "vec3<f32>" },
        uThickness: { value: options.thickness, type: "f32" },
        uRimStrength: { value: options.rimStrength ?? 0.9, type: "f32" },
      },
    },
  });
}
