/**
 * The six languages the game ships in (languages spec §3.1).
 *
 * Pure data, so the settings schema and the repo's i18n tools can import it
 * without pulling in the generated runtime. The order is the picker's order.
 */

export const LOCALE_TAGS = ["en", "ja", "ko", "es-419", "pt-BR", "zh-Hans"] as const;
export type LocaleTag = (typeof LOCALE_TAGS)[number];

/** Each language named in its own script: the picker draws these and never translates them. */
export const ENDONYMS: Readonly<Record<LocaleTag, string>> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  "es-419": "Español",
  "pt-BR": "Português (Brasil)",
  "zh-Hans": "简体中文",
};

export type FlagCountry = "us" | "jp" | "kr" | "mx" | "br" | "cn";

/** The flag the picker draws for each language: the country it is drafted for (owner's call, 2026-10-03). */
export const LOCALE_FLAGS: Readonly<Record<LocaleTag, FlagCountry>> = {
  en: "us",
  ja: "jp",
  ko: "kr",
  "es-419": "mx",
  "pt-BR": "br",
  "zh-Hans": "cn",
};

export function isLocaleTag(value: unknown): value is LocaleTag {
  return typeof value === "string" && (LOCALE_TAGS as readonly string[]).includes(value);
}
