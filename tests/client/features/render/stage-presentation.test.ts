/**
 * The stage presentation resolver.
 *
 * Two claims, and both are about authority rather than arithmetic. A resolution
 * must not share anything with the content it came from, because a refresh that
 * replaces the stage mid-race would otherwise change scenery under a player who
 * is already climbing. And an absent theme must resolve to the legacy recipe
 * rather than to an error or a half-filled object, because every stage authored
 * before this pass is absent.
 */

import { describe, expect, it } from "vitest";
import {
  asContentId,
  asRevision,
  type GameContent,
  type StageContent,
} from "@floor-fifty/shared/content/game-content";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import {
  citySinkAt,
  resolveLayers,
  resolveStagePresentation,
} from "../../../../apps/client/src/features/render/stage-presentation";
import { fakeContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";

const stage = (theme: StageContent["theme"]): StageContent => ({
  id: asContentId("rooftops"),
  displayName: "Rooftops",
  platformAlias: "world.platform",
  courseTuning: {},
  theme,
});

/** The two skylines every stage has, in layer form. */
const FAR_NEAR: StageContent["theme"]["layers"] = [
  { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
  { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
];

const AQUARIAN = {
  backdropAlias: "menu.backdrop",
  layers: [
    { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
    { alias: "world.cityMid", plate: "city", depth: 0.24, sink: 270, extend: "skirt" },
    { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
    { alias: "world.rooftopDetails", plate: "city", depth: 0.42, sink: 180, extend: "none" },
  ],
  presentation: {
    profile: "aquarian" as const,
    refractionIntensity: 0.65,
    horizonLift: 24,
  },
} satisfies StageContent["theme"];

const aliases = (presentation: { layers: readonly { alias: string }[] } | undefined): string[] =>
  (presentation?.layers ?? []).map((l) => l.alias);

describe("resolving a stage presentation", () => {
  it("falls back to the legacy recipe when there is no stage at all", () => {
    // A build with no content still has to draw something, and it must be the
    // composition the client has always drawn rather than a half-built object.
    const resolved = resolveStagePresentation(undefined);

    expect(resolved.profile).toBe("legacy");
    expect(resolved.backdropAlias).toBe("menu.backdrop");
    expect(resolved.platformAlias).toBe("world.platform");
    expect(aliases(resolved)).toEqual(["world.clouds", "world.cityFar", "world.cityNear", "world.lanterns"]);
    expect(resolved.lightAlias).toBe("world.sun");
    expect(resolved.refractionIntensity).toBe(0);
    expect(resolved.horizonLift).toBe(0);
  });

  it("keeps a stage that authors no presentation on the legacy profile", () => {
    // The alias the theme names are honoured; only the Aquarian composition is
    // withheld, because that is what the missing table means.
    const resolved = resolveStagePresentation(
      stage({ backdropAlias: "menu.backdrop", layers: FAR_NEAR }),
    );

    expect(resolved.profile).toBe("legacy");
    expect(aliases(resolved)).toEqual(["world.cityFar", "world.cityNear"]);
    expect(resolved.refractionIntensity).toBe(0);
  });

  it("honours every value an authored theme supplies", () => {
    const resolved = resolveStagePresentation(stage(AQUARIAN));

    expect(resolved.profile).toBe("aquarian");
    expect(aliases(resolved)).toEqual(["world.cityFar", "world.cityMid", "world.cityNear", "world.rooftopDetails"]);
    expect(resolved.refractionIntensity).toBe(0.65);
    expect(resolved.horizonLift).toBe(24);
    expect(resolved.platformAlias).toBe("world.platform");
  });

  it("resolves each layer's haze, and none where the theme authors none", () => {
    expect(resolveStagePresentation(undefined).layers.map((l) => l.haze)).toEqual([0, 0, 0, 0]);
    expect(resolveStagePresentation(stage(AQUARIAN)).layers.map((l) => l.haze)).toEqual([0, 0, 0, 0]);

    const hazed = resolveStagePresentation(
      stage({
        ...AQUARIAN,
        layers: AQUARIAN.layers.map((l, i) => ({ ...l, haze: [0.4, 0.2, 0, 0][i] })),
      }),
    );
    expect(hazed.layers.map((l) => l.haze)).toEqual([0.4, 0.2, 0, 0]);
    expect(hazed.layers.every((l) => Object.isFrozen(l))).toBe(true);
  });

  it("sinks the city along the course's phrases, monotonic and continuous", () => {
    const phrased = {
      ...stage({
        ...AQUARIAN,
        presentation: {
          ...AQUARIAN.presentation,
          citySink: { teach: 10, combine: 40, recover: 90, finish: 160 },
        },
      }),
      course: {
        seed: 1,
        phrases: [
          { name: "teach" as const, fromFloor: 1, toFloor: 5, purpose: "" },
          { name: "combine" as const, fromFloor: 6, toFloor: 11, purpose: "" },
          { name: "recover" as const, fromFloor: 12, toFloor: 15, purpose: "" },
          { name: "finish" as const, fromFloor: 16, toFloor: 19, purpose: "" },
        ],
      },
    };
    const resolved = resolveStagePresentation(phrased);

    expect(citySinkAt(resolved, 0)).toBe(0);
    expect(citySinkAt(resolved, 1)).toBe(160);
    // Each phrase's value is reached where the phrase ends.
    expect(citySinkAt(resolved, 6 / 20)).toBeCloseTo(10);
    expect(citySinkAt(resolved, 12 / 20)).toBeCloseTo(40);
    expect(citySinkAt(resolved, 16 / 20)).toBeCloseTo(90);

    let previous = -Infinity;
    for (let step = 0; step <= 1000; step += 1) {
      const sink = citySinkAt(resolved, step / 1000);
      expect(sink).toBeGreaterThanOrEqual(previous);
      // Continuous: no step of a thousandth moves it by more than a unit.
      if (step > 0) expect(sink - previous).toBeLessThan(1);
      previous = sink;
    }
  });

  it("does not sink the city where no arc or no course is authored", () => {
    expect(citySinkAt(resolveStagePresentation(undefined), 0.7)).toBe(0);
    expect(citySinkAt(resolveStagePresentation(stage(AQUARIAN)), 0.7)).toBe(0);
  });

  it("copies rather than aliases, and freezes what it returns", () => {
    // The mechanism behind "frozen at entry". A resolution that held the
    // theme's own object would change when content refreshed, and the race
    // would redraw its scenery halfway up without anyone writing a line that
    // looked wrong.
    const source = stage({
      ...AQUARIAN,
      layers: AQUARIAN.layers.map((l) => ({ ...l })),
      presentation: { ...AQUARIAN.presentation },
    });
    const resolved = resolveStagePresentation(source);

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(resolved).not.toBe(source.theme as unknown);
    expect(aliases(resolved)).toContain("world.cityMid");

    // Rewriting the content the resolution came from leaves it untouched.
    (source.theme.layers[1] as { alias: string }).alias = "world.somethingElse";
    (source.theme.presentation as { refractionIntensity: number }).refractionIntensity = 0.1;

    expect(aliases(resolved)[1]).toBe("world.cityMid");
    expect(resolved.refractionIntensity).toBe(0.65);
  });

  it("resolves the same values for equal content, so a rebuild is invisible", () => {
    const first = resolveStagePresentation(stage({ ...AQUARIAN }));
    const second = resolveStagePresentation(stage({ ...AQUARIAN }));

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

/** A server rebuild of the shipped content, with the stage's theme stripped. */
const rebuiltWithoutTheme = (): GameContent => ({
  ...GENERATED_CONTENT,
  content: {
    ...GENERATED_CONTENT.content,
    stages: GENERATED_CONTENT.content.stages.map((entry) => ({
      ...entry,
      theme: {
        backdropAlias: entry.theme.backdropAlias,
        layers: FAR_NEAR,
      },
    })),
  },
  contentRevision: asRevision("f".repeat(64)),
});

describe("a race that is already climbing", () => {
  it("keeps the scenery it resolved when content is replaced under it", async () => {
    // The test above proves the mechanism -- copy and freeze -- on the resolver
    // alone. This drives the path a rebuild actually takes: a mounted screen,
    // a real `ContentPort`, and a swap of what that port answers with. The
    // property under test is `GameplayScreen.presentation`, which is resolved
    // once in `onEnter`; a screen that re-read content anywhere below would
    // redraw its scenery halfway up a climb with nothing reporting it.
    const content = fakeContentPort(GENERATED_CONTENT);
    const gameplay = await gameplayWithFakeNetwork({ content });

    const resolved = gameplay.screen.stagePresentation();
    expect(resolved?.profile).toBe("aquarian");
    expect(aliases(resolved)).toContain("world.cityMid");

    content.set(rebuiltWithoutTheme());
    await content.refresh();

    // Reference identity, not equality. An equal rebuild would satisfy equality
    // while still proving nothing about whether this race re-read its content.
    expect(gameplay.screen.stagePresentation()).toBe(resolved);
    expect(aliases(gameplay.screen.stagePresentation())).toContain("world.cityMid");
    expect(gameplay.screen.stagePresentation()?.refractionIntensity).toBe(0.65);
  });
});

describe("the resolved layer list", () => {
  it("fills an unauthored arc from depth, and none for the sky", () => {
    const [sky, city] = resolveLayers([
      { alias: "a", plate: "sky", depth: 0.06, sink: 0, extend: "none" },
      { alias: "b", plate: "city", depth: 0.24, sink: 270, extend: "skirt" },
    ]);
    expect(sky).toMatchObject({ arc: 0, haze: 0, drift: 0 });
    expect(city!.arc).toBeCloseTo(0.24 / 0.35, 10);
  });

  it("keeps an authored arc, haze and drift", () => {
    const [only] = resolveLayers([
      { alias: "b", plate: "city", depth: 0.1, sink: 0, extend: "skirt", arc: 0.1, haze: 0.3, drift: 0.2 },
    ]);
    expect(only).toMatchObject({ arc: 0.1, haze: 0.3, drift: 0.2 });
  });
});
