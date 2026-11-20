/**
 * The scenery composition.
 *
 * Three claims, and each is a way a scenery layer goes wrong quietly. The depth
 * order is what parallax reads as distance, and putting a layer in the wrong
 * place still renders -- it just stops looking like a city. A missing texture
 * has to cost its own layer and nothing else. And the cosmetic lift has to be a
 * function of authoritative progress rather than an accumulator, or a reset and
 * a second lap each leave the scenery a little further from where it started.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RenderTexture, Texture, TilingSprite, type Filter } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  asContentId,
  parseGameContentArtifact,
  type StageContent,
} from "@floor-fifty/shared/content/game-content";
import {
  CITY_CAMERA_COUPLING,
  HORIZON_LIFT_SECONDS,
  NEAR_CITY_FACTOR,
  StageLayers,
} from "../../../../apps/client/src/features/render/stage-layers";
import {
  resolveStagePresentation,
  type StagePresentation,
} from "../../../../apps/client/src/features/render/stage-presentation";
import { LOGICAL_VIEWPORT } from "../../../../apps/client/src/lib/constants";

const AQUARIAN: StageContent = {
  id: asContentId("rooftops"),
  displayName: "Rooftops",
  platformAlias: "world.platform",
  courseTuning: {},
  theme: {
    backdropAlias: "menu.backdrop",
    lightAlias: "world.sun",
    layers: [
      { alias: "world.clouds", plate: "sky", depth: 0.06, sink: 0, extend: "none", drift: 1.5 },
      { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
      { alias: "world.cityMid", plate: "city", depth: 0.24, sink: 270, extend: "skirt" },
      { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
      { alias: "world.lanterns", plate: "city", depth: 0.35, sink: 290, extend: "tile" },
      { alias: "world.rooftopDetails", plate: "city", depth: 0.42, sink: 180, extend: "none" },
      { alias: "world.rooftopProps", plate: "city", depth: 0.42, sink: 180, extend: "none" },
    ],
    presentation: {
      profile: "aquarian",
      refractionIntensity: 0.65,
      horizonLift: 24,
    },
  },
};

const LEGACY: StageContent = {
  ...AQUARIAN,
  theme: {
    backdropAlias: "menu.backdrop",
    lightAlias: "world.sun",
    layers: [
      { alias: "world.clouds", plate: "sky", depth: 0.06, sink: 0, extend: "none" },
      { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
      { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
      { alias: "world.lanterns", plate: "city", depth: 0.35, sink: 290, extend: "tile" },
    ],
  },
};

/** The real plates' heights, so a strip is as tall as the art it stands for. */
const HEIGHTS: Readonly<Record<string, number>> = {
  "world.clouds": 140,
  "world.cityFar": 360,
  "world.cityMid": 400,
  "world.cityNear": 440,
  "world.lanterns": 440,
  "world.rooftopDetails": 220,
  "world.rooftopProps": 220,
};
const sized = new Map<string, Texture>();
const sizedTexture = (alias: string): Texture => {
  const height = HEIGHTS[alias];
  if (height === undefined) return Texture.WHITE;
  let texture = sized.get(alias);
  if (texture === undefined) {
    texture = RenderTexture.create({ width: 960, height });
    sized.set(alias, texture);
  }
  return texture;
};

/** Every alias a real texture, except the ones a test asks to be missing. */
const textures = (...missing: string[]) => (alias: string) =>
  missing.includes(alias) ? Texture.EMPTY : sizedTexture(alias);

const layersFor = (stage: StageContent | undefined, ...missing: string[]): StageLayers =>
  new StageLayers(resolveStagePresentation(stage), textures(...missing));

/** Long enough for the lift to have arrived. */
const SETTLED_MS = HORIZON_LIFT_SECONDS * 1_000 * 20;

