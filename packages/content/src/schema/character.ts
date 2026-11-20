/**
 * A character file: a cosmetic body, recoloured per seat.
 *
 * Every field is cosmetic. A character decides nothing about a race, which is
 * why adding one changes `contentRevision` and leaves `rulesetRevision` alone.
 */

import { z } from "zod";
import { asContentId } from "@floor-fifty/shared/content/game-content";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { contentIdSchema } from "./catalog";

export const DISPLAY_NAME_MAX_LENGTH = 48;

/** One alias per seat colour: a body is recoloured for every seat. */
const perSeat = z
  .object(Object.fromEntries(SEAT_COLOURS.map((colour) => [colour, z.string().min(1)])) as Record<
    (typeof SEAT_COLOURS)[number],
    z.ZodString
  >)
  .strict();

export const characterSchema = z
  .object({
    id: contentIdSchema.transform(asContentId),
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    unlock: contentIdSchema.transform(asContentId).optional(),
    sheetAliases: perSeat,
    portraitAliases: perSeat,
  })
  .strict();
