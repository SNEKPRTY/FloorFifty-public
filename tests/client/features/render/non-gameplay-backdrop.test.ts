import { Graphics, Texture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  DAWN_REFRACTION_STILL_SECONDS,
  createDawnRefractionFilter,
} from "../../../../apps/client/src/features/render/filters/dawn-refraction";
import type { MusicSpectrum } from "../../../../apps/client/src/features/audio";
import {
  MENU_INTRO,
  MENU_MUSIC_PULSE,
  NonGameplayBackdrop,
  menuIntroZoom,
} from "../../../../apps/client/src/features/render/non-gameplay-backdrop";
import { menuWindows } from "../../../../apps/client/src/features/render/window-breath";
import { RENDER_PRIORITY } from "../../../../apps/client/src/features/platform/render-order";
import { FakeContainer, FakeTicker, fakeStage } from "../../support/fakes/stage";

const environment = () => {
  let hidden = false;
  let reduced = false;
  const visibility = new Set<() => void>();
  const motion = new Set<() => void>();
  return {
    value: {
      hidden: () => hidden,
      reducedMotion: () => reduced,
      onVisibilityChange: (fn: () => void) => (visibility.add(fn), () => visibility.delete(fn)),
      onMotionChange: (fn: () => void) => (motion.add(fn), () => motion.delete(fn)),
    },
    hide(next: boolean) {
      hidden = next;
      for (const fn of visibility) fn();
    },
    reduce(next: boolean) {
      reduced = next;
      for (const fn of motion) fn();
    },
    listenerCount: () => visibility.size + motion.size,
  };
};

const setup = (quality: "high" | "medium" | "low" = "high") => {
  const ticker = new FakeTicker();
  const stage = fakeStage({ ticker });
  const media = environment();
  const filter = createDawnRefractionFilter(quality);
  const controller = new NonGameplayBackdrop(stage, {
    textures: () => Texture.EMPTY,
    quality,
    createFilter: () => filter,
    validateFilter: () => {},
    environment: media.value,
  });
  return { controller, filter, media, stage, ticker };
};