describe("the scenery composition", () => {
  it("orders the layers by depth, back to front", () => {
    const layers = layersFor(AQUARIAN);

    expect(layers.labels).toEqual([
      "world.clouds",
      "world.cityFar",
      "world.cityMid",
      "world.cityNear",
      "world.lanterns",
      "world.rooftopDetails",
      "world.rooftopProps",
    ]);
    // The spec's factors, in the same order. Neighbouring skylines are 0.09 to
    // 0.11 apart, and collapsing any of them onto its neighbour would flatten
    // the picture into two layers. The props share the details' strip.
    expect(layers.factors).toEqual([0.06, 0.15, 0.24, 0.35, 0.35, 0.42, 0.42]);

    layers.destroy();
  });

  it("draws the classic composition when the stage authors no theme", () => {
    const layers = layersFor(LEGACY);

    expect(layers.labels).toEqual([
      "world.clouds",
      "world.cityFar",
      "world.cityNear",
      "world.lanterns",
    ]);

    layers.destroy();
  });

  it("skips only the layer whose texture is missing", () => {
    // "Optional" is a statement about the art. A stage with no middle skyline
    // draws the other five layers rather than failing to draw scenery.
    const layers = layersFor(AQUARIAN, "world.cityMid");

    expect(layers.labels).not.toContain("world.cityMid");
    expect(layers.labels).toContain("world.rooftopDetails");
    expect(layers.labels).toContain("world.cityNear");

    layers.destroy();
  });

  it("splits the scenery into a sky root and a city root", () => {
    // The sky is refracted and the city is not, so they cannot share a root:
    // a filter on one container reaches all of its children. The sun and the
    // clouds are the sky; every skyline, their windows and the rooftop props
    // are the city, in depth order.
    const layers = layersFor(AQUARIAN);
    const strips = (root: typeof layers.skyRoot) =>
      root.children.map((child) => child.label).filter((name) => !name.endsWith(".skirt"));

    expect(layers.skyRoot.label).toBe("stage-sky");
    expect(layers.cityRoot.label).toBe("stage-city");
    expect(strips(layers.skyRoot)).toEqual(["world.sun", "world.clouds"]);
    expect(strips(layers.cityRoot)).toEqual([
      "world.cityFar",
      "world.cityMid",
      "world.cityNear",
      "world.lanterns",
      "world.rooftopDetails",
      "world.rooftopProps",
    ]);
    // No shared root to put a filter on by mistake.
    expect("root" in layers).toBe(false);

    layers.destroy();
  });

  it("reports the city as nearest-sampled only when every city texture is", () => {
    const layers = layersFor(AQUARIAN);
    const strip = layers.cityRoot.children[0] as unknown as { texture: Texture };
    const scaleMode = strip.texture.source.scaleMode;

    strip.texture.source.scaleMode = "nearest";
    for (const child of layers.cityRoot.children) {
      (child as unknown as { texture: Texture }).texture.source.scaleMode = "nearest";
    }
    expect(layers.citySampling).toBe("nearest");

    strip.texture.source.scaleMode = "linear";
    expect(layers.citySampling).toBe("linear");

    strip.texture.source.scaleMode = scaleMode;
    layers.destroy();
  });

  it("holds scenery and nothing else", () => {
    // The one failure a scenery layer is capable of causing: a rooftop drawn
    // where a player is about to land, implying a surface that is not there.
    // Nothing here is a platform, a racer or a mark -- every child is the sun,
    // a named layer, or the skirt derived from one.
    const layers = layersFor(AQUARIAN);
    const names = [...layers.skyRoot.children, ...layers.cityRoot.children].map(
      (child) => child.label,
    );

    for (const name of names) {
      const isScenery =
        name === "world.sun" ||
        layers.labels.includes(name) ||
        layers.labels.some((label) => name === `${label}.skirt`);
      expect(isScenery, `${name} is not scenery`).toBe(true);
    }
    // The three city strips are the ones that need a skirt; the clouds, the
    // windows and the props are not.
    expect(names.filter((name) => name.endsWith(".skirt"))).toHaveLength(3);

    layers.destroy();
  });
});

describe("the cosmetic horizon lift", () => {
  it("is a function of progress rather than an accumulator", () => {
    // The rule that makes a reset and a second lap return to the same
    // transforms. Driven to the top, then back to the bottom, the lift has to
    // arrive where a fresh race starts -- not somewhere further up.
    const layers = layersFor(AQUARIAN);
    const climb = (progress: number): number => {
      layers.update(0, progress, 0, SETTLED_MS, true);
      return layers.horizonLift;
    };

    expect(climb(1)).toBeCloseTo(24);
    expect(climb(0)).toBeCloseTo(0);
    expect(climb(1)).toBeCloseTo(24);
    expect(climb(0)).toBeCloseTo(0);

    layers.destroy();
  });

  it("smoothsteps rather than moving linearly", () => {
    // A lift that started moving abruptly at the ends of the race would read as
    // a cut. The half-way value of the smoothstep is exactly half, and the
    // quarter point is below it -- which a linear map would not be.
    const layers = layersFor(AQUARIAN);
    const at = (progress: number): number => {
      layers.update(0, progress, 0, SETTLED_MS, true);
      return layers.horizonLift;
    };

    expect(at(0.5)).toBeCloseTo(12);
    expect(at(0.25)).toBeLessThan(6);

    layers.destroy();
  });

  it("applies immediately under reduced motion", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 1, 0, 16.67, true);

    expect(layers.horizonLift).toBeCloseTo(24);

    layers.destroy();
  });

  it("eases rather than snapping when motion is allowed", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 1, 0, 16.67, false);

    // One frame of a 400ms ease covers a fraction of the distance, not all of it.
    expect(layers.horizonLift).toBeGreaterThan(0);
    expect(layers.horizonLift).toBeLessThan(24);

    layers.destroy();
  });

  it("is under a stage's own value, so a theme with none does not lift", () => {
    const layers = layersFor(LEGACY);
    layers.update(0, 1, 0, SETTLED_MS, true);

    expect(layers.horizonLift).toBe(0);

    layers.destroy();
  });
});

