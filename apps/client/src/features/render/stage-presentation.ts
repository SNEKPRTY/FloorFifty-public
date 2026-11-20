/**
 * The cosmetic presentation of the stage a race is on.
 *
 * The one place a `StageContent` becomes something the renderer can read. Two
 * properties matter and both are about not leaking authority:
 *
 * **It is frozen and copied.** The result shares no object with the content
 * object, so a content refresh that replaces the stage cannot reach into a race
 * that is already running. The spec's rule is that presentation is frozen at
 * screen entry; a reference into live content would be the one way to break it
 * without anyone writing a line that looked wrong.
 *
 * **Absence is a first-class answer.** A stage with no theme, or a build with no
 * stage at all, resolves to the legacy recipe rather than to an error or to a
 * half-filled object. Every consumer reads one shape, and "the art has not been
 * authored yet" stops being a case each of them has to remember.
 */

import type { StageContent, StageLayerContent, SetPieceContent } from "@floor-fifty/shared/content/game-content";

/** The near skyline's parallax factor: an unauthored arc share is depth over this. */
export const NEAR_CITY_FACTOR = 0.35;

/**
 * Where the light stands when a stage says nothing: low behind the rooftops,
 * as both of Rooftops' boards place the sun (spec §2.8 item 7). It was 110,
 * which hung the sun high in an empty sky.
 */
export const DEFAULT_LIGHT_HEIGHT = -60;

export type ResolvedLayer = Readonly<{
  alias: string;
  plate: "sky" | "city";
  depth: number;
  sink: number;
  haze: number;
  extend: "none" | "skirt" | "tile" | "plate";
  arc: number;
  drift: number;
}>;

const layer = (
  alias: string,
  plate: "sky" | "city",
  depth: number,
  sink: number,
  extend: ResolvedLayer["extend"],
  extra: { haze?: number | undefined; arc?: number | undefined; drift?: number | undefined } = {},
): ResolvedLayer =>
  Object.freeze({
    alias,
    plate,
    depth,
    sink,
    extend,
    haze: extra.haze ?? 0,
    arc: plate === "city" ? (extra.arc ?? depth / NEAR_CITY_FACTOR) : 0,
    drift: extra.drift ?? 0,
  });

/** The authored list with its defaults filled in. */
export function resolveLayers(layers: readonly StageLayerContent[]): readonly ResolvedLayer[] {
  return Object.freeze(layers.map((l) => layer(l.alias, l.plate, l.depth, l.sink, l.extend, l)));
}

export type StagePresentation = Readonly<{
  profile: "legacy" | "aquarian";
  backdropAlias: string;
  platformAlias: string;
  /** The sun, or the moon; nothing when absent. */
  lightAlias: string | undefined;
  refractionIntensity: number;
  horizonLift: number;
  /** How far above the world origin the light stands; see `StagePresentationContent.lightHeight`. */
  lightHeight: number;
  /** Whether the light shimmers with heat; see `StagePresentationContent.lightShimmer`. */
  lightShimmer: boolean;
  /** Whether the racers and floors are drawn as black shapes. */
  silhouette: boolean;
  /**
   * The ascent arc as knots of (progress, sink), from (0, 0) to (1, finish).
   * Empty where no arc or no course is authored; see `citySinkAt`.
   */
  citySink: readonly Readonly<{ at: number; sink: number }>[];
  /** The scenery, back to front. `StageLayers` draws only from this. */
  layers: readonly ResolvedLayer[];
  /** The stage's set pieces across fifty floors (Wonder spec §6.4); none without a stage. */
  setPieces: readonly SetPieceContent[];
}>;

/**
 * The scenery for a build with no stage at all: the clouds, the two skylines
 * and the near one's lit windows the client has always drawn without being
 * told to.
 *
 * The factors are the spec's. The clouds are nearly as far as the sky, and
 * here they hold still (any layer may drift, but this build names no speed);
 * they have no skirt, because clouds are meant to
 * end and sky below a cloud is sky. The 0.15 and 0.35 skylines' separation is
 * what parallax reads as distance. The windows ride the near skyline at its
 * depth and sink, because they are its windows, and tile rather than skirt:
 * they are scattered lit windows with no roofline, so repeating them downward
 * reads as more lit storeys, while stretching their last row would give
 * nothing (the art carries a two-row dead margin at its bottom edge).
 */
