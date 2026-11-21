/**
 * The control chip's words (story mode v2 spec, "In the climb"): the move a
 * chapter teaches, worded for the controls in the player's hand, in their
 * language. On touch it is the swipe wording or, for a player who chose them,
 * the on-screen buttons'; on a pad the glyph goes where the prompt names it.
 */

import type { StoryContent } from "@floor-fifty/shared/content/game-content";
import type { ChipKind } from "@floor-fifty/shared/level/tutorial";
import type { GlyphAction } from "../i18n/glyphs";
import { GLYPH_MARKER, promptWordsFromText, type PromptWords } from "../race/prompt-words";
import { storyPrompt } from "../i18n/content";
import type { InputMethod } from "../platform/input-method.svelte";

/** The pad control a chip names. */
export const GLYPH_FOR_CHIP: Record<ChipKind, GlyphAction> = { move: "move", fastFall: "fastFall" };

export function chipWords(
  prompts: StoryContent["prompts"],
  kind: ChipKind,
  method: InputMethod,
  touchMode: "swipe" | "buttons",
  glyph: string | undefined,
): PromptWords {
  const prompt = prompts[kind];
  const chosen = method === "touch" && touchMode === "buttons" ? "buttons" : method;
  return promptWordsFromText(storyPrompt(kind, chosen, prompt[chosen], GLYPH_MARKER), glyph);
}
