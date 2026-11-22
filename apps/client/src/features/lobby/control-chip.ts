/**
 * A control's words for the Instructions: the move a slide names, worded for
 * the controls in the player's hand, in their language. On touch it is the
 * swipe wording or, for a player who chose them, the on-screen buttons'; on a
 * pad the glyph goes where the prompt names it.
 */

import type { ControlPrompts } from "@floor-fifty/shared/content/game-content";
import type { GlyphAction } from "../i18n/glyphs";
import { GLYPH_MARKER, promptWordsFromText, type PromptWords } from "../race/prompt-words";
import { controlPrompt } from "../i18n/content";
import type { InputMethod } from "../platform/input-method.svelte";

/** The moves a prompt is written for. */
export type ChipKind = keyof ControlPrompts;

/** The pad control a chip names. */
export const GLYPH_FOR_CHIP: Record<ChipKind, GlyphAction> = { move: "move", fastFall: "fastFall" };

export function chipWords(
  prompts: ControlPrompts,
  kind: ChipKind,
  method: InputMethod,
  touchMode: "swipe" | "buttons",
  glyph: string | undefined,
): PromptWords {
  const prompt = prompts[kind];
  const chosen = method === "touch" && touchMode === "buttons" ? "buttons" : method;
  return promptWordsFromText(controlPrompt(kind, chosen, prompt[chosen], GLYPH_MARKER), glyph);
}
