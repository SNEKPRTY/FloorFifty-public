import { describe, expect, it } from "vitest";
import type { Container, Filter } from "pixi.js";
import {
  DEFAULT_FILTER_VERT,
  createPaletteLockFilter,
  paletteChannels,
} from "../../../../../apps/client/src/features/render/filters/palette-lock";
import { swatchRgb } from "@floor-fifty/asset-contract/swatches";
import {
  CELL_MARGIN,
  CELL_TEXELS,
  CELL_TEXTURE,
  CELLS_PER_AXIS,
  NO_CANDIDATE,
} from "../../../../../apps/client/src/features/render/filters/palette-cells";
import { createOutlineFilter } from "../../../../../apps/client/src/features/render/filters/outline";
import {
  SKY_STOPS,
  createSkyFilter,
  setSkyProgress,
  skyBlendAt,
} from "../../../../../apps/client/src/features/render/filters/dither-sky";
import { gameplayWithFakeNetwork } from "../../../support/fakes/screens";
import { fakeStage } from "../../../support/fakes/stage";

/**
 * A program's sources, as Pixi 8 actually stores them.
 *
 * `glProgram.vertex` and `.fragment` are plain strings rather than
 * `{ source }`, and Pixi injects a `#define SHADER_NAME` line after the
 * `#version` directive, so a shader cannot be compared to its own constant by
 * equality. These read the two sources for the assertions below.
 */
const vertexOf = (filter: Filter): string => String(filter.glProgram?.vertex);
const fragmentOf = (filter: Filter): string => String(filter.glProgram?.fragment);

describe("the palette-lock filter", () => {
  it("compiles from a complete vertex and fragment pair", () => {
    const filter = createPaletteLockFilter();
    // The shared transform, identified by the two functions only it defines.
    for (const marker of ["filterVertexPosition", "filterTextureCoord"]) {
      expect(DEFAULT_FILTER_VERT).toContain(marker);
      expect(vertexOf(filter)).toContain(marker);
    }
    expect(fragmentOf(filter)).toContain("uPalette");
  });

  it("carries the 64 swatches as uniforms, each channel its byte over 255", () => {
    // The values an 8-bit lookup texel samples as, so the search resolves
    // every pixel to the swatch the texture lookup did.
    const filter = createPaletteLockFilter();
    const group = filter.resources["paletteUniforms"] as { uniforms: { uPalette: Float32Array } };
    const channels = group.uniforms.uPalette;
    expect(channels).toHaveLength(64 * 3);
    for (let index = 0; index < 64; index += 1) {
      const [r, g, b] = swatchRgb(index);
      expect([...channels.slice(index * 3, index * 3 + 3)]).toEqual([
        Math.fround(r / 255),
        Math.fround(g / 255),
        Math.fround(b / 255),
      ]);
    }
    expect(paletteChannels()).toEqual(channels);
  });

  it("searches by cell with the cell table's own geometry, and binds the table", () => {
    // The GLSL spells the table's numbers out (so the shader bench can lift the
    // source as it is); these are the module's constants, and they must agree.
    const fragment = fragmentOf(createPaletteLockFilter());
    expect(fragment).toContain(`floor(colour * ${CELLS_PER_AXIS}.0)`);
    expect(fragment).toContain(`clamp(ivec3(floor(colour * ${CELLS_PER_AXIS}.0)), ivec3(0), ivec3(${CELLS_PER_AXIS - 1}))`);
    expect(fragment).toContain(`* ${CELLS_PER_AXIS} + q.g) * ${CELLS_PER_AXIS} + q.b) * ${CELL_TEXELS};`);
    expect(fragment).toContain(`t < ${CELL_TEXELS} && !done`);
    expect(fragment).toContain(`ivec2(texel % ${CELL_TEXTURE.width}, texel / ${CELL_TEXTURE.width})`);
    expect(fragment).toContain(`const float REACH = 1.0 / ${2 / CELL_MARGIN}.0;`);
    expect(fragment).toContain(`if (i >= 64)`);
    expect(NO_CANDIDATE).toBeGreaterThanOrEqual(64);
    // Two locks share one table texture.
    const a = createPaletteLockFilter();
    const b = createPaletteLockFilter();
    expect(a.resources["uCells"]).toBeDefined();
    expect(a.resources["uCells"]).toBe(b.resources["uCells"]);
  });

  it("reads the swatches from the uniform array, not a texture", () => {
    const fragment = fragmentOf(createPaletteLockFilter());
    expect(fragment).toContain("uniform vec3 uPalette[64];");
    expect(fragment).not.toContain("sampler2D uPalette");
  });

  it("iterates the whole palette", () => {
    const filter = createPaletteLockFilter();
    expect(fragmentOf(filter)).toContain("i < 64");
  });

  it("unpremultiplies before searching for a swatch", () => {
    // Pixi composites premultiplied. A nearest-swatch search on premultiplied
    // channels quantizes toward black wherever alpha is low, which would show
    // up as a dark fringe on every soft edge in the frame.
    const filter = createPaletteLockFilter();
    expect(fragmentOf(filter)).toContain("source.rgb / max(source.a");
  });
});

describe("the outline filter", () => {
  it("carries the outline colour it was given", () => {
    const filter = createOutlineFilter({ outlineColor: 0x101010, rimColor: 0xff0000, thickness: 1 });
    const uniforms = filter.resources["outlineUniforms"] as { uniforms: Record<string, unknown> };
    expect(uniforms.uniforms["uOutlineColor"]).toEqual(
      new Float32Array([16 / 255, 16 / 255, 16 / 255]),
    );
  });

  it("samples all eight neighbours so diagonals are not left open", () => {
    const filter = createOutlineFilter({ outlineColor: 0, rimColor: 0, thickness: 1 });
    // Runs of whitespace collapse first: the eight samples are written in an
    // aligned block so the pattern is readable, and the assertion is about
    // which neighbours are read, not about how they are laid out.
    const source = fragmentOf(filter).replace(/\s+/g, " ");
    for (const offset of ["-1.0, -1.0", "1.0, -1.0", "-1.0, 1.0", "1.0, 1.0"]) {
      expect(source).toContain(`vec2(${offset})`);
    }
  });
});