describe("the crisp city", () => {
  const cityStrips = (layers: StageLayers) =>
    layers.cityRoot.children.filter((child) => !child.label.endsWith(".skirt"));

  it("lands every city layer on a whole device pixel", () => {
    // Nearest sampling is only crisp if the texels start on a pixel; a strip at
    // a fractional offset repeats or drops a row wherever the rounding falls.
    const layers = layersFor(AQUARIAN);
    const pixelsPerUnit = 2.5;

    layers.update(123.37, 0.41, 2.2, 16.7, false, { pixelsPerUnit });

    for (const strip of cityStrips(layers)) {
      const y = strip.position.y * pixelsPerUnit;
      expect(Math.abs(y - Math.round(y)), `${strip.label} y`).toBeLessThan(1e-6);
    }

    layers.destroy();
  });

  it("forces nearest sampling on the city's textures", () => {
    // Art that arrived linear -- a loader default, a later global change --
    // must not reach the skyline as linear.
    const previous = Texture.WHITE.source.scaleMode;
    Texture.WHITE.source.scaleMode = "linear";
    const layers = layersFor(AQUARIAN);

    expect(layers.citySampling).toBe("nearest");

    layers.destroy();
    Texture.WHITE.source.scaleMode = previous;
  });

  it("moves the sky across ambient time and holds the city when lift and drift are fixed", () => {
    // The sky is the part that breathes; the city is the part that holds. With
    // progress settled and the camera still, only the clouds may move.
    const layers = layersFor(AQUARIAN);
    layers.update(50, 0.3, 1, SETTLED_MS, false, { pixelsPerUnit: 2 });
    const clouds = layers.skyRoot.children.find((child) => child.label === "world.clouds") as unknown as {
      tilePosition: { x: number };
    };
    const cityBefore = cityStrips(layers).map((strip) => [strip.position.x, strip.position.y]);
    const cloudsBefore = clouds.tilePosition.x;

    layers.update(50, 0.3, 4, 16.7, false, { pixelsPerUnit: 2 });

    expect(clouds.tilePosition.x).not.toBe(cloudsBefore);
    expect(cityStrips(layers).map((strip) => [strip.position.x, strip.position.y])).toEqual(cityBefore);

    layers.destroy();
  });
});

describe("atmospheric haze", () => {
  /** Rooftops' list with the haze named per alias. */
  const withHaze = (haze: Readonly<Record<string, number>>) =>
    AQUARIAN.theme.layers.map((l) => (haze[l.alias] === undefined ? l : { ...l, haze: haze[l.alias] }));

  it("hazes each skyline by its own authored amount, and nothing else", () => {
    const asked: [string, number][] = [];
    const layers = new StageLayers(
      resolveStagePresentation({
        ...AQUARIAN,
        theme: {
          ...AQUARIAN.theme,
          layers: withHaze({ "world.cityFar": 0.4, "world.cityMid": 0.2, "world.cityNear": 0.05 }),
        },
      }),
      textures(),
      (texture, amount) => {
        asked.push([String(texture.label ?? ""), amount]);
        return undefined;
      },
    );

    expect(asked.map(([, amount]) => amount)).toEqual([0.4, 0.2, 0.05]);

    layers.destroy();
  });

  it("draws the hazed copy and releases it with the layers", () => {
    const hazed = new Texture({ source: Texture.WHITE.source });
    // Stubbed: the copy shares the white source, which later cases still need.
    const destroy = vi.spyOn(hazed, "destroy").mockImplementation(() => undefined);
    const layers = new StageLayers(
      resolveStagePresentation({
        ...AQUARIAN,
        theme: {
          ...AQUARIAN.theme,
          layers: withHaze({ "world.cityFar": 0.4 }),
        },
      }),
      textures(),
      (_texture, amount) => (amount > 0 ? hazed : undefined),
    );

    const far = layers.cityRoot.children.find((child) => child.label === "world.cityFar") as unknown as {
      texture: Texture;
    };
    expect(far.texture).toBe(hazed);

    layers.destroy();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("window codes", () => {
  it("draws every city plate from its window-coded copy, and releases the copies", () => {
    const coded = new Texture({ source: Texture.WHITE.source });
    const destroy = vi.spyOn(coded, "destroy").mockImplementation(() => undefined);
    const layers = new StageLayers(resolveStagePresentation(AQUARIAN), textures(), () => undefined, () => coded);

    const city = layers.cityRoot.children.filter((child) => child.label.startsWith("world.") && !child.label.endsWith(".skirt"));
    expect(city.length).toBeGreaterThan(0);
    for (const layer of city) expect((layer as unknown as { texture: Texture }).texture).toBe(coded);
    // The clouds are sky, and a sky has no windows.
    const clouds = layers.skyRoot.children.find((child) => child.label === "world.clouds") as unknown as {
      texture: Texture;
    };
    expect(clouds.texture).not.toBe(coded);
    expect(layers.windowsCoded).toBe(true);

    layers.destroy();
    expect(destroy).toHaveBeenCalled();
  });

  it("says so when a plate could not be read, so the shader falls back", () => {
    const layers = new StageLayers(resolveStagePresentation(AQUARIAN), textures(), () => undefined, () => undefined);
    expect(layers.windowsCoded).toBe(false);
    layers.destroy();
  });
});

/** A stage whose city sinks along the course phrases. */
const ARCED: StageContent = {
  ...AQUARIAN,
  theme: {
    ...AQUARIAN.theme,
    presentation: {
      ...AQUARIAN.theme.presentation!,
      citySink: { teach: 10, combine: 40, recover: 90, finish: 160 },
    },
  },
  course: {
    seed: 1,
    phrases: [
      { name: "teach", fromFloor: 1, toFloor: 5, purpose: "" },
      { name: "combine", fromFloor: 6, toFloor: 11, purpose: "" },
      { name: "recover", fromFloor: 12, toFloor: 15, purpose: "" },
      { name: "finish", fromFloor: 16, toFloor: 19, purpose: "" },
    ],
  },
};

describe("the ascent arc", () => {
  const skylineY = (layers: StageLayers) =>
    layers.cityRoot.children.find((child) => child.label === "world.cityNear")!.position.y;
  const cloudsY = (layers: StageLayers) =>
    layers.skyRoot.children.find((child) => child.label === "world.clouds")!.position.y;

  it("sinks the city and not the sky as the climb goes on", () => {
    const layers = layersFor(ARCED);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const cityStart = skylineY(layers);
    const skyStart = cloudsY(layers);

    layers.update(0, 1, 0, SETTLED_MS, true);

    // Down the screen by the finish value, less the lift the whole scenery
    // takes; the sky only takes the lift.
    const lift = layers.horizonLift;
    expect(skylineY(layers) - cityStart).toBeCloseTo(160 + lift, 0);
    expect(cloudsY(layers) - skyStart).toBeCloseTo(lift, 5);
    expect(layers.citySink).toBeCloseTo(160);

    layers.destroy();
  });

  it("returns to the start of the arc on a new lap", () => {
    const layers = layersFor(ARCED);
    layers.update(0, 0.9, 0, SETTLED_MS, false);
    layers.update(0, 0, 0, SETTLED_MS, false);

    expect(layers.citySink).toBeCloseTo(0, 3);

    layers.destroy();
  });
});

describe("the portrait city", () => {
  const tops = (layers: StageLayers) =>
    layers.cityRoot.children
      .filter((child) => !child.label.endsWith(".skirt"))
      .map((child) => child.position.y - (child as unknown as { height: number }).height);

  it("sinks every city layer below the line it is given, keeping their order", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const landscape = tops(layers);

    layers.update(0, 0, 0, SETTLED_MS, true, { cityTopMin: 900 });
    const portrait = tops(layers);

    expect(Math.min(...portrait)).toBeGreaterThanOrEqual(900 - 1e-6);
    // One shift for the whole city, so the depth ladder is unchanged.
    const shift = portrait[0]! - landscape[0]!;
    portrait.forEach((top, index) => expect(top - landscape[index]!).toBeCloseTo(shift, 6));
  });

  it("still parallaxes as the camera climbs", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true, { cityTopMin: 900 });
    const before = tops(layers)[0]!;
    layers.update(300, 0, 0, SETTLED_MS, true, { cityTopMin: 900 });

    expect(tops(layers)[0]).not.toBeCloseTo(before, 3);
  });

  it("stands a sky plate's foot down with the city, so no haze band opens between them", () => {
    // A tall phone sinks the city into the lower third. A sky plate left where
    // it was would show its flat foot band repeated down the gap -- Snow
    // Shrine's white strip. Lowered by the same shift, its horizon stays on
    // the skylines as it is on a landscape screen.
    const plated: StageContent = {
      ...AQUARIAN,
      theme: {
        ...AQUARIAN.theme,
        layers: [{ alias: "world.dawnSky", plate: "sky", depth: 0.06, sink: 200, extend: "plate" }, ...AQUARIAN.theme.layers],
      },
    };
    const layers = layersFor(plated);
    const plate = () => layers.skyRoot.children.find((child) => child.label === "world.dawnSky")!.position.y;
    const near = () => layers.cityRoot.children.find((child) => child.label === "world.cityNear")!.position.y;
    layers.update(0, 0, 0, SETTLED_MS, true);
    const [plateBefore, nearBefore] = [plate(), near()];
    layers.update(0, 0, 0, SETTLED_MS, true, { cityTopMin: 900 });
    expect(near() - nearBefore).toBeGreaterThan(0);
    expect(plate() - plateBefore).toBeCloseTo(near() - nearBefore, 6);
    layers.destroy();
  });

  it("does nothing where the city is already below the line", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const landscape = tops(layers);
    layers.update(0, 0, 0, SETTLED_MS, true, { cityTopMin: -10_000 });

    expect(tops(layers)).toEqual(landscape);
  });
});

