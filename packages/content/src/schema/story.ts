/**
 * The story: "Don't Look Down" (story mode v2 spec, "Content format").
 *
 * Five chapters, each on an existing stage and song, with the two who climb
 * beside you, the cutscenes between them and the ending. Shape, order and the
 * rules one file can see live here; whether a stage, song, speaker or picture
 * exists is `validate/references.ts` and `validate/aliases.ts`, and whether a
 * chapter's course holds its lamps and safe spots still is proved by
 * `tests/client/features/story/seeds.test.ts`: a schema cannot know where the
 * moving floors fall.
 */

import { z } from "zod";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { STORY_MOODS, STORY_PLAIN_WHENS, STORY_TEACHES } from "@floor-fifty/shared/content/game-content";

/** Where a controller prompt names its button: the client puts the pad's own glyph there. */
export const GLYPH_SLOT = "{glyph}";

/** The course is 20 floors (`COURSE_FLOOR_COUNT`): floor 19 is its top. */
export const STORY_TOP_FLOOR = 19;
/** No actor may climb above this, so none ever finishes the course (spec, "Actors"). */
export const STORY_CEILING_MAX = STORY_TOP_FLOOR - 3;

const idPattern = /^[a-z0-9-]+$/;
const id = z.string().regex(idPattern);
const floor = z.number().int().min(0).max(STORY_TOP_FLOOR);

const promptText = z.string().min(1).max(140);
const noSlot = promptText.refine((text) => !text.includes(GLYPH_SLOT), {
  message: `only a gamepad prompt may name ${GLYPH_SLOT}`,
});
const promptSchema = z
  .object({ keyboard: noSlot, gamepad: promptText, touch: noSlot, buttons: noSlot })
  .strict();

const lineSchema = z
  .object({
    // `you` is the player's own racer; any other speaker is an actor's id, checked in validation; none is the narrator.
    speaker: id.optional(),
    mood: z.enum(STORY_MOODS).optional(),
    text: z.string().min(1).max(80),
  })
  .strict();
const linesSchema = z.array(lineSchema).min(1).max(5);

const actorSchema = z
  .object({
    characterId: id,
    colour: z.enum(SEAT_COLOURS),
    // A CPU personality's knobs, without `name` (the character's own) or `bands` (a story actor never bands).
    personality: z
      .object({
        reactionTicks: z.number().int().min(0).max(12),
        linedUpFraction: z.number().min(0).max(1),
        slipChance: z.number().min(0).max(1),
        slipTicks: z.number().int().min(0).max(120),
        movingFloorPause: z.number().int().min(0).max(240),
        stallTicks: z.number().int().min(60).max(3600),
        eagerDrop: z.number().min(0).max(1),
        leadEase: z.number().min(0).max(1),
        easeTicks: z.number().int().min(0).max(240),
      })
      .strict(),
  })
  .strict();

const panelSchema = z
  .object({
    // A `story.*` image in the art manifest, checked in validation.
    art: z.string().regex(/^story\.[A-Za-z0-9]+$/),
    move: z
      .object({ kind: z.enum(["push", "pan"]), from: z.number().min(0).max(1.25), to: z.number().min(0).max(1.25) })
      .strict(),
    // The glims the player carried rise over this panel.
    glims: z.boolean().optional(),
    lines: linesSchema,
  })
  .strict();

const cutsceneSchema = z
  .object({
    id,
    title: z.string().min(1).max(40),
    // An audio alias: an ambience or a song's track, checked in validation.
    bed: z.string().regex(/^[a-z]+\.[A-Za-z0-9]+$/),
    panels: z.array(panelSchema).min(1).max(6),
  })
  .strict();

const goalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reach"), floor, lamps: z.number().int().min(1).optional() }).strict(),
  z.object({ kind: z.literal("rescue"), actor: id }).strict(),
]);

const lavaSchema = z
  .object({
    // Under the player, or under the actor the player is diving to.
    under: z.enum(["player", "actor"]),
    startBelow: z.number().min(0).max(1200),
    rise: z.number().min(0).max(60),
    // Ticks before the lava moves at all.
    grace: z.number().int().min(0).max(600),
  })
  .strict();

