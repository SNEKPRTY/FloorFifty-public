/**
 * The locale a browser asks for, when the player has not chosen one
 * (languages spec §3.2).
 *
 * Matched on the primary subtag alone, in the browser's order of preference.
 * Every Chinese tag lands on Simplified (D-L1) and every Portuguese one on
 * Brazilian; a browser that asks for none of the six gets English.
 */

import type { LocaleTag } from "./locales";

const BY_PRIMARY: Readonly<Record<string, LocaleTag>> = {
  en: "en",
  ja: "ja",
  ko: "ko",
  es: "es-419",
  pt: "pt-BR",
  zh: "zh-Hans",
};

export function detectLocale(languages: readonly string[]): LocaleTag {
  for (const language of languages) {
    const primary = language.split("-")[0]?.toLowerCase() ?? "";
    const match = BY_PRIMARY[primary];
    if (match !== undefined) return match;
  }
  return "en";
}
