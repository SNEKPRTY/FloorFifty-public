/**
 * A mode file.
 *
 * A mode is a race option the host picks in the ready room (race-options spec
 * §3): its course, the lap counts it offers, and the last tuning layer, over
 * base and the stage's. Whether a course and its clock agree is a join with
 * the resolved tuning, so `validate/modes.ts` checks it, not this schema.
 */

import { z } from "zod";
import { asContentId, MODE_COURSES } from "@floor-fifty/shared/content/game-content";
import { contentIdSchema } from "./catalog";
import { DISPLAY_NAME_MAX_LENGTH } from "./character";
import { tuningMapSchema } from "./tuning";

export const modeSchema = z
  .object({
    id: contentIdSchema.transform(asContentId),
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    course: z.enum(MODE_COURSES),
    laps: z
      .array(z.union([z.literal(1), z.literal(3)]))
      .min(1)
      .refine((laps) => new Set(laps).size === laps.length, "must not repeat a lap count"),
    // Survival's clock lengths, in seconds (survival spec §5); 600 keeps within RACE_TIME_LIMIT_TICKS.
    clocks: z
      .array(z.number().int().min(10).max(600))
      .min(1)
      .refine((clocks) => new Set(clocks).size === clocks.length, "must not repeat a clock")
      .optional(),
    tuning: tuningMapSchema,
  })
  .strict();
