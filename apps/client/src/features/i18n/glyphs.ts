/** Which labels a controller's buttons carry, sniffed from its `id`. */

import * as m from "../../paraglide/messages.js";

export type GlyphFamily = "xbox" | "playstation" | "generic";
export type GlyphAction = "confirm" | "back" | "move" | "fastFall" | "restart" | "pause";

export function glyphFamily(id: string): GlyphFamily {
  const lower = id.toLowerCase();
  if (/xinput|045e|xbox/.test(lower)) return "xbox";
  if (/054c|dualsense|dualshock|playstation/.test(lower)) return "playstation";
  return "generic";
}

/** A label printed on the pad itself: the same in every language. */
const printed = (label: string) => (): string => label;

/**
 * Each family's labels, as functions: a printed symbol is itself, and a
 * button known by a word (Left stick, View, Options) is a message, so it
 * follows a language switch.
 */
export const GLYPHS: Record<GlyphFamily, Record<GlyphAction, () => string>> = {
  xbox: {
    confirm: printed("A"),
    back: printed("B"),
    move: m.a11y_glyph_left_stick,
    fastFall: printed("A / RT"),
    restart: m.a11y_glyph_view,
    pause: m.a11y_glyph_menu,
  },
  playstation: {
    confirm: printed("✕"),
    back: printed("○"),
    move: m.a11y_glyph_left_stick,
    fastFall: printed("✕ / R2"),
    restart: m.a11y_glyph_create,
    pause: m.a11y_glyph_options,
  },
  generic: {
    confirm: m.a11y_glyph_bottom_button,
    back: m.a11y_glyph_right_button,
    move: m.a11y_glyph_left_stick,
    fastFall: m.a11y_glyph_bottom_or_trigger,
    restart: m.a11y_glyph_select,
    pause: m.a11y_glyph_start,
  },
};