const phaseSchema = z
  .object({
    id,
    goal: goalSchema,
    lava: lavaSchema.optional(),
    wind: z.number().min(0).max(120).optional(),
    safeSpots: z.array(floor).max(6).optional(),
  })
  .strict();

const whenSchema = z.union([
  z.object({ kind: z.enum(STORY_PLAIN_WHENS) }).strict(),
  z.object({ kind: z.literal("floor"), floor }).strict(),
  z.object({ kind: z.literal("phase"), phase: id }).strict(),
]);

const actionSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("quake"), strength: z.number().min(0).max(1) }).strict(),
  z.object({ do: z.literal("drop"), actor: id, floors: z.number().int().min(1).max(5) }).strict(),
  z.object({ do: z.literal("place"), actor: id, floor, parked: z.boolean() }).strict(),
  z.object({ do: z.literal("lookAt"), actor: id, ticks: z.number().int().min(1).max(600) }).strict(),
  z.object({ do: z.literal("ceiling"), actor: id, floor }).strict(),
  z.object({ do: z.literal("leash"), actor: id, on: z.boolean() }).strict(),
  z.object({ do: z.literal("unpark"), actor: id }).strict(),
]);

const momentSchema = z
  .object({
    when: whenSchema,
    do: z.array(actionSchema).min(1).max(6).optional(),
    lines: linesSchema.optional(),
  })
  .strict()
  .refine((moment) => moment.do !== undefined || moment.lines !== undefined, {
    message: "a moment says something, does something, or both",
  });

const chapterActorSchema = z
  .object({
    id,
    ceiling: floor,
    leash: z.boolean(),
    // Where it starts: on the player's floor unless it says.
    floor: floor.optional(),
    // How many floors above the player a leash lets it stay, beyond the usual.
    ahead: z.number().int().min(0).max(4).optional(),
    parked: z.boolean().optional(),
  })
  .strict();

const chapterSchema = z
  .object({
    id,
    title: z.string().min(1).max(40),
    stageId: id,
    songId: id,
    // A course from this seed on base tuning; the seeds test proves its floors.
    seed: z.number().int().min(0).max(2_147_483_647),
    // What the HUD adds to a floor: the tower's floor, not the course's.
    floorOffset: z.number().int().min(0).max(50),
    parSeconds: z.number().int().min(10).max(600),
    // The cutscene before the chapter.
    before: id,
    startFloor: floor,
    teaches: z.array(z.enum(STORY_TEACHES)).max(2),
    lamps: z.array(floor).max(6).optional(),
    actors: z.array(chapterActorSchema).max(2),
    glims: z
      .array(z.object({ floor, offset: z.number().int().min(-180).max(180) }).strict())
      .max(12)
      .optional(),
    phases: z.array(phaseSchema).min(1).max(4),
    moments: z.array(momentSchema).min(1).max(16),
  })
  .strict();

/** `story.toml` as authored: the payload's `StoryContent` resolves each chapter's `stageId` and `songId`. */
export type AuthoredStory = z.infer<typeof storySchema>;

type Issue = { readonly path: (string | number)[]; readonly message: string };

