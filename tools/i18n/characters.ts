/**
 * The characters a locale's text can contain (languages spec §6.1): every
 * visible pattern in both of its catalogues, plus ASCII, CJK punctuation and
 * the full-width forms. The subset script builds from it and the coverage test
 * re-derives it, so a translation edited without re-running the subset fails
 * the suite instead of showing tofu.
 */

import type { LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { readMessages, visibleTexts } from "./catalogue";

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => String.fromCodePoint(from + index));

export const ALWAYS: readonly string[] = [
  ...range(0x20, 0x7e),
  ...range(0x3000, 0x303f),
  ...range(0xff00, 0xffef),
  "…",
  "—",
  "·",
  "←",
  "→",
  "✓",
  "×",
];

/** Every character a locale's catalogues show: what the coverage test holds a subset to. */
export async function catalogueCharacters(locale: LocaleTag): Promise<Set<string>> {
  const characters = new Set<string>();
  for (const value of Object.values(await readMessages(locale))) {
    for (const text of visibleTexts(value)) for (const char of text) characters.add(char);
  }
  return characters;
}

/**
 * What a subset is cut to: the catalogues, plus the ranges a typed name or a
 * later string most likely needs. Some of those code points are unassigned, so
 * a subset holds only the ones its font has.
 */
export async function localeCharacters(locale: LocaleTag): Promise<Set<string>> {
  return new Set([...ALWAYS, ...(await catalogueCharacters(locale))]);
}
