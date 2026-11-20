/**
 * A stage file.
 *
 * `courseTuning` and `theme` are deliberately separate tables: the first is
 * gameplay and lands in the stage's `courseRevision` as well as
 * `contentRevision`, the second is cosmetic and lands in `contentRevision`
 * alone. Keeping them apart in the file is what makes that partition legible
 * to the person editing it.
 *
 * `course` runs that same partition through one table. Its `seed` selects which
 * course the generator produces and so reaches the stage's `courseRevision`;
 * its `phrases` are the review vocabulary that explains the result and change
 * nothing a player can collide with. The design permits a course authored
 * either by geometry or by "a deterministic recipe the pipeline selects", and
 * this is the second: the floors are still generated, and the stage freezes
 * which generation it means.
 */

import { z } from "zod";
import { asContentId } from "@floor-fifty/shared/content/game-content";
import { contentIdSchema } from "./catalog";
import { DISPLAY_NAME_MAX_LENGTH } from "./character";
import { tuningMapSchema } from "./tuning";

/** The four readable phrases, in the order a player meets them. */
export const PHRASE_NAMES = ["teach", "combine", "recover", "finish"] as const;

const PURPOSE_MAX_LENGTH = 240;

/**
 * One named stretch of the climb.
 *
 * `fromFloor`/`toFloor` are inclusive generated-floor indices. Floor zero is
 * the fixed starting seat, which no phrase teaches, so a phrase never begins
 * below one.
 */
const phraseSchema = z
  .object({
    name: z.enum(PHRASE_NAMES),
    fromFloor: z.number().int().min(1),
    toFloor: z.number().int().min(1),
    purpose: z.string().min(1).max(PURPOSE_MAX_LENGTH),
  })
  .strict()
  .superRefine((phrase, ctx) => {
    if (phrase.toFloor < phrase.fromFloor)
      ctx.addIssue({
        code: "custom",
        path: ["toFloor"],
        message: "must not be below fromFloor",
      });
  });

/**
 * A stretch of the climb above the four-phrase arc (race-options spec §4).
 * Unnamed: the arc and the city's sink are the four phrases' alone, and an
 * extension only records, for a reviewer, what a longer course asks.
 */
const extensionSchema = z
  .object({
    fromFloor: z.number().int().min(1),
    toFloor: z.number().int().min(1),
    purpose: z.string().min(1).max(PURPOSE_MAX_LENGTH),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.toFloor < entry.fromFloor)
      ctx.addIssue({ code: "custom", path: ["toFloor"], message: "must not be below fromFloor" });
  });

/**
 * The authored course.
 *
 * Optional, because a stage that names no seed is still a legal stage: the room
 * draws one and the race is an ordinary generated climb. A stage that does name
 * one has frozen its course, and every room on it plays the same floors.
 */
const courseSchema = z
  .object({
    seed: z.number().int().min(0),
    phrases: z.array(phraseSchema),
    extension: z.array(extensionSchema).optional(),
  })
  .strict()
  .superRefine((course, ctx) => {
    const names = course.phrases.map((phrase) => phrase.name);
    if (names.length !== PHRASE_NAMES.length || names.some((n, i) => n !== PHRASE_NAMES[i]))
      ctx.addIssue({
        code: "custom",
        path: ["phrases"],
        message: `must name ${PHRASE_NAMES.join(", ")} exactly once, in that order`,
      });
  });

/**
 * One scenery layer.
 *
 * `depth` is the parallax factor; `sink` where its roofline starts; `haze` the
 * share stippled toward the sky at mount; `arc` its share of the ascent arc
 * (default `depth / 0.35`, the near skyline's factor); `drift` its sideways
 * speed. A layer's height is its texture's.
 */
const layerSchema = z
  .object({
    alias: z.string().min(1),
    plate: z.enum(["sky", "city"]),
    depth: z.number().finite().min(0).max(1),
    sink: z.number().finite().min(-720).max(1440),
    haze: z.number().finite().min(0).max(1).optional(),
    extend: z.enum(["none", "skirt", "tile", "plate"]),
    arc: z.number().finite().min(0).max(2).optional(),
    drift: z.number().finite().min(0).max(3).optional(),
  })
  .strict()
  .superRefine((layer, ctx) => {
    if (layer.extend === "plate" && layer.plate !== "sky")
      ctx.addIssue({ code: "custom", path: ["extend"], message: 'a full-frame plate is a sky picture: only with plate = "sky"' });
    if (layer.arc !== undefined && layer.plate !== "city")
      ctx.addIssue({ code: "custom", path: ["arc"], message: "the ascent arc moves the city; a sky layer has none" });
    if ((layer.drift ?? 0) > 0 && layer.extend === "plate")
      ctx.addIssue({ code: "custom", path: ["drift"], message: "a sky plate is one picture and cannot drift" });
  });

/**
 * The composition, back to front. Order is depth: within each plate a layer
 * may not be nearer than the one after it, which is how "the middle skyline
 * drawn in front of the near one" becomes a build error. Ties keep list order.
 * A sky plate (`extend = "plate"`) comes first among the sky layers, because
 * `StageLayers` draws a leading plate behind the light and everything else in
 * front of it.
 */