/** The rules inside one chapter: everything it names is its own, and on its course. */
function chapterIssues(chapter: z.infer<typeof chapterSchema>, actorIds: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const own = new Set(chapter.actors.map((actor) => actor.id));
  const phases = new Set(chapter.phases.map((phase) => phase.id));
  const known = (path: (string | number)[], actor: string) => {
    if (!own.has(actor)) issues.push({ path, message: `${actor} is not one of this chapter's actors` });
  };

  chapter.actors.forEach((actor, index) => {
    if (!actorIds.has(actor.id)) issues.push({ path: ["actors", index, "id"], message: `no actor ${actor.id} in [actors]` });
    if (actor.ceiling > STORY_CEILING_MAX)
      issues.push({ path: ["actors", index, "ceiling"], message: `a ceiling above floor ${STORY_CEILING_MAX} lets an actor finish the course` });
  });
  if (own.size !== chapter.actors.length) issues.push({ path: ["actors"], message: "an actor is listed twice" });
  if (phases.size !== chapter.phases.length) issues.push({ path: ["phases"], message: "phase ids must be unique" });

  // Where each actor is put below the player, by its own `floor` and `parked` or by a `place`.
  const placed = new Set(chapter.actors.filter((actor) => actor.parked === true).map((actor) => actor.id));
  chapter.moments.forEach((moment, index) => {
    const { when } = moment;
    if (when.kind === "phase" && "phase" in when && !phases.has(when.phase))
      issues.push({ path: ["moments", index, "when", "phase"], message: `no phase ${when.phase} in this chapter` });
    moment.do?.forEach((action, actionIndex) => {
      if ("actor" in action) known(["moments", index, "do", actionIndex, "actor"], action.actor);
      if (action.do === "place" && action.parked) placed.add(action.actor);
    });
    moment.lines?.forEach((line, lineIndex) => {
      if (line.speaker !== undefined && line.speaker !== "you" && !actorIds.has(line.speaker))
        issues.push({ path: ["moments", index, "lines", lineIndex, "speaker"], message: `no actor ${line.speaker} to speak` });
    });
  });

  chapter.phases.forEach((phase, index) => {
    if (phase.goal.kind === "rescue") {
      known(["phases", index, "goal", "actor"], phase.goal.actor);
      if (!placed.has(phase.goal.actor))
        issues.push({ path: ["phases", index, "goal"], message: `a rescue needs ${phase.goal.actor} put below the player, parked` });
    }
    if (phase.lava !== undefined && (phase.safeSpots ?? []).length === 0)
      issues.push({ path: ["phases", index, "safeSpots"], message: "a phase with lava needs a safe spot to come back to" });
    if (phase.goal.kind === "reach" && phase.goal.lamps !== undefined && phase.goal.lamps > (chapter.lamps ?? []).length)
      issues.push({ path: ["phases", index, "goal", "lamps"], message: "the goal asks for more lamps than the chapter has" });
  });

  const reach = chapter.phases.flatMap((phase) => (phase.goal.kind === "reach" ? [phase.goal.floor] : []));
  const top = Math.max(chapter.startFloor, ...reach);
  (chapter.lamps ?? []).forEach((lamp, index) => {
    if (lamp >= top) issues.push({ path: ["lamps", index], message: `a lamp must be below the chapter's goal floor (${top})` });
  });
  (chapter.glims ?? []).forEach((glim, index) => {
    if (glim.floor > top) issues.push({ path: ["glims", index, "floor"], message: `a glim must be at or below the chapter's goal floor (${top})` });
  });
  return issues;
}

export const storySchema = z
  .object({
    prompts: z.object({ move: promptSchema, fastFall: promptSchema }).strict(),
    actors: z.record(id, actorSchema),
    cutscenes: z.array(cutsceneSchema).min(1).max(8),
    ending: z
      .object({ cutscene: id, thesis: z.array(z.string().min(1).max(80)).min(1).max(3), last: lineSchema })
      .strict(),
    chapters: z.array(chapterSchema).min(1).max(6),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
    const actorIds = new Set(Object.keys(value.actors));
    const cutscenes = new Set(value.cutscenes.map((cutscene) => cutscene.id));

    const ids = value.chapters.map((chapter) => chapter.id);
    if (new Set(ids).size !== ids.length) issue(["chapters"], "chapter ids must be unique");
    if (cutscenes.size !== value.cutscenes.length) issue(["cutscenes"], "cutscene ids must be unique");
    if (!cutscenes.has(value.ending.cutscene)) issue(["ending", "cutscene"], `no cutscene ${value.ending.cutscene}`);

    const speaker = (path: (string | number)[], name: string | undefined) => {
      if (name !== undefined && name !== "you" && !actorIds.has(name)) issue(path, `no actor ${name} to speak`);
    };
    value.cutscenes.forEach((cutscene, index) =>
      cutscene.panels.forEach((panel, panelIndex) =>
        panel.lines.forEach((line, lineIndex) => speaker(["cutscenes", index, "panels", panelIndex, "lines", lineIndex, "speaker"], line.speaker)),
      ),
    );
    speaker(["ending", "last", "speaker"], value.ending.last.speaker);

    // The hub counts the glims from these chapters, so its total cannot differ from theirs.
    value.chapters.forEach((chapter, index) => {
      if (!cutscenes.has(chapter.before)) issue(["chapters", index, "before"], `no cutscene ${chapter.before}`);
      for (const found of chapterIssues(chapter, actorIds)) issue(["chapters", index, ...found.path], found.message);
    });
  });
