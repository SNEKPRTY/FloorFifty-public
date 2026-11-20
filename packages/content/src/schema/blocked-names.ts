import { z } from "zod";

export const BLOCKED_WORD_MIN_LENGTH = 3;
export const BLOCKED_WORD_MAX_LENGTH = 32;

/**
 * Words a typed name may not contain in a public room (quick-match spec §6).
 *
 * Letters and digits only: the check strips everything else, so punctuation in
 * a word could never match. At least three, because a shorter word would block
 * names by accident.
 */
export const blockedNamesSchema = z
  .object({
    words: z.array(
      z
        .string()
        .min(BLOCKED_WORD_MIN_LENGTH)
        .max(BLOCKED_WORD_MAX_LENGTH)
        .regex(/^[\p{L}\p{N}]+$/u, "a word is letters and digits only"),
    ),
  })
  .strict();