export const stageLayersSchema = z
  .array(layerSchema)
  .min(1)
  .superRefine((layers, ctx) => {
    const seen = new Set<string>();
    const nearest = { sky: 0, city: 0 };
    let skyBefore = false;
    layers.forEach((layer, index) => {
      if (layer.extend === "plate" && skyBefore)
        ctx.addIssue({
          code: "custom",
          path: [index, "extend"],
          message: "a sky plate is drawn behind the light and the other sky layers, so it must be the first sky layer",
        });
      if (layer.plate === "sky") skyBefore = true;
      if (seen.has(layer.alias))
        ctx.addIssue({ code: "custom", path: [index, "alias"], message: `${layer.alias} is already in the list` });
      seen.add(layer.alias);
      if (layer.depth < nearest[layer.plate])
        ctx.addIssue({
          code: "custom",
          path: [index, "depth"],
          message: `is further than the ${layer.plate} layer before it; list layers back to front`,
        });
      nearest[layer.plate] = Math.max(nearest[layer.plate], layer.depth);
    });
  });

/** The moods a set piece's palette shift steps toward (Wonder spec §6.4). */
export const SET_PIECE_MOOD_NAMES = ["sunset", "storm", "deepWater", "aurora", "night", "dawn", "day", "bright"] as const;

const setPieceBase = {
  // Where it plays in a fifty-floor race; scaled to any other (Wonder spec §6.5).
  floor: z.number().int().min(1).max(50),
  holdMs: z.number().int().min(500).max(20_000),
};
const layerList = z.array(z.string().min(1)).min(1).max(6);

/**
 * One set piece: a code-owned kind a stage picks and parameterises. Cosmetic,
 * so it reaches `contentRevision` only. Set pieces sharing a floor play
 * together as one group.
 */
export const setPieceSchema = z.discriminatedUnion("kind", [
  z.object({ ...setPieceBase, kind: z.literal("lightsOut"), invert: z.boolean().optional() }).strict(),
  // `stay` holds the mood after the hold, and the next shift steps on from it: a sunrise that builds.
  z.object({ ...setPieceBase, kind: z.literal("paletteShift"), mood: z.enum(SET_PIECE_MOOD_NAMES), stay: z.boolean().optional() }).strict(),
  z
    .object({
      ...setPieceBase,
      kind: z.literal("weatherBurst"),
      particle: z.enum(["snow", "rain", "bubble"]),
      density: z.number().min(0).max(1),
      layers: layerList.optional(),
    })
    .strict(),
  z
    .object({
      ...setPieceBase,
      kind: z.literal("skyFlash"),
      // Three at most, at no more than three a second (WCAG 2.3.1).
      flashes: z.number().int().min(1).max(3),
      tone: z.enum(["lightning", "aurora"]),
      kick: z.number().min(0).max(4).optional(),
    })
    .strict(),
  z.object({ ...setPieceBase, kind: z.literal("swarm"), layers: layerList, speed: z.number().min(1).max(20) }).strict(),
]);

export const stageSchema = z
  .object({
    id: contentIdSchema.transform(asContentId),
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    // Earned by play: the condition's ID in unlocks.toml. Absent, the stage is
    // open (or, filed in a DLC pack, owned).
    unlock: contentIdSchema.transform(asContentId).optional(),
    platformAlias: z.string().min(1),
    courseTuning: tuningMapSchema,
    course: courseSchema.optional(),
    theme: z
      .object({
        backdropAlias: z.string().min(1),
        // The sun or the moon. A theme that omits it simply doesn't draw one.
        lightAlias: z.string().min(1).optional(),
        // The select screen's still: the wide picture its preview pans.
        previewAlias: z.string().min(1).optional(),
        // The scenery, back to front (see `stageLayersSchema`): the only
        // description of what stands behind the climb.
        layers: stageLayersSchema,
        // The bed under the race; absent, Rooftops' (`bedForStage`).
        ambienceAlias: z.string().min(1).optional(),
        // Cosmetic only. Bounded rather than merely numeric: these reach a
        // shader, and a value outside the range the renderer was tuned for is a
        // broken picture rather than a strong one.
        presentation: z
          .object({
            profile: z.literal("aquarian"),
            refractionIntensity: z.number().finite().min(0).max(0.8),
            horizonLift: z.number().finite().min(0).max(48),
            // How far above the world origin the sun or moon stands at the
            // start of the climb, in logical units; absent, low behind the
            // rooftops as Rooftops' board places it (-60).
            lightHeight: z.number().finite().min(-200).max(600).optional(),
            // Whether the light shimmers with heat; a moon is cold (false).
            lightShimmer: z.boolean().optional(),
            // Draws the racers and floors as black shapes (cosmetic).
            silhouette: z.boolean().optional(),
            // How far the city has sunk by the end of each course phrase, in
            // logical units; see `StageCitySinkContent`.
            citySink: z
              .object({
                teach: z.number().finite().min(0).max(720),
                combine: z.number().finite().min(0).max(720),
                recover: z.number().finite().min(0).max(720),
                finish: z.number().finite().min(0).max(720),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        // The stage's own set pieces across fifty floors (Wonder spec §6.4).
        setPieces: z.array(setPieceSchema).max(16).default([]),
      })
      .strict(),
  })
  .strict();
