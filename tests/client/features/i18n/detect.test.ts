// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectLocale } from "../../../../apps/client/src/features/i18n/detect";
import { ENDONYMS, LOCALE_TAGS, isLocaleTag } from "../../../../apps/client/src/features/i18n/locales";

describe("detectLocale (languages spec §3.2)", () => {
  it.each([
    [["en-GB"], "en"],
    [["ja-JP"], "ja"],
    [["ko"], "ko"],
    [["es-MX"], "es-419"],
    [["es-ES"], "es-419"],
    [["pt-BR"], "pt-BR"],
    [["pt-PT"], "pt-BR"],
    [["zh-CN"], "zh-Hans"],
    [["zh-TW"], "zh-Hans"],
    [["zh-HK"], "zh-Hans"],
    [["zh-Hant"], "zh-Hans"],
    [["zh-Hant-TW"], "zh-Hans"],
    [["fr-FR", "de", "ko-KR", "ja"], "ko"],
    [["fr-FR", "de"], "en"],
    [[], "en"],
    [["JA-jp"], "ja"],
    [[""], "en"],
  ] as const)("%j → %s", (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });
});

describe("the locale table (§3.1)", () => {
  it("names each locale in its own script, in table order", () => {
    expect(LOCALE_TAGS).toEqual(["en", "ja", "ko", "es-419", "pt-BR", "zh-Hans"]);
    expect(ENDONYMS).toEqual({
      en: "English",
      ja: "日本語",
      ko: "한국어",
      "es-419": "Español",
      "pt-BR": "Português (Brasil)",
      "zh-Hans": "简体中文",
    });
  });

  it("recognises only the six tags", () => {
    expect(isLocaleTag("ja")).toBe(true);
    expect(isLocaleTag("pt-PT")).toBe(false);
    expect(isLocaleTag(null)).toBe(false);
  });

  it("matches the inlang project's locales", async () => {
    const settings = JSON.parse(await readFile("apps/client/project.inlang/settings.json", "utf8")) as { locales: string[] };
    expect(settings.locales).toEqual([...LOCALE_TAGS]);
  });
});