const FALLBACK_LAYERS: readonly ResolvedLayer[] = resolveLayers([
  { alias: "world.clouds", plate: "sky", depth: 0.06, sink: 0, extend: "none" },
  { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" },
  { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" },
  { alias: "world.lanterns", plate: "city", depth: 0.35, sink: 290, extend: "tile" },
]);

/**
 * The fallback for a build with no stage, written down here so it is one
 * decision instead of several defaults spread across the renderer.
 */
const FALLBACK = {
  backdropAlias: "menu.backdrop",
  platformAlias: "world.platform",
  lightAlias: "world.sun",
} as const;

/**
 * Resolves the presentation for `stage`, or the legacy recipe without one.
 *
 * The returned object is frozen. Nothing downstream needs to write to it, and a
 * caller that tried would be reintroducing the coupling this exists to remove.
 */
export function resolveStagePresentation(
  stage: StageContent | undefined,
): StagePresentation {
  if (stage === undefined) {
    return Object.freeze({
      profile: "legacy",
      ...FALLBACK,
      refractionIntensity: 0,
      horizonLift: 0,
      lightHeight: DEFAULT_LIGHT_HEIGHT,
      lightShimmer: true,
      silhouette: false,
      citySink: NO_ARC,
      layers: FALLBACK_LAYERS,
      setPieces: [],
    });
  }

  const theme = stage.theme;
  const authored = theme.presentation;

  return Object.freeze({
    // The table selects the Aquarian profile (refraction, lift, the arc); the
    // scenery itself is the stage's layer list either way.
    profile: authored === undefined ? "legacy" : "aquarian",
    backdropAlias: theme.backdropAlias,
    platformAlias: stage.platformAlias,
    lightAlias: theme.lightAlias,
    refractionIntensity: authored?.refractionIntensity ?? 0,
    horizonLift: authored?.horizonLift ?? 0,
    lightHeight: authored?.lightHeight ?? DEFAULT_LIGHT_HEIGHT,
    lightShimmer: authored?.lightShimmer ?? true,
    silhouette: authored?.silhouette === true,
    citySink: arcFor(stage),
    layers: resolveLayers(theme.layers),
    setPieces: theme.setPieces ?? [],
  });
}

const NO_ARC: StagePresentation["citySink"] = Object.freeze([]);

/**
 * The ascent arc's knots, from the stage's phrases and authored values.
 *
 * Each phrase's value is placed where the phrase ends, measured in floors: a
 * phrase ending on floor `n` of a climb whose last phrase ends on `last` is at
 * `(n + 1) / (last + 1)` of the ascent, so the finish lands on 1. A value
 * smaller than the one before it is held at the one before it, because a city
 * that rose back up mid-climb would read as the tower sinking.
 */
function arcFor(stage: StageContent): StagePresentation["citySink"] {
  const values = stage.theme.presentation?.citySink;
  const phrases = stage.course?.phrases ?? [];
  if (values === undefined || phrases.length === 0) return NO_ARC;

  const last = Math.max(...phrases.map((phrase) => phrase.toFloor));
  const knots = [{ at: 0, sink: 0 }];
  for (const phrase of [...phrases].sort((a, b) => a.toFloor - b.toFloor)) {
    const previous = knots[knots.length - 1]!;
    knots.push({
      at: (phrase.toFloor + 1) / (last + 1),
      sink: Math.max(previous.sink, values[phrase.name]),
    });
  }
  return Object.freeze(knots.map((knot) => Object.freeze(knot)));
}

/**
 * How far the city has sunk at `progress` through the ascent, in logical
 * units: linear between the arc's knots, so it is continuous at every phrase
 * boundary, and zero where no arc is authored.
 */
export function citySinkAt(presentation: StagePresentation, progress: number): number {
  const knots = presentation.citySink;
  if (knots.length === 0) return 0;
  const t = Math.min(1, Math.max(0, progress));
  for (let index = 1; index < knots.length; index += 1) {
    const from = knots[index - 1]!;
    const to = knots[index]!;
    if (t <= to.at) {
      const span = to.at - from.at;
      return span <= 0 ? to.sink : from.sink + ((t - from.at) / span) * (to.sink - from.sink);
    }
  }
  return knots[knots.length - 1]!.sink;
}
