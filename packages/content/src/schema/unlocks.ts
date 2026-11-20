import { z } from "zod";
import { asContentId } from "@floor-fifty/shared/content/game-content";
import { isConditionId } from "@floor-fifty/shared/unlocks/conditions";
import { contentIdSchema } from "./id";

export const UNLOCK_HINT_MAX_LENGTH = 32;

/**
 * The conditions an item can be earned by; each tile shows its `hint` while
 * locked. An ID with no predicate could never be met, so it is refused here
 * (unlockables spec §4.1).
 */
export const unlocksSchema = z
  .object({
    unlocks: z.array(
      z
        .object({
          id: contentIdSchema
            .refine(isConditionId, "no predicate judges this condition; add it to packages/shared/src/unlocks/conditions.ts")
            .transform(asContentId),
          hint: z.string().min(1).max(UNLOCK_HINT_MAX_LENGTH),
          goal: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
