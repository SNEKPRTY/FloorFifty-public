/**
 * The generated content contract.
 *
 * One versioned artifact crosses from the compiler to the runtime, and this
 * file is both its type and its only decoder. The decoder is pure: it reads no
 * file, recomputes no hash, and trusts nothing about the value handed to it,
 * so the same function guards the server's startup and the client's `/content`
 * response.
 *
 * The two revisions are an envelope around the payload and are never part of
 * either hash preimage -- see `packages/content/src/revisions.ts` for the
 * preimages themselves.
 */

import { z } from "zod";
import type { LapCount } from "../common/ids";
import { SEAT_COLOURS, type SeatColour } from "../common/seats";
import { TUNABLES, type ResolvedTuning, type TunableName } from "../common/tuning";
import {
  FLOW_EVENTS,
  PRESENTATION_ACTION_IDS,
  PRESENTATION_EVENT_NAMES,
  SCREEN_IDS,
  TRANSITION_STYLES,
  type PresentationConfig,
} from "./presentation";

/** A stable, opaque content identifier. Matches `^[a-z0-9-]+$`. */
export type ContentId = string & { readonly __brand: "ContentId" };

/** A lowercase hex SHA-256 digest naming one content or ruleset projection. */
export type RevisionHash = string & { readonly __brand: "RevisionHash" };

/**
 * Brand constructors, following `common/ids.ts`.
 *
 * Every snapshot fixture and revision assertion downstream needs them, and
 * they are the only sanctioned way to produce either brand.
 */
export const asContentId = (value: string): ContentId => value as ContentId;
export const asRevision = (value: string): RevisionHash => value as RevisionHash;

/**
 * A cosmetic body. The seat keeps its colour, so a character carries one sheet
 * and one portrait per seat colour rather than a colour of its own.
 */
export type CharacterContent = {
  readonly id: ContentId;
  readonly displayName: string;
  /** One sheet per seat colour: the body drawn in that seat's colour. */
  readonly sheetAliases: Readonly<Record<SeatColour, string>>;
  /** The neutral bust per seat colour; `Win` and `Lose` are this alias plus the mood. */
  readonly portraitAliases: Readonly<Record<SeatColour, string>>;
  /** The condition in `unlocks.toml` that earns it; absent when open or DLC. */
  readonly unlock?: ContentId | undefined;
};

/**
 * One page family in every grid. An item belongs to exactly one pack, and a
 * `dlc` pack is owned only through an entitlement.
 */
export type PackContent = {
  readonly id: ContentId;
  readonly title: string;
  readonly dlc: boolean;
  readonly stages: readonly ContentId[];
  readonly songs: readonly ContentId[];
  readonly characters: readonly ContentId[];
};

/** A condition an item can be earned by; its rule is code, its words are content. */
export type UnlockContent = {
  readonly id: ContentId;
  readonly hint: string;
  readonly goal: number;
};

/** The four readable phrases of an authored climb, in player order. */
export const PHRASE_NAMES = ["teach", "combine", "recover", "finish"] as const;
export type PhraseName = (typeof PHRASE_NAMES)[number];

/**
 * One named stretch of an authored climb.
 *
 * Review vocabulary. The bounds say which generated floors a phrase speaks
 * for; the purpose says what those floors are meant to ask of a player. Nothing
 * here reaches the simulation, which is why a phrase can be rewritten after a
 * playtest without moving `rulesetRevision` or the stage's `courseRevision`.
 */
export type CoursePhrase = {
  readonly name: PhraseName;
  /** Inclusive generated-floor index. Floor zero is the fixed starting seat. */
  readonly fromFloor: number;
  readonly toFloor: number;
  readonly purpose: string;
};

/**
 * A stretch above the four-phrase arc, for a longer mode (race-options spec
 * §4). Unnamed, so the arc and the city's sink stay the four phrases'.
 */
export type ExtensionPhrase = {
  readonly fromFloor: number;
  readonly toFloor: number;
  readonly purpose: string;
};

/**
 * A stage's frozen course.
 *
 * The seed selects one generation and is therefore a rules change; the phrases
 * annotate it and are not. Absent on a stage that leaves the course to the room.
 */
export type AuthoredCourse = {
  readonly seed: number;
  readonly phrases: readonly CoursePhrase[];
  /** Floors above the stage's own top, up to the tallest finite mode's. */
  readonly extension?: readonly ExtensionPhrase[] | undefined;
};

