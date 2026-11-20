/**
 * The interactive tutorial (launch polish §3.1.4).
 *
 * Shape and order only. Whether the authored course lets every step complete
 * is proved by the probe in `tests/shared/level/tutorial.test.ts`, which plays
 * it: a schema cannot know where the moving floors fall.
 */

import { z } from "zod";
import { TUTORIAL_STEP_KINDS } from "@floor-fifty/shared/level/tutorial";

const prompt = z.string().min(1).max(140);

/** Where a controller prompt names its button: the client puts the pad's own glyph there. */
export const GLYPH_SLOT = "{glyph}";
const noSlot = prompt.refine((text) => !text.includes(GLYPH_SLOT), {
  message: `only a gamepad prompt may name ${GLYPH_SLOT}`,
});

/** `tutorial.toml` as authored: the payload's `TutorialContent` resolves `stageId` and `songId`. */
export type AuthoredTutorial = z.infer<typeof tutorialSchema>;

export const tutorialSchema = z
  .object({
    seed: z.number().int().min(0).max(2_147_483_647),
    // The shortest course is 20 floors (COURSE_FLOOR_COUNT's minimum), so 19 always exists.
    targetFloor: z.number().int().min(2).max(19),
    // The stage the tutorial is played on. Uncatalogued: validation finds it
    // among every stage file, and `buildPayload` emits it inside the tutorial.
    stageId: z.string().regex(/^[a-z0-9-]+$/),
    // The song the tutorial plays. Uncatalogued too: validation finds it among
    // every song file, and refuses one a pack lists.
    songId: z.string().regex(/^[a-z0-9-]+$/),
    steps: z
      .array(
        z
          .object({
            kind: z.enum(TUTORIAL_STEP_KINDS),
            // `touch` is the swipe wording; `buttons`, where the steps differ,
            // is for a player who chose the on-screen buttons instead.
            prompt: z.object({ keyboard: noSlot, gamepad: prompt, touch: noSlot, buttons: noSlot.optional() }).strict(),
          })
          .strict(),
      )
      .min(1)
      .max(TUTORIAL_STEP_KINDS.length),
  })
  .strict()
  .superRefine((value, context) => {
    const kinds = value.steps.map((step) => step.kind);
    if (new Set(kinds).size !== kinds.length)
      context.addIssue({ code: "custom", path: ["steps"], message: "each step kind may appear once" });
    if (kinds.includes("survive") && kinds.at(-1) !== "survive")
      context.addIssue({ code: "custom", path: ["steps"], message: "survive must be the last step" });
  });