describe("NonGameplayBackdrop", () => {
  it("mounts one logical-screen sprite below existing UI", () => {
    const stage = fakeStage();
    const foreground = new FakeContainer();
    foreground.label = "foreground";
    stage.ui.addChild(foreground as never);
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      validateFilter: () => {},
      environment: environment().value,
    });

    expect(stage.ui.children.map((child) => child.label)).toEqual([
      "non-gameplay-backdrop",
      "foreground",
    ]);
    expect(stage.ui.children[0]?.width).toBe(960);
    expect(stage.ui.children[0]?.height).toBe(540);
    controller.destroy();
    foreground.destroy();
  });

  it("publishes the active filter and resolved quality", () => {
    const { controller, stage } = setup("medium");
    expect(controller.filtered).toBe(true);
    expect(stage.overlay.dataset["refraction"]).toBe("active");
    expect(stage.overlay.dataset["refractionQuality"]).toBe("medium");
    controller.destroy();
  });

  it("keeps the static sprite visible when filter construction fails", () => {
    const stage = fakeStage();
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      createFilter: () => {
        throw new Error("construction failed");
      },
      environment: environment().value,
    });

    expect(controller.filtered).toBe(false);
    expect(stage.ui.children.map((child) => child.label)).toEqual(["non-gameplay-backdrop"]);
    expect(stage.overlay.dataset["refraction"]).toBe("fallback");
    controller.destroy();
  });

  it("rejects and destroys a filter that fails program validation", () => {
    const stage = fakeStage();
    const filter = createDawnRefractionFilter("high");
    const destroy = vi.spyOn(filter, "destroy");
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      createFilter: () => filter,
      validateFilter: () => {
        throw new Error("bad fragment");
      },
      environment: environment().value,
    });

    expect(controller.filtered).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
    expect(stage.ui.children.map((child) => child.label)).toEqual(["non-gameplay-backdrop"]);
    expect(stage.overlay.dataset["refraction"]).toBe("fallback");
    controller.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("eases entry intensity from 0.85 to 1 over 600 ms of watched frames", () => {
    const { controller, filter, ticker } = setup();
    expect(filter.resources.refractionUniforms.uniforms.uIntensity).toBe(0.85);

    // 100ms frames rather than two 300ms steps. The ambient clock clamps a
    // single delta to 100ms -- a stall must not lurch the phase -- so the ease
    // is a function of frames watched and can only be observed at a frame rate.
    for (let frame = 0; frame < 3; frame += 1) ticker.tick(100);
    expect(filter.resources.refractionUniforms.uniforms.uIntensity).toBeCloseTo(0.925);

    for (let frame = 0; frame < 3; frame += 1) ticker.tick(100);
    expect(filter.resources.refractionUniforms.uniforms.uIntensity).toBe(1);
    expect(controller.elapsedSeconds).toBeCloseTo(0.6);
    controller.destroy();
  });

  it("pauses while hidden and discards the browser resume delta", () => {
    const { controller, media, ticker } = setup();
    ticker.tick(100);
    media.hide(true);
    ticker.tick(4_000);
    expect(controller.elapsedSeconds).toBeCloseTo(0.1);
    media.hide(false);
    ticker.tick(4_000);
    expect(controller.elapsedSeconds).toBeCloseTo(0.1);
    ticker.tick(100);
    expect(controller.elapsedSeconds).toBeCloseTo(0.2);
    controller.destroy();
  });

  it("freezes reduced motion at the authored still and resumes at full intensity", () => {
    const { controller, filter, media, ticker } = setup();
    media.reduce(true);
    ticker.tick(1_000);
    expect(filter.resources.refractionUniforms.uniforms.uTime).toBe(
      DAWN_REFRACTION_STILL_SECONDS,
    );
    expect(filter.resources.refractionUniforms.uniforms.uIntensity).toBe(1);
    const frozenElapsed = controller.elapsedSeconds;
    ticker.tick(1_000);
    expect(controller.elapsedSeconds).toBe(frozenElapsed);

    media.reduce(false);
    ticker.tick(100);
    expect(filter.resources.refractionUniforms.uniforms.uTime).toBeCloseTo(frozenElapsed + 0.1);
    expect(filter.resources.refractionUniforms.uniforms.uIntensity).toBe(1);
    controller.destroy();
  });

  it("keeps low quality static", () => {
    const { controller, filter, ticker } = setup("low");
    ticker.tick(1_000);
    expect(controller.elapsedSeconds).toBe(0);
    expect(filter.resources.refractionUniforms.uniforms.uTime).toBe(0);
    controller.destroy();
  });

  it("tears down owned resources once and restores prior dataset state", () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    stage.overlay.dataset["refraction"] = "previous";
    stage.overlay.dataset["refractionQuality"] = "previous-quality";
    const media = environment();
    const filter = createDawnRefractionFilter("high");
    const destroyFilter = vi.spyOn(filter, "destroy");
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      createFilter: () => filter,
      validateFilter: () => {},
      environment: media.value,
    });
    const sprite = stage.ui.children[0];

    controller.destroy();
    controller.destroy();

    expect(ticker.size).toBe(0);
    expect(media.listenerCount()).toBe(0);
    expect(stage.ui.children).toEqual([]);
    expect(sprite?.destroyed).toBe(true);
    expect(destroyFilter).toHaveBeenCalledOnce();
    expect(stage.overlay.dataset["refraction"]).toBe("previous");
    expect(stage.overlay.dataset["refractionQuality"]).toBe("previous-quality");
  });
});