/**
 * The cosmetic settings a stage may author.
 *
 * Kept out of `rulesetRevision` deliberately, and out of the simulation, the
 * snapshots, the standings and the results: these change how the scenery looks
 * and nothing about how the race is decided. A room frozen on one revision
 * plays identically whichever of these it was authored with.
 *
 * The ranges are the renderer's, not a taste: `refractionIntensity` above 0.8
 * stops reading as scenery seen through air and starts reading as a filter over
 * the picture, and `horizonLift` above 48 logical units moves the skyline far
 * enough that the composition stops matching the art it was drawn from.
 */
export type StagePresentationContent = {
  readonly profile: "aquarian";
  /** Finite, 0..0.8. */
  readonly refractionIntensity: number;
  /** Finite, 0..48 logical units. */
  readonly horizonLift: number;
  /**
   * How far above the world origin the light (`lightAlias`) stands at the start
   * of the climb, finite, -200..600 logical units. Absent means -60: low behind
   * the rooftops. A night stage hangs its moon high.
   */
  readonly lightHeight?: number | undefined;
  /** Whether the light shimmers with heat. Absent means true; a moon sets false. */
  readonly lightShimmer?: boolean | undefined;
  /** Draws the racers and floors as black shapes (cosmetic). Absent means false. */
  readonly silhouette?: boolean | undefined;
  /** The city's ascent arc, per course phrase. Absent means the city holds. */
  readonly citySink?: StageCitySinkContent | undefined;
};

/**
 * The ascent arc: how far the city has fallen away below the climb by the end
 * of each course phrase, in logical units (finite, 0..720). The arc, not the
 * camera, carries the city (launch polish spec §2.8 item 11), so the finish
 * value is deep enough to take the near skyline out of frame.
 *
 * The city sinks between these values as the climb goes on, so the teach
 * phrase is among the rooftops and the finish is open sky. Cosmetic; it reads
 * the phrases' floor bounds and nothing that decides a race.
 */
export type StageCitySinkContent = Readonly<Record<PhraseName, number>>;

/** How a layer fills the width the camera can see beyond its own art. */
export type StageLayerExtend = "none" | "skirt" | "tile" | "plate";

/**
 * One scenery layer of a stage, back to front in `theme.layers`.
 *
 * Mirrors the authored shape validated by `stageLayersSchema` in
 * `packages/content/src/schema/stage.ts`, where each field is documented.
 *
 * `haze` is atmospheric depth: the share of the layer's texels stepped one
 * swatch toward the sky, in an ordered dither baked into the art. A dither
 * rather than a tint because every scenery pixel is folded onto the 64
 * swatches by the palette lock, and a smooth tint would either vanish into its
 * own swatch or jump a whole layer onto its neighbour's. Stippling a share of
 * the texels is how a limited palette draws "further away".
 */
export type StageLayerContent = {
  readonly alias: string;
  readonly plate: "sky" | "city";
  readonly depth: number;
  readonly sink: number;
  readonly haze?: number | undefined;
  readonly extend: StageLayerExtend;
  readonly arc?: number | undefined;
  readonly drift?: number | undefined;
};

export type StageContent = {
  readonly id: ContentId;
  readonly displayName: string;
  /** The unlock condition's ID, when the stage is earned by play. */
  readonly unlock?: ContentId | undefined;
  readonly platformAlias: string;
  /** Gameplay-affecting overrides, kept apart from the cosmetic theme. */
  readonly courseTuning: Readonly<Partial<ResolvedTuning>>;
  /**
   * Present when the stage freezes its course rather than letting a room draw
   * one. Spelled with an explicit `undefined` because `exactOptionalPropertyTypes`
   * makes "absent" and "present and undefined" different claims, and the decoder
   * below produces the second.
   */
  readonly course?: AuthoredCourse | undefined;
  readonly theme: {
    readonly backdropAlias: string;
    /** The sun, or the moon. Absent, the sky has no light of its own. */
    readonly lightAlias?: string | undefined;
    /** The wider still the select screen's preview pans (640 x 240). */
    readonly previewAlias?: string | undefined;
    /**
     * The scenery, back to front: the only description of what stands behind
     * the climb. The renderer skips a layer whose texture is missing -- a
     * missing picture costs its own layer and nothing else.
     */
    readonly layers: readonly StageLayerContent[];
    /** The bed under the race. Absent, Rooftops' (`bedForStage`). */
    readonly ambienceAlias?: string | undefined;
    /**
     * The cosmetic settings that select a presentation.
     *
     * Absent on every stage authored before this pass, which is what keeps the
     * legacy scenery recipe intact: no default is written into an old payload,
     * and the resolver supplies one at read time instead.
     */
    readonly presentation?: StagePresentationContent | undefined;
    /** The stage's set pieces across fifty floors, scaled to any race (Wonder spec §6.4). */
    readonly setPieces?: readonly SetPieceContent[] | undefined;
  };
};

