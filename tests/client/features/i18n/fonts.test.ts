import { readFile } from "node:fs/promises";
import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { fontUiFor, localeFaces } from "../../../../apps/client/src/features/i18n/fonts";
import { ENDONYMS, LOCALE_TAGS, type LocaleTag } from "../../../../apps/client/src/features/i18n/locales";
import { catalogueCharacters } from "../../../../tools/i18n/characters";

const SUBSET = { ja: "jp", ko: "kr", "zh-Hans": "sc" } as const;

async function coverage(file: string): Promise<(char: string) => boolean> {
  const font = fontkit.create(await readFile(`apps/client/public/fonts/${file}`)) as fontkit.Font;
  return (char) => font.hasGlyphForCodePoint(char.codePointAt(0)!);
}

describe("CJK subsets (languages spec §6.1, §8.1)", () => {
  it.each(Object.entries(SUBSET))("the %s subset covers every character its catalogues use", async (locale, code) => {
    const has = await coverage(`ff-pixel-${code}-subset.woff2`);
    const missing = [...(await catalogueCharacters(locale as LocaleTag))].filter((char) => char.codePointAt(0)! > 0x7f && !has(char));
    expect(missing).toEqual([]);
  });

  it("the endonym subsets cover the three endonyms", async () => {
    for (const [code, tag] of [
      ["jp", "ja"],
      ["kr", "ko"],
      ["sc", "zh-Hans"],
    ] as const) {
      const has = await coverage(`ff-pixel-${code}-endonym.woff2`);
      expect([...ENDONYMS[tag]].filter((char) => !has(char))).toEqual([]);
    }
  });
});

describe("stacks (§6.2)", () => {
  it("each locale's CSS stack equals fontUiFor", async () => {
    const css = await readFile("apps/client/src/features/kit/theme.css", "utf8");
    for (const locale of LOCALE_TAGS) {
      const rule =
        locale === "ja" || locale === "ko" || locale === "zh-Hans"
          ? new RegExp(`:root:lang\\(${locale}\\)\\s*\\{[^}]*--ff-font-ui:\\s*([^;]+);`)
          : /:root\s*\{[^}]*--ff-font-ui:\s*([^;]+);/;
      expect(rule.exec(css)?.[1]?.trim(), locale).toBe(fontUiFor(locale));
    }
  });

  it("sets a CJK locale's headings in its Noto face after Fraunces, never the system serif", async () => {
    const css = await readFile("apps/client/src/features/kit/theme.css", "utf8");
    for (const [locale, family] of [
      ["ja", "FF Pixel JP"],
      ["ko", "FF Pixel KR"],
      ["zh-Hans", "FF Pixel SC"],
    ] as const) {
      const rule = new RegExp(`:root:lang\\(${locale}\\)\\s*\\{[^}]*--ff-font-wordmark:\\s*([^;]+);`);
      expect(rule.exec(css)?.[1]?.trim(), locale).toBe(`"Fraunces", "${family}", Georgia, "Times New Roman", serif`);
    }
  });

  it("keeps Fusion Pixel first, so Latin, digits and typed names keep the game's face", () => {
    for (const locale of LOCALE_TAGS) expect(fontUiFor(locale).startsWith('"FF Pixel"')).toBe(true);
  });

  it("loads no CJK face for a Latin locale", () => {
    expect(localeFaces("es-419")).toEqual([]);
    expect(localeFaces("ja")).toEqual(['400 1em "FF Pixel JP"', '600 1em "FF Pixel JP"']);
  });
});