describe("the layered menu (spec §2.8 item 1, §2.9)", () => {
  /** Real textures for the layered plates; nothing else. */
  const layered = (alias: string) =>
    ["menu.backdrop", "menu.cityFar", "menu.cityNear"].includes(alias) ? Texture.WHITE : Texture.EMPTY;

  const mount = (reduced = false) => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const media = environment();
    if (reduced) media.reduce(true);
    const sky = createDawnRefractionFilter("high", "menu");
    const glass = createDawnRefractionFilter("high", "glass");
    const controller = new NonGameplayBackdrop(stage, {
      textures: layered,
      quality: "high",
      createFilter: () => sky,
      createCityRefraction: () => glass,
      validateFilter: () => {},
      environment: media.value,
    });
    const layer = (label: string) =>
      stage.ui.children.find((child) => child.label === label) as unknown as {
        position: { x: number; y: number };
        filters: unknown[] | null;
        children: unknown[];
      };
    return { controller, stage, ticker, media, sky, glass, layer };
  };

  /** A plate with the real 960 x 540 aspect. `Texture.WHITE` is square. */
  const plate = new Texture({ source: new TextureSource({ width: 960, height: 540 }) });
  const mountPlates = () => {
    const stage = fakeStage({ ticker: new FakeTicker() });
    const media = environment();
    media.reduce(true);
    const controller = new NonGameplayBackdrop(stage, {
      textures: (alias) => (["menu.backdrop", "menu.cityFar", "menu.cityNear"].includes(alias) ? plate : Texture.EMPTY),
      quality: "high",
      createFilter: () => createDawnRefractionFilter("high", "menu"),
      createCityRefraction: () => createDawnRefractionFilter("high", "glass"),
      validateFilter: () => {},
      environment: media.value,
    });
    return { controller, stage };
  };

  it("stacks a refracted sky with its clouds, a glassed far city and a crisp near city", () => {
    const { controller, stage, sky, glass, layer } = mount();

    expect(stage.ui.children.map((child) => child.label)).toEqual([
      "non-gameplay-backdrop",
      "non-gameplay-city-far",
      "non-gameplay-city",
    ]);
    expect(layer("non-gameplay-backdrop").filters).toEqual([sky]);
    // The sky is the original painted plate -- its cloud banks and sun -- and
    // nothing else: the city layers stand over it.
    expect(layer("non-gameplay-backdrop").children.length).toBe(1);
    expect(layer("non-gameplay-city-far").filters).toEqual([glass]);
    // Crisp, and still: no glass, and no window glow -- the windows that
    // breathe are the hero's building's (`facade-windows`).
    expect(layer("non-gameplay-city").filters ?? []).toEqual([]);
    controller.destroy();
  });

  it("publishes the windows' clock to the hero's building, and withdraws it when it goes", () => {
    const { controller, ticker } = mount();
    ticker.tick(1000 / 60);
    expect(menuWindows()).toEqual({ seconds: controller.elapsedSeconds, glow: expect.any(Number) });
    controller.destroy();
    expect(menuWindows()).toBeUndefined();
  });

  it("holds the building's windows still at low quality, as the race drops the pass", () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const controller = new NonGameplayBackdrop(stage, {
      textures: layered,
      quality: "low",
      createFilter: () => createDawnRefractionFilter("low", "menu"),
      createCityRefraction: () => createDawnRefractionFilter("low", "gameplay"),
      validateFilter: () => {},
    });
    ticker.tick(1000 / 60);
    expect(menuWindows()).toBeUndefined();
    controller.destroy();
  });

  it("slides the layers against each other as the clock runs", () => {
    const { controller, ticker, layer } = mount();
    const near = () => layer("non-gameplay-city").position.x;
    const before = near();

    // Frame-sized steps: the ambient clock clamps one long frame by design.
    for (let frame = 0; frame < 180; frame += 1) ticker.tick(1000 / 60);

    expect(near()).not.toBeCloseTo(before, 3);
    controller.destroy();
  });

  it("holds every layer where it is when reduced motion arrives mid-way", () => {
    const { controller, ticker, media, layer } = mount();
    for (let frame = 0; frame < 180; frame += 1) ticker.tick(1000 / 60);
    const held = ["non-gameplay-city", "non-gameplay-city-far"].map((label) => ({ ...layer(label).position }));

    media.reduce(true);
    for (let frame = 0; frame < 180; frame += 1) ticker.tick(1000 / 60);

    expect(["non-gameplay-city", "non-gameplay-city-far"].map((label) => ({ ...layer(label).position }))).toEqual(held);
    controller.destroy();
  });

  it("tears down every layer and both filters once", () => {
    const { controller, stage, sky, glass } = mount();
    const destroySky = vi.spyOn(sky, "destroy");
    const destroyGlass = vi.spyOn(glass, "destroy");

    controller.destroy();
    controller.destroy();

    expect(stage.ui.children).toEqual([]);
    expect(destroySky).toHaveBeenCalledOnce();
    expect(destroyGlass).toHaveBeenCalledOnce();
  });

  it("waves the sky at the menu's full optical strength (after review)", () => {
    // The user preferred the original menu: big painted cloud banks waving
    // under the full menu refraction, not the race's gentler optics.
    const stage = fakeStage();
    const profiles: string[] = [];
    const controller = new NonGameplayBackdrop(stage, {
      textures: layered,
      validateFilter: () => {},
      environment: environment().value,
    });
    const filter = (stage.ui.children[0] as unknown as { filters: { glProgram?: { fragment: string } }[] }).filters[0]!;
    profiles.push(String(filter.glProgram?.fragment));
    // The menu profile's warp constants are the unscaled ones.
    expect(profiles[0]).toContain("#define FF_WARP_A 6.0");
    controller.destroy();
  });

  it("falls back to the one refracted plate when the layered art is missing", () => {
    const stage = fakeStage();
    const controller = new NonGameplayBackdrop(stage, {
      textures: (alias) => (alias === "menu.backdrop" ? Texture.WHITE : Texture.EMPTY),
      validateFilter: () => {},
      environment: environment().value,
    });

    expect(stage.ui.children.map((child) => child.label)).toEqual(["non-gameplay-backdrop"]);
    controller.destroy();
  });

  it("fills the canvas past the field with sky above and city below", () => {
    // A portrait phone shows far more canvas than field. The menu's layers are
    // clipped to the field, so without this fill the panel sat on the flat
    // field colour instead of the city.
    const stage = fakeStage();
    const portrait = {
      canvasCss: { x: 0, y: 0, width: 390, height: 844 },
      gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      sceneryLogical: { x: 0, y: -148, width: 960, height: 2077 },
      portrait: true,
      formFactor: "phone-portrait" as const,
      fieldLogical: { width: 960, height: 720 },
      pixelRatio: 2,
    };
    stage.emitViewport(portrait);
    const controller = new NonGameplayBackdrop(stage, {
      textures: layered,
      validateFilter: () => {},
      environment: environment().value,
    });

    const fill = stage.backdrop.children.find((child) => child.label === "non-gameplay-fill") as Graphics | undefined;
    expect(fill).toBeDefined();
    const bounds = () => {
      const b = fill!.getLocalBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    expect(bounds()).toEqual(portrait.sceneryLogical);

    // Refitted on a resize.
    const turned = { ...portrait, sceneryLogical: { x: 0, y: -60, width: 960, height: 660 } };
    stage.emitViewport(turned);
    expect(bounds()).toEqual(turned.sceneryLogical);

    controller.destroy();
    expect(stage.backdrop.children.some((child) => child.label === "non-gameplay-fill")).toBe(false);
  });

  it("covers the whole portrait canvas with the plate, city anchored to the bottom (spec §5.1)", () => {
    const { controller, stage } = mountPlates();
    const scenery = { x: 0, y: -60 / 0.40625, width: 960, height: 844 / 0.40625 };
    stage.emitViewport({
      canvasCss: { x: 0, y: 0, width: 390, height: 844 },
      gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      sceneryLogical: scenery,
      portrait: true,
      formFactor: "phone-portrait",
      fieldLogical: { width: 960, height: 720 },
      pixelRatio: 1,
    });
    const sky = controller.layerBounds("sky");
    expect(sky.top).toBeLessThanOrEqual(scenery.y);
    expect(sky.bottom).toBeGreaterThanOrEqual(scenery.y + scenery.height);
    expect(sky.left).toBeLessThanOrEqual(scenery.x);
    expect(sky.right).toBeGreaterThanOrEqual(scenery.x + scenery.width);
    const near = controller.layerBounds("near");
    expect(near.bottom).toBeCloseTo(scenery.y + scenery.height, 0);
    expect(near.bottom - near.top).toBeLessThanOrEqual(scenery.height / 3 + 1);
    // Out of the field's clip, so the plate is not cut to the field strip.
    expect(stage.ui.children.some((child) => child.label === "non-gameplay-backdrop")).toBe(false);
    controller.destroy();
  });

  it("leaves the landscape placement exactly as it was, including after a rotation back", () => {
    const { controller, stage } = mountPlates();
    const bounds = () => (["sky", "far", "near"] as const).map((layer) => controller.layerBounds(layer));
    const before = bounds();
    const uiLabels = stage.ui.children.map((child) => child.label);

    stage.emitViewport({ ...stage.viewport, formFactor: "desktop" });
    expect(bounds()).toEqual(before);

    // Portrait and back: the layers return to the clipped `ui`, in their order.
    stage.emitViewport({
      canvasCss: { x: 0, y: 0, width: 390, height: 844 },
      gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      sceneryLogical: { x: 0, y: -148, width: 960, height: 2077 },
      portrait: true,
      formFactor: "phone-portrait",
      fieldLogical: { width: 960, height: 720 },
      pixelRatio: 1,
    });
    stage.emitViewport({ ...stage.viewport, canvasCss: { x: 0, y: 0, width: 1280, height: 720 }, gameplayCss: { x: 0, y: 72, width: 1280, height: 576 }, sceneryLogical: { x: 0, y: 0, width: 960, height: 540 }, portrait: false, formFactor: "desktop" });
    expect(bounds()).toEqual(before);
    expect(stage.ui.children.map((child) => child.label)).toEqual(uiLabels);
    controller.destroy();
  });
});