/** The moods a palette shift steps toward. */
export const SET_PIECE_MOODS = ["sunset", "storm", "deepWater", "aurora", "night", "dawn", "day", "bright"] as const;
export type SetPieceMood = (typeof SET_PIECE_MOODS)[number];

/** One set piece: a code-owned kind, placed on the fifty-floor arc (Wonder spec §6.4). */
export type SetPieceContent =
  | { readonly floor: number; readonly kind: "lightsOut"; readonly holdMs: number; readonly invert?: boolean | undefined }
  | { readonly floor: number; readonly kind: "paletteShift"; readonly holdMs: number; readonly mood: SetPieceMood; readonly stay?: boolean | undefined }
  | {
      readonly floor: number;
      readonly kind: "weatherBurst";
      readonly holdMs: number;
      readonly particle: "snow" | "rain" | "bubble";
      readonly density: number;
      readonly layers?: readonly string[] | undefined;
    }
  | {
      readonly floor: number;
      readonly kind: "skyFlash";
      readonly holdMs: number;
      readonly flashes: number;
      readonly tone: "lightning" | "aurora";
      readonly kick?: number | undefined;
    }
  | { readonly floor: number; readonly kind: "swarm"; readonly holdMs: number; readonly layers: readonly string[]; readonly speed: number };

export type SongContent = {
  readonly id: ContentId;
  readonly displayName: string;
  readonly bpm: number;
  readonly beatOffsetTicks: number;
  readonly loopStartMs: number;
  readonly loopEndMs: number;
  /** The stretch the song step previews and the unlock banner plays; both or neither. */
  readonly previewStartMs?: number | undefined;
  readonly previewEndMs?: number | undefined;
  /** The stretch the results screen plays once; both or neither. */
  readonly resultsStartMs?: number | undefined;
  readonly resultsEndMs?: number | undefined;
  readonly audioAlias: string;
  /** The jukebox cover at 192 px; plus `Large` is the 640 px one, plus `Full` the reveal's 1200 px one. */
  readonly coverAlias?: string | undefined;
  /** The condition in `unlocks.toml` that earns it; absent when open. */
  readonly unlock?: ContentId | undefined;
};

/** How a mode's course is built (race-options spec §3.1). Code-owned, as screens and events are. */
export const MODE_COURSES = ["finite", "endless"] as const;
export type ModeCourse = (typeof MODE_COURSES)[number];

export type ModeContent = {
  readonly id: ContentId;
  readonly displayName: string;
  /** A finite course ends at its top floor; an endless one on its clock. */
  readonly course: ModeCourse;
  /** The lap counts the ready room offers, in order. */
  readonly laps: readonly LapCount[];
  /** The clock lengths the ready room offers, in seconds, in order; an endless mode only (survival spec §5). */
  readonly clocks?: readonly number[] | undefined;
  readonly tuning: Readonly<Partial<ResolvedTuning>>;
};

/** A move's prompt, worded for the input method the player is holding. */
export type ControlPrompt = {
  readonly keyboard: string;
  /** May name `{glyph}`, where the pad's own button goes. */
  readonly gamepad: string;
  /** Worded for swipe steering. */
  readonly touch: string;
  /** Worded for the on-screen buttons. */
  readonly buttons: string;
};

/** The prompts the Instructions name: only `move` and `fastFall` have a control to name. */
export type ControlPrompts = { readonly move: ControlPrompt; readonly fastFall: ControlPrompt };

/** A spring's constants (Wonder spec §4.2): frequency, damping, response. */
export type SpringTuning = { readonly f: number; readonly zeta: number; readonly r: number };

