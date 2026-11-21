import * as m from "../../paraglide/messages.js";

/*
 * The words a prompt shows beside a controller's button picture. They live in
 * the race because the race's hints and the story's card both set words this
 * way, and the story sits above the race.
 */

/**
 * Where a prompt's glyph goes, once it is a message: a private-use character
 * no font draws and no translator types. The message's `{glyph}` parameter is
 * filled with it, so a translator can move the button anywhere in the
 * sentence (languages spec §4.3), and the card splits on it.
 */
export const GLYPH_MARKER = "\uE000";

/** A prompt as the card sets it: the words, with the pad's glyph, if any, between them. */
export type PromptWords = { readonly before: string; readonly glyph?: string; readonly after: string };

/**
 * Splits a resolved prompt at its marker. A translator who dropped the marker
 * gets the glyph after the sentence; one who doubled it gets it once, and the
 * marker itself is never shown.
 */
export function promptWordsFromText(text: string, glyph: string | undefined): PromptWords {
  const slot = text.indexOf(GLYPH_MARKER);
  if (slot < 0) return glyph === undefined ? { before: text, after: "" } : { before: `${text} `, glyph, after: "" };
  const before = text.slice(0, slot);
  const after = text.slice(slot + GLYPH_MARKER.length).replaceAll(GLYPH_MARKER, "");
  return glyph === undefined ? { before: `${before}${m.tutorial_the_button()}${after}`, after: "" } : { before, glyph, after };
}