describe("the menu's painted sun", () => {
  type Shimmer = {
    resources: { shimmerUniforms: { uniforms: { uTime: number; uRegion: Float32Array; uMasked: number } } };
  };
  const withPlate = () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const media = environment();
    const controller = new NonGameplayBackdrop(stage, {
      // The plate alone: the painted sun is in it, and the cities are not needed.
      textures: (alias: string) => (alias === "menu.backdrop" ? Texture.WHITE : Texture.EMPTY),
      quality: "high",
      createFilter: () => createDawnRefractionFilter("high"),
      validateFilter: () => {},
      environment: media.value,
    });
    const plate = stage.ui.children[0]!.children.find((child) => child.label === "non-gameplay-sky")!;
    const shimmer = (plate.filters as readonly unknown[] | undefined)?.[0] as Shimmer | undefined;
    return { controller, media, shimmer, ticker };
  };

  it("hazes only a region around where the sun is painted", () => {
    // Breaks if the shimmer is left off the plate (the menu's sun never moves),
    // or runs unmasked (the whole sky would swim).
    const { controller, shimmer } = withPlate();
    expect(shimmer).toBeDefined();
    const uniforms = shimmer!.resources.shimmerUniforms.uniforms;
    expect(uniforms.uMasked).toBe(1);
    // The disc is painted at (514, 332) of the 960 x 540 plate.
    expect(uniforms.uRegion[0]).toBeCloseTo(0.5354, 3);
    expect(uniforms.uRegion[1]).toBeCloseTo(0.6148, 3);
    controller.destroy();
  });

  it("moves on the menu's clock, and holds the still pose under reduced motion", () => {
    const { controller, media, shimmer, ticker } = withPlate();
    for (let frame = 0; frame < 5; frame += 1) ticker.tick(100);
    const uniforms = shimmer!.resources.shimmerUniforms.uniforms;
    expect(uniforms.uTime).toBeGreaterThan(0);
    expect(uniforms.uTime).toBe(controller.elapsedSeconds);

    media.reduce(true);
    expect(uniforms.uTime).toBe(DAWN_REFRACTION_STILL_SECONDS);
    controller.destroy();
  });

  it("has no shimmer when there is no plate to paint a sun on", () => {
    const { controller, stage } = setup();
    const plate = stage.ui.children[0]!.children.find((child) => child.label === "non-gameplay-sky")!;
    expect(plate.filters ?? []).toEqual([]);
    controller.destroy();
  });
});