/** A squash: a knock on the squash spring, x out and y in by `amount` (Wonder spec §4.2). */
export type SquashSpec = { readonly amount: number };

/** A puff, ring or burst of pooled dust, in logical units and milliseconds. */
export type DustSpec = {
  readonly count: number;
  readonly spread: number;
  readonly rise: number;
  readonly lifeMs: number;
  readonly ring?: boolean | undefined;
  /** Sparks thrown with the dust (Wonder spec §4.3). */
  readonly sparks?: number | undefined;
};

/**
 * Racer juice, authored in `content/juice.toml` (polish spec §4.1). It is
 * presentation only: it moves `contentRevision` and nothing reads it into a race.
 */
export type JuiceTuning = {
  readonly limits: { readonly particles: number };
  /** Every game-world motion's spring (Wonder spec §4.2). */
  readonly springs: {
    readonly squash: SpringTuning;
    readonly lean: SpringTuning;
    readonly kick: SpringTuning;
    readonly word: SpringTuning;
    readonly jolt: SpringTuning;
    readonly hudPop: SpringTuning;
  };
  /** Racers lean into their motion (Wonder spec §4.1). */
  readonly lean: { readonly maxDeg: number; readonly fullSpeed: number; readonly stepDeg: number };
  readonly bounce: { readonly squash: SquashSpec; readonly dust: DustSpec };
  readonly slam: {
    readonly threshold: number;
    readonly squash: SquashSpec;
    readonly dust: DustSpec;
    readonly cameraKick: { readonly units: number; readonly ms: number };
    readonly hitStopMs: number;
  };
  readonly collect: { readonly hudPop: { readonly scale: number }; readonly dust: DustSpec };
  readonly wrap: { readonly streak: { readonly frames: number }; readonly sparks: number };
  readonly burst: { readonly spawn: { readonly dust: DustSpec }; readonly finish: { readonly dust: DustSpec } };
  /** The pop-up words (Wonder spec §5). */
  readonly words: WordsTuning;
  /** Per-stage palette overrides: a stage whose floor face swallows the default dust swatch. */
  readonly palette: { readonly stages: Readonly<Record<string, { readonly dust: string }>> };
  /** Shake, punch, impact frames, the fast-fall's lines, look-ahead and the aberration pulse. */
  readonly feel: FeelTuning;
};

/**
 * The feel layer (A/V polish plan): every number a share of full, a world
 * unit or a millisecond. Trauma is 0 to 1; each source adds to it.
 */
export type FeelTuning = {
  readonly shake: {
    /** The most a full-trauma shake moves the picture, in world units. */
    readonly maxUnits: number;
    /** Trauma lost each second. */
    readonly decayPerSecond: number;
    /** How fast the shake jitters. */
    readonly hz: number;
    /** Trauma each moment adds. */
    readonly slam: number;
    readonly fall: number;
    readonly finish: number;
    readonly rivalSlam: number;
  };
  /** The zoom's punch in, as a share of the zoom, on its spring. */
  readonly punch: { readonly slam: number; readonly finish: number; readonly spring: SpringTuning };
  /** The flat flash over the field: how long, how strong, and the least time between two. */
  readonly impact: { readonly ms: number; readonly alpha: number; readonly slam: number; readonly gapMs: number };
  /** The fast-fall's speed lines and afterimages, from `from` of the fast-fall speed. */
  readonly fall: {
    readonly from: number;
    readonly lines: number;
    readonly alpha: number;
    readonly afterimages: number;
    readonly afterimageAlpha: number;
  };
  /** How far the camera leads a fast fall: seconds of the fall, at most `maxUnits`. */
  readonly lookAhead: { readonly seconds: number; readonly maxUnits: number };
  /** The LCD panel's aberration, raised by `peak` and let back over `ms`. */
  readonly aberration: { readonly peak: number; readonly ms: number };
};

/** The pop-up words' size, motion, caps and timing (Wonder spec §5). */
export type WordsTuning = {
  readonly lifeMs: number;
  readonly popScale: number;
  readonly riseUnits: number;
  /** The local racer's words, in world units. */
  readonly size: number;
  /** Race beats, in the middle of the view. */
  readonly beatSize: number;
  readonly rivalScale: number;
  readonly rivalAlpha: number;
  readonly skewDeg: number;
  readonly outline: number;
  readonly localCap: number;
  readonly beatCap: number;
  readonly repeatGapMs: number;
  readonly backWithinMs: number;
  readonly streakFrom: number;
  readonly niceFrom: number;
  readonly greatFrom: number;
};

