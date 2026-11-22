/**
 * The control prompts: the words the Instructions show for steering and for
 * dropping fast, one per input method the player may be holding.
 */

import { z } from "zod";

/** Where a controller prompt names its button: the client puts the pad's own glyph there. */
export const GLYPH_SLOT = "{glyph}";

const promptText = z.string().min(1).max(140);
const noSlot = promptText.refine((text) => !text.includes(GLYPH_SLOT), {
  message: `only a gamepad prompt may name ${GLYPH_SLOT}`,
});
const promptSchema = z
  .object({ keyboard: noSlot, gamepad: promptText, touch: noSlot, buttons: noSlot })
  .strict();

export const promptsSchema = z
  .object({ prompts: z.object({ move: promptSchema, fastFall: promptSchema }).strict() })
  .strict();

export type AuthoredPrompts = z.infer<typeof promptsSchema>;