describe("the bloom band", () => {
  const withBand = (createFilter?: () => ReturnType<typeof createDawnRefractionFilter>) => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const setBloomBand = vi.fn();
    Object.assign(stage, { setBloomBand });
    const media = environment();
    const filter = createDawnRefractionFilter("high");
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      quality: "high",
      createFilter:
        createFilter ??
        (() => filter),
      validateFilter: () => {},
      environment: media.value,
    });
    return { controller, filter, media, setBloomBand, ticker };
  };

  it("follows the refraction's clock and intensity, frame by frame", () => {
    // Breaks if the menu stops telling the bloom, or tells it a different
    // moment from the one the band is drawn at -- the damp would then sit
    // beside the band rather than on it.
    const { controller, filter, setBloomBand, ticker } = withBand();
    for (let frame = 0; frame < 3; frame += 1) ticker.tick(100);
    const uniforms = filter.resources.refractionUniforms.uniforms;
    expect(setBloomBand).toHaveBeenLastCalledWith({
      timeSeconds: controller.elapsedSeconds,
      intensity: uniforms.uIntensity,
    });
    expect(controller.elapsedSeconds).toBeGreaterThan(0);
    controller.destroy();
  });

  it("follows the still pose under reduced motion", () => {
    const { controller, media, setBloomBand } = withBand();
    media.reduce(true);
    expect(setBloomBand).toHaveBeenLastCalledWith({ timeSeconds: DAWN_REFRACTION_STILL_SECONDS, intensity: 1 });
    controller.destroy();
  });

  it("clears the band when the menu goes", () => {
    // Breaks if teardown forgets: the race would inherit a damp on a band
    // that is no longer drawn, dimming whatever white passes under it.
    const { controller, setBloomBand } = withBand();
    controller.destroy();
    expect(setBloomBand).toHaveBeenLastCalledWith(undefined);
  });

  it("reports no band when the refraction that draws it did not survive", () => {
    const { controller, setBloomBand } = withBand(() => {
      throw new Error("no program");
    });
    expect(setBloomBand).toHaveBeenLastCalledWith(undefined);
    controller.destroy();
  });
});