export type GameContentPayload = {
  readonly baseTuning: ResolvedTuning;
  readonly presentation: PresentationConfig;
  /** The catalog's packs, in page order. The flat lists below follow pack order. */
  readonly packs: readonly PackContent[];
  readonly unlocks: readonly UnlockContent[];
  /** Words a typed name may not contain in a public room; the server reads it. */
  readonly blockedNames: readonly string[];
  readonly characters: readonly CharacterContent[];
  readonly stages: readonly StageContent[];
  readonly songs: readonly SongContent[];
  readonly modes: readonly ModeContent[];
  readonly prompts: ControlPrompts;
  readonly juice: JuiceTuning;
};

export type GameContent = {
  readonly schemaVersion: 1;
  readonly contentRevision: RevisionHash;
  readonly rulesetRevision: RevisionHash;
  /** One per catalogued stage: its seed and course tuning over base tuning. */
  readonly courseRevisions: Readonly<Record<string, RevisionHash>>;
  readonly content: GameContentPayload;
};

/** Every way authored or generated content can be refused. */
export type ContentResultCode =
  | "unknownField"
  | "missingField"
  | "invalidType"
  | "outOfRange"
  | "duplicateId"
  | "duplicateCatalogEntry"
  | "unknownReference"
  | "wrongKind"
  | "invalidBeatMetadata"
  | "invalidCourse"
  | "invalidMode"
  | "unknownAssetAlias"
  | "missingStill"
  | "invariantNotAuthorable"
  | "invalidFlow"
  | "invalidEventRoute"
  | "staleArtifact"
  | "invalidArtifact";

/** The decoded shape of a set piece. Ranges belong to the authored schema; this only checks shape. */
const setPieceArtifact = z.discriminatedUnion("kind", [
  z.object({ floor: z.number(), holdMs: z.number(), kind: z.literal("lightsOut"), invert: z.boolean().optional() }).strict(),
  z
    .object({ floor: z.number(), holdMs: z.number(), kind: z.literal("paletteShift"), mood: z.enum(SET_PIECE_MOODS), stay: z.boolean().optional() })
    .strict(),
  z
    .object({
      floor: z.number(),
      holdMs: z.number(),
      kind: z.literal("weatherBurst"),
      particle: z.enum(["snow", "rain", "bubble"]),
      density: z.number(),
      layers: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      floor: z.number(),
      holdMs: z.number(),
      kind: z.literal("skyFlash"),
      flashes: z.number(),
      tone: z.enum(["lightning", "aurora"]),
      kick: z.number().optional(),
    })
    .strict(),
  z.object({ floor: z.number(), holdMs: z.number(), kind: z.literal("swarm"), layers: z.array(z.string()), speed: z.number() }).strict(),
]);

/** The decoded shape of `juice`. Ranges belong to the authored schema; this only checks shape. */
const squashArtifact = z.object({ amount: z.number() }).strict();
const springArtifact = z.object({ f: z.number(), zeta: z.number(), r: z.number() }).strict();
const dustArtifact = z
  .object({
    count: z.number(),
    spread: z.number(),
    rise: z.number(),
    lifeMs: z.number(),
    ring: z.boolean().optional(),
    sparks: z.number().optional(),
  })
  .strict();