describe("the sun", () => {
  it("sits low on the horizon, behind the rooftops, as both boards place it", () => {
    // The world origin is the horizon the near rooftops stand on; the sun's
    // centre is at most 40 units above it at the start of the climb (it was
    // 110, which put it high in an empty sky).
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    expect(sun.position.y).toBeGreaterThanOrEqual(-40);
    layers.destroy();
  });

  it("stands at the stage's own height, so a moon can hang high in a night sky", () => {
    const high: StageContent = {
      ...AQUARIAN,
      theme: { ...AQUARIAN.theme, presentation: { ...AQUARIAN.theme.presentation!, lightHeight: 360 } },
    };
    const layers = layersFor(high);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    expect(sun.position.y).toBe(-360);
    layers.update(500, 0, 0, SETTLED_MS, true);
    // Still on the sky's parallax: the height moves its start, not its motion.
    expect(sun.position.y).toBeCloseTo(-360 - 500 * (1 - 0.06), 6);
    layers.destroy();
  });

  it("does not shimmer where the stage says its light is cold", () => {
    // A moon is not hot: the heat wisps read as white scratches around it.
    const cold: StageContent = {
      ...AQUARIAN,
      theme: { ...AQUARIAN.theme, presentation: { ...AQUARIAN.theme.presentation!, lightShimmer: false } },
    };
    const layers = layersFor(cold);
    const light = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    expect(light.filters ?? []).toHaveLength(0);
    layers.destroy();
  });

  it("shimmers with heat on the ambient clock, so it freezes when that clock does", () => {
    // Breaks if the shimmer is never hung on the sun, or never told the time --
    // either way the sun sits still, which is the bug the user reported.
    const layers = layersFor(AQUARIAN);
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    const shimmer = (sun.filters as readonly Filter[] | undefined)?.[0] as
      | { resources: { shimmerUniforms: { uniforms: { uTime: number } } } }
      | undefined;
    expect(shimmer).toBeDefined();

    layers.update(0, 0, 3.5, 16, false);
    expect(shimmer!.resources.shimmerUniforms.uniforms.uTime).toBe(3.5);
    layers.update(0, 0, 7, 16, false);
    expect(shimmer!.resources.shimmerUniforms.uniforms.uTime).toBe(7);
    layers.destroy();
  });

  it("gives the heat room around the disc, sized to the sun as drawn", () => {
    // Breaks if the padding stays fixed: the wisps are drawn out past the
    // disc, and a pass padded for one zoom clips them flat at another. The
    // shader is told the same padding, or its idea of where the disc is drifts.
    // The sun's real plate size; the 1 x 1 stand-in would make any padding pass.
    const plate = RenderTexture.create({ width: 256, height: 256 });
    const layers = new StageLayers(resolveStagePresentation(AQUARIAN), (alias: string) =>
      alias === "world.sun" ? plate : Texture.WHITE,
    );
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    const shimmer = (sun.filters as readonly Filter[])[0]! as Filter & {
      resources: { shimmerUniforms: { uniforms: { uPadding: number } } };
    };

    layers.update(0, 0, 0, 16, false);
    const width = sun.getBounds().width;
    expect(width).toBeGreaterThan(0);
    expect(shimmer.padding).toBeGreaterThanOrEqual(width * 0.75);
    expect(shimmer.resources.shimmerUniforms.uniforms.uPadding).toBe(shimmer.padding);

    // Drawn twice as large, padded twice as much.
    layers.skyRoot.scale.set(2);
    layers.update(0, 0, 0, 16, false);
    expect(shimmer.padding).toBeGreaterThanOrEqual(width * 2 * 0.75);
    expect(shimmer.resources.shimmerUniforms.uniforms.uPadding).toBe(shimmer.padding);
    layers.destroy();
  });

  it("releases its shimmer with the scenery, once", () => {
    // Breaks if teardown forgets the filter: its program would outlive every race.
    const layers = layersFor(AQUARIAN);
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    const shimmer = (sun.filters as readonly Filter[])[0]!;
    const destroy = vi.spyOn(shimmer, "destroy");
    layers.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("is a modest disc, not a wall of light", () => {
    // About a seventh of the field's width, as the boards draw it.
    const layers = layersFor(AQUARIAN);
    const sun = layers.skyRoot.children.find((child) => child.label === "world.sun")!;
    expect(sun.scale.x * 256).toBeLessThanOrEqual(150);
    layers.destroy();
  });
});

describe("the arc-driven city", () => {
  // Launch polish spec §2.8 item 11: the arc, not the camera, decides where the
  // city stands. The root follows the camera, so a layer at local y shows at
  // rootY + y, where rootY = cameraY at scale 1.
  const screenY = (layers: StageLayers, label: string, cameraY: number) =>
    cameraY + layers.cityRoot.children.find((child) => child.label === label)!.position.y;

  it("holds the city nearly still while the camera climbs, keeping a little parallax", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0.2, 0, SETTLED_MS, true);
    const before = screenY(layers, "world.cityNear", 0);
    layers.update(600, 0.2, 0, SETTLED_MS, true);

    // Within a unit: the city snaps to whole device pixels.
    const moved = screenY(layers, "world.cityNear", 600) - before;
    expect(Math.abs(moved - 600 * 0.35 * CITY_CAMERA_COUPLING)).toBeLessThanOrEqual(1);
    layers.destroy();
  });

  it("drops the city by the arc, the nearer layers furthest", () => {
    const layers = layersFor(ARCED);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const nearStart = screenY(layers, "world.cityNear", 0);
    const farStart = screenY(layers, "world.cityFar", 0);
    layers.update(0, 1, 0, SETTLED_MS, true);

    const lift = layers.horizonLift;
    expect(screenY(layers, "world.cityNear", 0) - nearStart).toBeCloseTo(160 + lift, 0);
    expect(screenY(layers, "world.cityFar", 0) - farStart).toBeCloseTo(160 * (0.15 / NEAR_CITY_FACTOR) + lift, 0);
    layers.destroy();
  });

  it("returns to the teach position on a new lap", () => {
    const layers = layersFor(ARCED);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const start = screenY(layers, "world.cityNear", 0);
    layers.update(0, 0.9, 0, SETTLED_MS, true);
    layers.update(0, 0, 0, SETTLED_MS, true);

    expect(screenY(layers, "world.cityNear", 0)).toBeCloseTo(start, 3);
    layers.destroy();
  });

  it("leaves the sky on the camera", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const clouds = () => layers.skyRoot.children.find((child) => child.label === "world.clouds")!.position.y;
    const before = clouds();
    layers.update(600, 0, 0, SETTLED_MS, true);

    expect(clouds() - before).toBeCloseTo(-600 * (1 - 0.06), 3);
    layers.destroy();
  });
});