describe("the title's intro zoom", () => {
  const zoomed = (reduce = false) => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const media = environment();
    media.reduce(reduce);
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      createFilter: () => createDawnRefractionFilter("high"),
      validateFilter: () => {},
      environment: media.value,
      zoomIn: true,
    });
    const width = () => {
      const sky = controller.layerBounds("sky");
      return sky.right - sky.left;
    };
    return { controller, ticker, width };
  };

  const restWidth = () => {
    const { controller } = setup();
    const sky = controller.layerBounds("sky");
    controller.destroy();
    return sky.right - sky.left;
  };

  it("starts zoomed in and is home as the last racer lands", () => {
    const { controller, ticker, width } = zoomed();
    const rest = restWidth();
    expect(width()).toBeCloseTo(rest * MENU_INTRO.from);

    ticker.tick((MENU_INTRO.seconds * 1000) / 2);
    expect(width()).toBeGreaterThan(rest);
    expect(width()).toBeLessThan(rest * MENU_INTRO.from);

    ticker.tick((MENU_INTRO.seconds * 1000) / 2);
    expect(width()).toBeCloseTo(rest);

    ticker.tick(1_000);
    expect(width()).toBeCloseTo(rest);
    controller.destroy();
  });

  it("is at rest from the start under reduced motion", () => {
    const { controller, width } = zoomed(true);
    expect(width()).toBeCloseTo(restWidth());
    controller.destroy();
  });

  it("eases in and out: slow, then fast, then slow, and never past the rest", () => {
    const at = (fraction: number) => menuIntroZoom(MENU_INTRO.seconds * fraction);
    expect(at(0)).toBeCloseTo(MENU_INTRO.from);
    expect(at(0.5)).toBeCloseTo(1 + (MENU_INTRO.from - 1) / 2);
    expect(at(1)).toBe(1);
    // The middle tenth covers more ground than either end's.
    const middle = at(0.45) - at(0.55);
    expect(middle).toBeGreaterThan(at(0) - at(0.1));
    expect(middle).toBeGreaterThan(at(0.9) - at(1));
    for (let ms = 0; ms <= 2000; ms += 10) expect(menuIntroZoom(ms / 1000)).toBeGreaterThanOrEqual(1);
  });
});