const juiceArtifact = z
  .object({
    limits: z.object({ particles: z.number() }).strict(),
    springs: z
      .object({
        squash: springArtifact,
        lean: springArtifact,
        kick: springArtifact,
        word: springArtifact,
        jolt: springArtifact,
        hudPop: springArtifact,
      })
      .strict(),
    lean: z.object({ maxDeg: z.number(), fullSpeed: z.number(), stepDeg: z.number() }).strict(),
    bounce: z.object({ squash: squashArtifact, dust: dustArtifact }).strict(),
    slam: z
      .object({
        threshold: z.number(),
        squash: squashArtifact,
        dust: dustArtifact,
        cameraKick: z.object({ units: z.number(), ms: z.number() }).strict(),
        hitStopMs: z.number(),
      })
      .strict(),
    collect: z.object({ hudPop: z.object({ scale: z.number() }).strict(), dust: dustArtifact }).strict(),
    wrap: z.object({ streak: z.object({ frames: z.number() }).strict(), sparks: z.number() }).strict(),
    burst: z
      .object({ spawn: z.object({ dust: dustArtifact }).strict(), finish: z.object({ dust: dustArtifact }).strict() })
      .strict(),
    words: z
      .object({
        lifeMs: z.number(),
        popScale: z.number(),
        riseUnits: z.number(),
        size: z.number(),
        beatSize: z.number(),
        rivalScale: z.number(),
        rivalAlpha: z.number(),
        skewDeg: z.number(),
        outline: z.number(),
        localCap: z.number(),
        beatCap: z.number(),
        repeatGapMs: z.number(),
        backWithinMs: z.number(),
        streakFrom: z.number(),
        niceFrom: z.number(),
        greatFrom: z.number(),
      })
      .strict(),
    palette: z.object({ stages: z.record(z.string(), z.object({ dust: z.string().min(1) }).strict()) }).strict(),
    feel: z
      .object({
        shake: z
          .object({
            maxUnits: z.number(),
            decayPerSecond: z.number(),
            hz: z.number(),
            slam: z.number(),
            fall: z.number(),
            finish: z.number(),
            rivalSlam: z.number(),
          })
          .strict(),
        punch: z.object({ slam: z.number(), finish: z.number(), spring: springArtifact }).strict(),
        impact: z.object({ ms: z.number(), alpha: z.number(), slam: z.number(), gapMs: z.number() }).strict(),
        fall: z
          .object({ from: z.number(), lines: z.number(), alpha: z.number(), afterimages: z.number(), afterimageAlpha: z.number() })
          .strict(),
        lookAhead: z.object({ seconds: z.number(), maxUnits: z.number() }).strict(),
        aberration: z.object({ peak: z.number(), ms: z.number() }).strict(),
      })
      .strict(),
  })
  .strict();

const contentId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .transform(asContentId);

const revision = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform(asRevision);

const alias = z.string().min(1);

/**
 * Every tunable, all required.
 *
 * Built from the declarations rather than restated, so a new tunable is part
 * of the contract the moment it is declared.
 */
const baseTuning = z
  .object(
    Object.fromEntries(
      (Object.keys(TUNABLES) as readonly TunableName[]).map((name) => [
        name,
        z.number().finite(),
      ]),
    ) as Record<TunableName, z.ZodNumber>,
  )
  .strict();

/** A partial override layer. Unknown names are a rejection, never a no-op. */
const partialTuning = z
  .record(z.string(), z.number().finite())
  .refine((value) => Object.keys(value).every((name) => name in TUNABLES), {
    message: "unknown tunable",
  });