describe("the cloud band (Task 7, after review)", () => {
  // One wide band drifting across the sky, waving under the sky's refraction --
  // the look the user preferred to separate drifting clouds.
  const band = (layers: StageLayers) =>
    layers.skyRoot.children.find((child) => child.label === "world.clouds") as unknown as {
      tilePosition: { x: number };
      children: unknown[];
    };

  it("is one tiled strip, not a field of separate clouds", () => {
    const layers = layersFor(AQUARIAN);
    expect(band(layers).children).toHaveLength(0);
    expect(band(layers).tilePosition).toBeDefined();
    layers.destroy();
  });

  it("holds still when the ambient clock does", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 5, 16, true);
    const once = band(layers).tilePosition.x;
    layers.update(0, 0, 5, 16, true);
    expect(band(layers).tilePosition.x).toBe(once);
    layers.destroy();
  });
});

describe("a stage's own scenery", () => {
  const DAWN: StageContent = {
    ...AQUARIAN,
    id: asContentId("dawn"),
    theme: {
      backdropAlias: "world.dawnSky",
      layers: [
        { alias: "world.dawnSky", plate: "sky", depth: 0.06, sink: 440, extend: "plate" },
        { alias: "world.dawnMist", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
        { alias: "world.dawnNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
      ],
      presentation: { profile: "aquarian", refractionIntensity: 0.4, horizonLift: 12 },
    },
  };

  it("draws the far and near skylines the stage names", () => {
    expect(layersFor(DAWN).labels).toEqual(["world.dawnSky", "world.dawnMist", "world.dawnNear"]);
  });

  it("puts a named sky plate first in the sky root, in place of the sun and the clouds", () => {
    const layers = layersFor(DAWN);
    const plates = layers.skyRoot.children.map((child) => child.label).filter((name) => !name.includes(".skirt"));
    expect(plates).toEqual(["world.dawnSky"]);
    expect(layers.cityRoot.children.some((child) => child.label === "world.lanterns")).toBe(false);
  });

  it("draws the sky plate at the frame's width, continued above and below it", () => {
    // Twice the width showed only the plate's middle quarter: the sun's glow,
    // zoomed. And a tall phone ran out of plate above and below.
    const layers = layersFor(DAWN);
    layers.update(0, 0, 0, 16, true);
    const byLabel = (label: string) => layers.skyRoot.children.find((child) => child.label === label)!;
    const plate = byLabel("world.dawnSky").getBounds();
    const above = byLabel("world.dawnSky.skirtAbove").getBounds();
    const below = byLabel("world.dawnSky.skirt").getBounds();

    expect(plate.width).toBeCloseTo(LOGICAL_VIEWPORT.width);
    expect(above.width).toBeCloseTo(plate.width);
    expect(below.width).toBeCloseTo(plate.width);
    expect(above.bottom).toBeCloseTo(plate.top);
    expect(below.top).toBeCloseTo(plate.bottom);
    expect(above.height).toBeGreaterThan(LOGICAL_VIEWPORT.height);
    expect(below.height).toBeGreaterThan(LOGICAL_VIEWPORT.height);

    // And they move with it.
    layers.update(900, 0.5, 1, 16, true);
    expect(byLabel("world.dawnSky.skirtAbove").getBounds().bottom).toBeCloseTo(byLabel("world.dawnSky").getBounds().top);
    expect(byLabel("world.dawnSky.skirt").getBounds().top).toBeCloseTo(byLabel("world.dawnSky").getBounds().bottom);
  });

  it("leaves the rooftops' composition as it was", () => {
    expect(layersFor(AQUARIAN).labels).toEqual([
      "world.clouds",
      "world.cityFar",
      "world.cityMid",
      "world.cityNear",
      "world.lanterns",
      "world.rooftopDetails",
      "world.rooftopProps",
    ]);
    expect(layersFor(AQUARIAN).skyRoot.children.map((child) => child.label)).toEqual(["world.sun", "world.clouds"]);
    expect(layersFor(LEGACY).labels).toEqual(["world.clouds", "world.cityFar", "world.cityNear", "world.lanterns"]);
  });
});

/**
 * The theme names the sky's drift, its light and the props (select spec §4.5),
 * so no stage is spelled out in the renderer. Rooftops draws exactly as it did
 * when they were written into this file.
 */
describe("layers from the theme", () => {
  const rooftops = (): StageContent => {
    const artifact = parseGameContentArtifact(
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
    );
    return artifact.content.stages.find((stage) => stage.id === "rooftops")!;
  };
  const buildLayers = (presentation: StagePresentation): StageLayers => new StageLayers(presentation, textures());
  /** Rooftops' skylines and details with no drift and no props. */
  const BARE = AQUARIAN.theme.layers.filter(
    (l) => !["world.clouds", "world.lanterns", "world.rooftopProps"].includes(l.alias),
  );
  // Through the theme, not a hand-edited presentation: the renderer draws the
  // resolved layer list, which a presentation's alias fields no longer steer.
  const themed = (overrides: Partial<StageContent["theme"]>): StagePresentation =>
    resolveStagePresentation({
      ...AQUARIAN,
      theme: {
        ...AQUARIAN.theme,
        layers: BARE,
        lightAlias: undefined,
        ...overrides,
      },
    });
  /** Everything drawn, sky then city, skirts included. */
  const labels = (layers: StageLayers): string[] =>
    [...layers.skyRoot.children, ...layers.cityRoot.children].map((child) => child.label);

  /** Taken from the renderer before the theme named these, as the regression guard. */
  // Rooftops' composition since the stage ascent caught it up to its board: the
  // sky plate and its repeated bands first, then the sun, the clouds and the
  // birds, the horizon in front of the sky and behind the city, then the city.
  const ROOFTOPS_COMPOSITION = [
    "world.rooftopsSky",
    "world.rooftopsSky.skirt",
    "world.rooftopsSky.skirtAbove",
    "world.sun",
    "world.cloudsHigh",
    "world.clouds",
    "world.cloudsLow",
    "world.birds",
    "world.rooftopsHorizon",
    "world.rooftopsHorizon.skirt",
    "world.cityFar",
    "world.cityFar.skirt",
    "world.cityMid",
    "world.cityMid.skirt",
    "world.cityNear",
    "world.cityNear.skirt",
    "world.lanterns",
    "world.rooftopDetails",
    "world.rooftopProps",
  ];

  it("draws the theme's drift, light and props, and nothing it omits", () => {
    const layers = buildLayers(themed({
        layers: [{ alias: "world.snowfall", plate: "sky", depth: 0.06, sink: 0, extend: "none" }, ...BARE],
        lightAlias: "world.moon",
      }));
    expect(labels(layers)).toContain("world.snowfall");
    expect(labels(layers)).toContain("world.moon");
    expect(labels(layers)).not.toContain("world.clouds");
    expect(labels(layers)).not.toContain("world.sun");
    expect(labels(layers)).not.toContain("world.lanterns");
    layers.destroy();
  });

  it("keeps a drift over a stage's own sky plate", () => {
    const layers = buildLayers(themed({
        layers: [
          { alias: "world.snowShrineSky", plate: "sky", depth: 0.06, sink: 440, extend: "plate" },
          { alias: "world.snowfall", plate: "sky", depth: 0.06, sink: 0, extend: "none" },
          ...BARE,
        ],
      }));
    expect(labels(layers)).toContain("world.snowfall");
    layers.destroy();
  });

  it("draws Rooftops' composition, back to front", () => {
    const layers = buildLayers(resolveStagePresentation(rooftops()));
    expect(labels(layers)).toEqual(ROOFTOPS_COMPOSITION);
    layers.destroy();
  });
});

describe("layers as data", () => {
  const stage = (layers: StageContent["theme"]["layers"]): StageContent => ({
    ...AQUARIAN,
    theme: { ...AQUARIAN.theme, layers, presentation: { ...AQUARIAN.theme.presentation!, citySink: undefined } },
  });
  const horizon = { alias: "world.cityFar", plate: "city", depth: 0.1, sink: 200, extend: "skirt", arc: 0.1 } as const;
  const near = { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" } as const;

  it("draws exactly the authored list, in order", () => {
    const layers = layersFor(stage([horizon, near]));
    expect(layers.labels).toEqual(["world.cityFar", "world.cityNear"]);
    expect(layers.factors).toEqual([0.1, 0.35]);
    layers.destroy();
  });

  it("keeps ties in list order, so windows stay in front of their building", () => {
    const windows = { ...near, alias: "world.lanterns", extend: "tile" } as const;
    const layers = layersFor(stage([near, windows]));
    expect(layers.labels).toEqual(["world.cityNear", "world.lanterns"]);
    expect(layers.cityRoot.children.map((child) => child.label)).toEqual([
      "world.cityNear",
      "world.cityNear.skirt",
      "world.lanterns",
    ]);
    layers.destroy();
  });

  it("sinks a layer by its own arc share, and returns it on a new lap", () => {
    const arced: StageContent = {
      ...stage([horizon, near]),
      course: {
        seed: 1,
        phrases: [
          { name: "teach", fromFloor: 1, toFloor: 5, purpose: "p" },
          { name: "combine", fromFloor: 6, toFloor: 11, purpose: "p" },
          { name: "recover", fromFloor: 12, toFloor: 15, purpose: "p" },
          { name: "finish", fromFloor: 16, toFloor: 19, purpose: "p" },
        ],
      },
      theme: {
        ...stage([horizon, near]).theme,
        presentation: { ...AQUARIAN.theme.presentation!, horizonLift: 0, citySink: { teach: 0, combine: 0, recover: 0, finish: 500 } },
      },
    };
    const layers = layersFor(arced);
    const y = (label: string) =>
      layers.cityRoot.children.find((child) => child.label === label)!.position.y;

    layers.update(0, 0, 0, SETTLED_MS, true);
    const startHorizon = y("world.cityFar");
    const startNear = y("world.cityNear");
    layers.update(0, 1, 0, SETTLED_MS, true);
    // The near layer takes the whole arc (depth / 0.35 = 1); the horizon a tenth.
    expect(y("world.cityNear") - startNear).toBeCloseTo(500, 0);
    expect(y("world.cityFar") - startHorizon).toBeCloseTo(50, 0);
    layers.update(0, 0, 0, SETTLED_MS, true);
    expect(y("world.cityFar")).toBe(startHorizon);
    layers.destroy();
  });

  it("drifts each layer at its own speed, and holds every one still with the clock", () => {
    const snowFar = { alias: "world.clouds", plate: "sky", depth: 0.06, sink: 0, extend: "none", drift: 0.5 } as const;
    const snowNear = { alias: "world.snowNear", plate: "sky", depth: 0.08, sink: 0, extend: "none", drift: 2 } as const;
    const layers = layersFor(stage([snowFar, snowNear, near]));
    const tile = (label: string) =>
      (layers.skyRoot.children.find((child) => child.label === label) as TilingSprite).tilePosition.x;

    layers.update(0, 0, 10, 16, false);
    expect(tile("world.snowNear")).toBeCloseTo(tile("world.clouds") * 4, 5);
    const held = [tile("world.clouds"), tile("world.snowNear")];
    layers.update(0, 0, 10, 16, false);
    expect([tile("world.clouds"), tile("world.snowNear")]).toEqual(held);
    layers.destroy();
  });

  it("hazes each layer by its own amount", () => {
    // A fresh texture, not the one passed in: the layers destroy their hazed
    // copies, and the passed-in one is the shared sized fixture.
    const hazer = vi.fn((_texture: Texture, _amount: number) => RenderTexture.create({ width: 960, height: 360 }));
    const layers = new StageLayers(
      resolveStagePresentation(stage([{ ...horizon, haze: 0.4 }, near])),
      textures(),
      hazer,
    );
    expect(hazer.mock.calls.map(([, amount]) => amount)).toEqual([0.4]);
    layers.destroy();
  });

  it("is as tall as its texture", () => {
    const layers = layersFor(stage([horizon, near]));
    const strip = layers.cityRoot.children.find((child) => child.label === "world.cityFar") as TilingSprite;
    expect(strip.height).toBe(360);
    layers.destroy();
  });

  it("skips only the layer whose texture is missing", () => {
    const layers = layersFor(stage([horizon, near]), "world.cityFar");
    expect(layers.labels).toEqual(["world.cityNear"]);
    layers.destroy();
  });
});

describe("the stretched skirts", () => {
  it("reports the lowest skirted skyline's foot, where every skirt is stretching", () => {
    const layers = layersFor(AQUARIAN);
    layers.update(0, 0, 0, SETTLED_MS, true);
    const feet = layers.cityRoot.children
      .filter((child) => child.label.endsWith(".skirt"))
      .map((skirt) => skirt.position.y);
    expect(layers.skirtFoot).toBe(Math.max(...feet));
    layers.destroy();
  });

  it("has none when no skyline skirts", () => {
    const bare: StageContent = {
      ...AQUARIAN,
      theme: { ...AQUARIAN.theme, layers: [{ alias: "world.rooftopDetails", plate: "city", depth: 0.42, sink: 180, extend: "none" }] },
    };
    const layers = layersFor(bare);
    expect(layers.skirtFoot).toBeUndefined();
    layers.destroy();
  });
});

describe("final review fixes", () => {
  it("draws a sky plate behind the light wherever it sits in the list, as the schema allows", () => {
    // R5 lets the plate be the first *sky* layer, after city layers: the light
    // must still draw over it, or the sun vanishes behind an opaque picture.
    const late: StageContent = {
      ...AQUARIAN,
      theme: {
        ...AQUARIAN.theme,
        layers: [
          { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
          { alias: "world.dawnSky", plate: "sky", depth: 0.06, sink: 200, extend: "plate" },
          { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
        ],
      },
    };
    const layers = layersFor(late);
    const order = layers.skyRoot.children.map((child) => child.label);
    expect(order.indexOf("world.dawnSky")).toBeLessThan(order.indexOf("world.sun"));
    layers.destroy();
  });

  it("lands a drifting city layer on a whole device pixel", () => {
    // Snow Shrine's near snow is a city layer that drifts. Its drift is added
    // before the snap, or a nearest-sampled strip doubles or drops columns.
    const drifting: StageContent = {
      ...AQUARIAN,
      theme: {
        ...AQUARIAN.theme,
        layers: [{ alias: "world.snowNear", plate: "city", depth: 0.5, sink: 140, extend: "none", arc: 0, drift: 1.6 }],
      },
    };
    const layers = layersFor(drifting);
    layers.update(0, 0, 1.3, 16, false, { pixelsPerUnit: 2 });
    const strip = layers.cityRoot.children.find((child) => child.label === "world.snowNear") as TilingSprite;
    expect((strip.tilePosition.x * 2) % 1).toBeCloseTo(0, 9);
    layers.destroy();
  });
});

describe("the stage's motion (Wonder spec §6.2–6.3)", () => {
  const sprite = (layers: StageLayers, label: string) =>
    [...layers.skyRoot.children, ...layers.cityRoot.children].find((child) => child.label === label) as TilingSprite;

  it("adds the bob to city layers by depth, the jolt to the nearest only, the surge to drifting sky layers, on whole units", () => {
    const still = layersFor(AQUARIAN);
    const moved = layersFor(AQUARIAN);
    still.update(0, 0, 10, SETTLED_MS, false, {});
    moved.update(0, 0, 10, SETTLED_MS, false, {}, { bob: -4, jolt: 6, surge: 10 });
    const dy = (label: string) => sprite(moved, label).position.y - sprite(still, label).position.y;

    expect(dy("world.rooftopProps")).toBe(-4 + 6); // the nearest: the whole bob and the jolt
    expect(dy("world.cityNear")).toBe(Math.round((-4 * 0.35) / 0.42));
    expect(dy("world.cityFar")).toBe(Math.round((-4 * 0.15) / 0.42));
    for (const label of ["world.rooftopProps", "world.cityNear", "world.cityFar"]) expect(Number.isInteger(dy(label))).toBe(true);
    expect(sprite(moved, "world.clouds").tilePosition.x - sprite(still, "world.clouds").tilePosition.x).toBeCloseTo(10 * 1.5, 6);
    expect(sprite(moved, "world.clouds").position.y).toBe(sprite(still, "world.clouds").position.y); // the sky does not bob
    still.destroy();
    moved.destroy();
  });

  it("moves nothing without motion", () => {
    const still = layersFor(AQUARIAN);
    const zero = layersFor(AQUARIAN);
    still.update(0, 0, 10, SETTLED_MS, false, {});
    zero.update(0, 0, 10, SETTLED_MS, false, {}, { bob: 0, jolt: 0, surge: 0 });
    expect(sprite(zero, "world.cityNear").position.y).toBe(sprite(still, "world.cityNear").position.y);
    still.destroy();
    zero.destroy();
  });
});