describe("the sky's grade", () => {
  // Blue overhead for most of the frame, then lilac and peach toward the
  // horizon, as the accepted extended-stage board draws it. The earlier grade
  // reached lilac by a quarter of the way down, which read magenta-peach.
  it("is blue through the upper part of the frame mid-climb", () => {
    for (const y of [0, 0.1, 0.2, 0.4, SKY_STOPS.highUntil]) {
      expect(skyBlendAt(y, 0.5), `y ${y}`).toEqual({ from: "high", to: "mid", share: 0 });
    }
  });

  it("keeps the lilac to a thin band at the horizon", () => {
    // Both boards run blue to peach, with pink only at the horizon (spec §2.8
    // item 5): the lilac-to-peach band is at most a tenth of the frame.
    expect(SKY_STOPS.lowAt - SKY_STOPS.midAt).toBeLessThanOrEqual(0.1);
  });

  it("runs through lilac to peach before the rooflines", () => {
    expect(skyBlendAt(SKY_STOPS.midAt, 0.5)).toEqual({ from: "mid", to: "low", share: 0 });
    expect(skyBlendAt(SKY_STOPS.lowAt, 0.5)).toEqual({ from: "mid", to: "low", share: 1 });
    expect(skyBlendAt(0.9, 0.5)).toEqual({ from: "mid", to: "low", share: 1 });
  });

  it("orders its stops and moves the horizon with the climb", () => {
    expect(SKY_STOPS.highUntil).toBeLessThan(SKY_STOPS.midAt);
    expect(SKY_STOPS.midAt).toBeLessThan(SKY_STOPS.lowAt);
    // Further up the climb, the same height is bluer: the horizon falls away
    // below the climber, and the board's open-sky finish is its bluest panel.
    const early = skyBlendAt(0.4, 0);
    const late = skyBlendAt(0.4, 1);
    const warmth = (blend: { from: string; share: number }) =>
      (blend.from === "mid" ? 1 : 0) + blend.share;
    expect(warmth(late)).toBeLessThan(warmth(early));
  });

  it("is measured against its own frame, not the pooled texture", () => {
    const source = String(createSkyFilter({ high: 0, mid: 0, low: 0 }).glProgram?.fragment);
    expect(source).toContain("uOutputFrame");
    expect(source).toContain("frameY");
  });
});

describe("the dithered sky", () => {
  it("carries all three sky swatches", () => {
    const filter = createSkyFilter({ high: 0xffffff, mid: 0x808080, low: 0x000000 });
    const uniforms = filter.resources["skyUniforms"] as { uniforms: Record<string, unknown> };
    expect(uniforms.uniforms["uHigh"]).toEqual(new Float32Array([1, 1, 1]));
    expect(uniforms.uniforms["uMid"]).toEqual(new Float32Array([128 / 255, 128 / 255, 128 / 255]));
    expect(uniforms.uniforms["uLow"]).toEqual(new Float32Array([0, 0, 0]));
  });

  it("dithers rather than blending", () => {
    const filter = createSkyFilter({ high: 0, mid: 0, low: 0 });
    // A blend would interpolate; a dither picks one swatch or the other.
    expect(fragmentOf(filter)).toContain("bayer");
    expect(fragmentOf(filter)).not.toContain("mix(uLow, uHigh");
  });

  it("clamps climb progress into the unit range", () => {
    const filter = createSkyFilter({ high: 0, mid: 0, low: 0 });
    setSkyProgress(filter, 4);
    const uniforms = filter.resources["skyUniforms"] as { uniforms: Record<string, unknown> };
    expect(uniforms.uniforms["uProgress"]).toBe(1);
  });

  it("keeps the palette lock last, and hands the backdrop back as it found it", async () => {
    // Two failure modes, both silent. Dropping the lock would send two thirds
    // of the picture to the canvas unquantized, with no error and no other
    // failing test. Leaving the race's own passes attached would paint a sky
    // over the results screen and the menu after it -- and a teardown that
    // reads the chain *after* building it restores the race chain to itself,
    // which looks like a teardown and does nothing.
    const stage = fakeStage();
    // The real thing rather than a bare Filter: this is exactly what `app.ts`
    // puts on the backdrop for the life of the app.
    const lock = createPaletteLockFilter();
    stage.backdrop.filters = [lock];

    const { screen } = await gameplayWithFakeNetwork({ stage });

    // The chain is over the scenery's own source now, not over the backdrop
    // layer: the scenery is rendered into a bounded target and the backdrop
    // layer only shows the result. `filterRoot` is that source.
    const lease = stage.leases[0]!;
    const during = (lease.filterRoot as unknown as Container).filters as Filter[];
    expect(during.length).toBeGreaterThan(1);
    expect(during[during.length - 1]).toBe(lock);

    // The layer itself is cleared while the race owns the lock instance. One
    // live Pixi filter carries per-target render state, so leaving it on both
    // the target and the layer would be two targets on one instance.
    expect(stage.backdrop.filters).toEqual([]);

    await screen.exit();

    expect(stage.backdrop.filters).toEqual([lock]);
    // Released exactly once: a second release would be a double free, and none
    // at all would leave a screen-sized texture alive behind the menu.
    expect(lease.destroys).toBe(1);
  });
});