const flow = z
  .object({
    entry: z.enum(SCREEN_IDS),
    transitions: z.array(
      z
        .object({
          from: z.enum(SCREEN_IDS),
          event: z.enum(FLOW_EVENTS),
          to: z.enum(SCREEN_IDS),
          transition: z.enum(TRANSITION_STYLES).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const routing = z
  .object({
    routes: z.array(
      z
        .object({
          source: z.enum(PRESENTATION_EVENT_NAMES),
          order: z.number().int().min(0).max(65_535),
          action: z.enum(PRESENTATION_ACTION_IDS),
        })
        .strict(),
    ),
  })
  .strict();

const controlPromptArtifact = z
  .object({ keyboard: z.string().min(1), gamepad: z.string().min(1), touch: z.string().min(1), buttons: z.string().min(1) })
  .strict();

/** One stage, as the payload carries it. */
const stageArtifact = z
  .object({
    id: contentId,
    displayName: z.string().min(1),
    unlock: contentId.optional(),
    platformAlias: alias,
    courseTuning: partialTuning,
    course: z
      .object({
        seed: z.number().int().min(0),
        phrases: z.array(
          z
            .object({
              name: z.enum(PHRASE_NAMES),
              fromFloor: z.number().int().min(1),
              toFloor: z.number().int().min(1),
              purpose: z.string().min(1),
            })
            .strict(),
        ),
        extension: z
          .array(
            z
              .object({
                fromFloor: z.number().int().min(1),
                toFloor: z.number().int().min(1),
                purpose: z.string().min(1),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    theme: z
      .object({
        backdropAlias: alias,
        // Strict, bounded and finite. `z.number()` already rejects NaN;
        // `.finite()` is what rejects Infinity, which JSON cannot even
        // carry and a hand-edited artifact can.
        lightAlias: alias.optional(),
        previewAlias: alias.optional(),
        // The artifact is compiled from validated content, so this bounds shape
        // and range and leaves the ordering rules to the compiler.
        layers: z
          .array(
            z
              .object({
                alias,
                plate: z.enum(["sky", "city"]),
                depth: z.number().finite().min(0).max(1),
                sink: z.number().finite().min(-720).max(1440),
                haze: z.number().finite().min(0).max(1).optional(),
                extend: z.enum(["none", "skirt", "tile", "plate"]),
                arc: z.number().finite().min(0).max(2).optional(),
                drift: z.number().finite().min(0).max(3).optional(),
              })
              .strict(),
          )
          .min(1),
        ambienceAlias: alias.optional(),
        setPieces: z.array(setPieceArtifact),
        presentation: z
          .object({
            profile: z.literal("aquarian"),
            refractionIntensity: z.number().finite().min(0).max(0.8),
            horizonLift: z.number().finite().min(0).max(48),
            lightHeight: z.number().finite().min(-200).max(600).optional(),
            lightShimmer: z.boolean().optional(),
            silhouette: z.boolean().optional(),
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
      })
      .strict(),
  })
  .strict();

/** One song, as the payload carries it. */
const songArtifact = z
  .object({
    id: contentId,
    displayName: z.string().min(1),
    bpm: z.number().finite().positive(),
    beatOffsetTicks: z.number().int().min(0),
    loopStartMs: z.number().int().min(0),
    loopEndMs: z.number().int().positive(),
    previewStartMs: z.number().int().min(0).optional(),
    previewEndMs: z.number().int().positive().optional(),
    resultsStartMs: z.number().int().min(0).optional(),
    resultsEndMs: z.number().int().positive().optional(),
    audioAlias: alias,
    coverAlias: alias.optional(),
    unlock: contentId.optional(),
  })
  .strict();

const artifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentRevision: revision,
    rulesetRevision: revision,
    courseRevisions: z.record(z.string(), revision),
    content: z
      .object({
        baseTuning,
        presentation: z.object({ flow, routing }).strict(),
        packs: z.array(
          z
            .object({
              id: contentId,
              title: z.string().min(1),
              dlc: z.boolean(),
              stages: z.array(contentId),
              songs: z.array(contentId),
              characters: z.array(contentId),
            })
            .strict(),
        ),
        unlocks: z.array(
          z.object({ id: contentId, hint: z.string().min(1), goal: z.number().int().positive() }).strict(),
        ),
        blockedNames: z.array(z.string().min(1)),
        characters: z.array(
          z
            .object({
              id: contentId,
              displayName: z.string().min(1),
              unlock: contentId.optional(),
              sheetAliases: z.record(z.enum(SEAT_COLOURS), alias),
              portraitAliases: z.record(z.enum(SEAT_COLOURS), alias),
            })
            .strict(),
        ),
        stages: z.array(stageArtifact),
        songs: z.array(songArtifact),
        modes: z.array(
          z
            .object({
              id: contentId,
              displayName: z.string().min(1),
              course: z.enum(MODE_COURSES),
              laps: z.array(z.union([z.literal(1), z.literal(3)])).min(1),
              clocks: z.array(z.number().int().positive()).min(1).optional(),
              tuning: partialTuning,
            })
            .strict(),
        ),
        prompts: z.object({ move: controlPromptArtifact, fastFall: controlPromptArtifact }).strict(),
        juice: juiceArtifact,
      })
      .strict(),
  })
  .strict();

/** Raised when a value is not a generated artifact this build understands. */
export class GameContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameContentError";
  }
}

/**
 * Decodes an untrusted artifact, reporting the first problem in full.
 *
 * It never recomputes a hash: proving that the revisions describe the payload
 * is `verifyArtifact`'s job in the compiler, and nothing at runtime is in a
 * position to do it.
 */
export function parseGameContentArtifact(value: unknown): GameContent {
  const result = artifactSchema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join(".") ?? "artifact";
  throw new GameContentError(`${path}: ${issue?.message ?? "invalid generated content"}`);
}