describe("the menu song", () => {
  const layered = (alias: string) =>
    ["menu.backdrop", "menu.cityFar", "menu.cityNear"].includes(alias) ? Texture.WHITE : Texture.EMPTY;

  /** The kick's band at `low`, 0 to 1 of the analyser's -100 dB to -30 dB, and nothing else. */
  const kickBand = (low: number): MusicSpectrum => {
    const binHz = 48_000 / 1024;
    const bins = new Uint8Array(512);
    const decibels = new Float32Array(512).fill(-Infinity);
    bins.forEach((_, bin) => {
      if (bin * binHz < 40 || bin * binHz >= 160) return;
      bins[bin] = Math.round(low * 255);
      decibels[bin] = -100 + low * 70;
    });
    return { bins, decibels, binHz };
  };

  const mount = (options: { beatZoom?: boolean; reduced?: boolean; still?: () => boolean } = {}) => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    const media = environment();
    media.reduce(options.reduced === true);
    let playing = kickBand(0.1);
    const controller = new NonGameplayBackdrop(stage, {
      textures: layered,
      quality: "high",
      createFilter: () => createDawnRefractionFilter("high", "menu"),
      createCityRefraction: () => createDawnRefractionFilter("high", "glass"),
      validateFilter: () => {},
      environment: media.value,
      music: () => playing,
      beatZoom: () => options.beatZoom === true,
      ...(options.still === undefined ? {} : { still: options.still }),
    });
    const glow = () => menuWindows()!.glow;
    const width = () => {
      const sky = controller.layerBounds("sky");
      return sky.right - sky.left;
    };
    // A quiet bar to settle on, then the kick lands.
    for (let frame = 0; frame < 60; frame += 1) ticker.tick(1000 / 60);
    const rest = { glow: glow(), width: width() };
    const kick = () => {
      playing = kickBand(0.9);
      ticker.tick(1000 / 60);
      playing = kickBand(0.1);
    };
    return { controller, ticker, glow, width, rest, kick };
  };

  it("lights the building's windows on the kick, and lets them fall back", () => {
    const { controller, ticker, glow, rest, kick } = mount();
    kick();
    expect(glow() - rest.glow).toBeGreaterThan(MENU_MUSIC_PULSE.windowKick * 0.8);
    for (let frame = 0; frame < 40; frame += 1) ticker.tick(1000 / 60);
    expect(glow()).toBeCloseTo(rest.glow, 1);
    controller.destroy();
  });

  it("strikes the title's camera with the kick, and only the title's", () => {
    const title = mount({ beatZoom: true });
    title.kick();
    expect(title.width() / title.rest.width).toBeGreaterThan(1 + MENU_MUSIC_PULSE.zoom * 0.8);
    for (let frame = 0; frame < 40; frame += 1) title.ticker.tick(1000 / 60);
    expect(title.width() / title.rest.width).toBeCloseTo(1, 3);
    title.controller.destroy();

    const lobby = mount({ beatZoom: false });
    lobby.kick();
    expect(lobby.width()).toBeCloseTo(lobby.rest.width);
    lobby.controller.destroy();
  });

  it("leaves the camera to the intro until the pull back is home", () => {
    const ticker = new FakeTicker();
    const stage = fakeStage({ ticker });
    let playing = kickBand(0.1);
    const controller = new NonGameplayBackdrop(stage, {
      textures: () => Texture.EMPTY,
      createFilter: () => createDawnRefractionFilter("high"),
      validateFilter: () => {},
      environment: environment().value,
      zoomIn: true,
      music: () => playing,
      beatZoom: () => true,
    });
    const width = () => {
      const sky = controller.layerBounds("sky");
      return sky.right - sky.left;
    };
    for (let frame = 0; frame < 20; frame += 1) ticker.tick(1000 / 60);
    const before = width();
    playing = kickBand(0.9);
    ticker.tick(1000 / 60);
    // Still pulling back: the kick did not push it in.
    expect(width()).toBeLessThan(before);

    // Home, and the beat carries on: every kick from here strikes the camera.
    playing = kickBand(0.1);
    for (let frame = 0; frame < 60; frame += 1) ticker.tick(1000 / 60);
    const rest = width();
    for (let beat = 0; beat < 3; beat += 1) {
      playing = kickBand(0.9);
      ticker.tick(1000 / 60);
      expect(width() / rest).toBeGreaterThan(1 + MENU_MUSIC_PULSE.zoom * 0.8);
      playing = kickBand(0.1);
      for (let frame = 0; frame < 30; frame += 1) ticker.tick(1000 / 60);
      expect(width() / rest).toBeCloseTo(1, 2);
    }
    controller.destroy();
  });

  it("holds still and at rest under reduced motion", () => {
    const { controller, glow, width, rest, kick } = mount({ beatZoom: true, reduced: true });
    kick();
    expect(glow()).toBeCloseTo(rest.glow);
    expect(width()).toBeCloseTo(rest.width);
    controller.destroy();
  });

  it("holds still and at rest with the stage effects off, and moves again when they come back on", () => {
    let off = true;
    const { controller, ticker, glow, width, rest, kick } = mount({ beatZoom: true, still: () => off });
    kick();
    expect(glow()).toBeCloseTo(rest.glow);
    expect(width()).toBeCloseTo(rest.width);

    off = false;
    for (let frame = 0; frame < 60; frame += 1) ticker.tick(1000 / 60);
    const settled = glow();
    kick();
    expect(glow() - settled).toBeGreaterThan(MENU_MUSIC_PULSE.windowKick * 0.8);
    controller.destroy();
  });

  it("registers its ticker pass ahead of the backdrop pass priority", () => {
    const { controller, ticker } = setup();
    expect(ticker.priorities[0]).toBe(RENDER_PRIORITY.gameplayDraw);
    expect(ticker.priorities[0]).toBeGreaterThan(RENDER_PRIORITY.backdrop);
    controller.destroy();
  });
});

