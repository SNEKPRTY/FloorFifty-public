/**
 * The type stacks, for text the canvas draws.
 *
 * Pixi cannot read a CSS custom property, so the stacks the DOM gets from
 * `--ff-font-wordmark` and `--ff-font-ui` in `features/kit/theme.css` are restated here,
 * once. `tests/client/features/i18n/typography.test.ts` holds the Latin copies equal and
 * `tests/client/features/i18n/fonts.test.ts` the per-locale ones, so a nameplate cannot
 * drift into a face the menu does not use.
 *
 * Fraunces sets the wordmark and nothing else. Fusion Pixel sets everything else
 * (one weight, drawn the same at 400 and 600); a CJK locale adds its own Fusion Pixel
 * cut after it (languages spec §6.2).
 */

import type { LocaleTag } from "./locales";

export const FONT_WORDMARK = '"Fraunces", Georgia, "Times New Roman", serif';
export const FONT_UI = '"FF Pixel", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CJK_FAMILY: Partial<Record<LocaleTag, string>> = { ja: "FF Pixel JP", ko: "FF Pixel KR", "zh-Hans": "FF Pixel SC" };

/** The UI stack for a locale: `--ff-font-ui` as `theme.css` sets it under `:lang()`. */
export function fontUiFor(locale: LocaleTag): string {
  const cjk = CJK_FAMILY[locale];
  return cjk === undefined ? FONT_UI : `"FF Pixel", "${cjk}", ${FALLBACK}`;
}

/** The faces a switch into `locale` must have loaded first, so nothing (Pixi least of all) draws in a fallback. */
export function localeFaces(locale: LocaleTag): readonly string[] {
  const cjk = CJK_FAMILY[locale];
  return cjk === undefined ? [] : [`400 1em "${cjk}"`, `600 1em "${cjk}"`];
}

/** Loads `locale`'s faces; a face that fails to load is the system fallback's job, never an error. */
export async function loadLocaleFaces(locale: LocaleTag, fonts: FontFaceSet | undefined = globalThis.document?.fonts): Promise<void> {
  if (fonts === undefined) return;
  await Promise.all(localeFaces(locale).map((face) => fonts.load(face).catch(() => [])));
}
