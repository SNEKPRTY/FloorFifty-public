import { z } from "zod";
import { contentIdSchema } from "./id";

export const PACK_TITLE_MAX_LENGTH = 24;

/** One page family in every grid: its title heads the page. */
export const packSchema = z
  .object({
    id: contentIdSchema,
    title: z.string().min(1).max(PACK_TITLE_MAX_LENGTH),
    dlc: z.boolean().default(false),
    stages: z.array(contentIdSchema).default([]),
    songs: z.array(contentIdSchema).default([]),
    characters: z.array(contentIdSchema).default([]),
  })
  .strict();
