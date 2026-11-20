/**
 * How much text each locale puts on screen, ranked longest first
 * (`pnpm i18n:lengths`).
 *
 * The screens walk audits the game in the language with the most text
 * (owner, 2026-11-14), because a screen that fits in English can break in
 * another; this is where "the most text" is read from, so the walk's default
 * language is measured and not chosen by hand.
 *
 * Every pattern a reader can see counts (a plural counts each of its
 * variants), as written: a `{name}` placeholder is counted as its letters.
 * Two measures: `characters`, code points, and `columns`, where a wide
 * (Chinese, Japanese, Korean or full-width) character counts two, since a
 * glyph of that kind takes about two Latin letters of room.
 */

import { LOCALE_TAGS, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { readMessages, visibleTexts, type Catalogue } from "./catalogue";

export type LocaleLength = {
  readonly locale: LocaleTag;
  /** Messages the locale has. */
  readonly keys: number;
  /** Visible patterns: a plural is several. */
  readonly strings: number;
  readonly characters: number;
  readonly columns: number;
  /** The widest single message, by its widest variant. */
  readonly widest: { readonly key: string; readonly characters: number };
  /** The keys this locale has the widest string of, of every locale. */
  readonly widestOn: number;
};

export type Measure = "characters" | "columns";

/** Code points that take two columns: East Asian Wide and Fullwidth, by their blocks. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

export function columnsOf(text: string): number {
  let columns = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    columns += WIDE.some(([from, to]) => point >= from && point <= to) ? 2 : 1;
  }
  return columns;
}

const charactersOf = (text: string): number => [...text].length;

/** A message's widest variant, in characters. */
const widestOf = (texts: readonly string[]): number => Math.max(0, ...texts.map(charactersOf));

/** Each locale with a catalogue, longest first by `by`; ties by the other measure, then the picker's order. */
export function rankLocales(catalogues: Readonly<Partial<Record<LocaleTag, Catalogue>>>, by: Measure = "characters"): LocaleLength[] {
  const present = LOCALE_TAGS.filter((tag) => (catalogues[tag] !== undefined ? Object.keys(catalogues[tag]!).length > 0 : false));
  const allKeys = new Set(present.flatMap((tag) => Object.keys(catalogues[tag]!)));

  // Which locale is widest on each key; the picker's order breaks a tie.
  const widestOn = new Map<LocaleTag, number>();
  for (const key of allKeys) {
    let best: { tag: LocaleTag; width: number } | undefined;
    for (const tag of present) {
      const value = catalogues[tag]![key];
      if (value === undefined) continue;
      const width = widestOf(visibleTexts(value));
      if (best === undefined || width > best.width) best = { tag, width };
    }
    if (best !== undefined) widestOn.set(best.tag, (widestOn.get(best.tag) ?? 0) + 1);
  }

  const measured = present.map((locale): LocaleLength => {
    const catalogue = catalogues[locale]!;
    const texts = Object.values(catalogue).flatMap((value) => visibleTexts(value));
    let widest = { key: "", characters: 0 };
    for (const [key, value] of Object.entries(catalogue)) {
      const width = widestOf(visibleTexts(value));
      if (width > widest.characters) widest = { key, characters: width };
    }
    return {
      locale,
      keys: Object.keys(catalogue).length,
      strings: texts.length,
      characters: texts.reduce((sum, text) => sum + charactersOf(text), 0),
      columns: texts.reduce((sum, text) => sum + columnsOf(text), 0),
      widest,
      widestOn: widestOn.get(locale) ?? 0,
    };
  });

  const other: Measure = by === "characters" ? "columns" : "characters";
  return measured.sort((a, b) => b[by] - a[by] || b[other] - a[other] || LOCALE_TAGS.indexOf(a.locale) - LOCALE_TAGS.indexOf(b.locale));
}

/** Reads every locale's catalogue under `messages` (`apps/client/messages`) and ranks them. */
export async function measureLocales(messages: string, by: Measure = "characters"): Promise<LocaleLength[]> {
  const catalogues: Partial<Record<LocaleTag, Catalogue>> = {};
  for (const tag of LOCALE_TAGS) catalogues[tag] = await readMessages(tag, messages);
  return rankLocales(catalogues, by);
}

/** The ranking as lines of text, longest first. */
export function rankingLines(ranking: readonly LocaleLength[], by: Measure): string[] {
  const pad = (text: string | number, width: number): string => String(text).padStart(width);
  return [
    `locales by text, longest first (ranked by ${by})`,
    `${"#".padEnd(2)} ${"locale".padEnd(8)} ${pad("characters", 10)} ${pad("columns", 8)} ${pad("strings", 8)} ${pad("widest on", 10)}  widest single string`,
    ...ranking.map(
      (row, index) =>
        `${String(index + 1).padEnd(2)} ${row.locale.padEnd(8)} ${pad(row.characters, 10)} ${pad(row.columns, 8)} ${pad(row.strings, 8)} ${pad(row.widestOn, 10)}  ${row.widest.key} (${row.widest.characters})`,
    ),
  ];
}
