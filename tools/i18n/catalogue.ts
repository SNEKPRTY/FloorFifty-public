/**
 * The message catalogues as data (languages spec §7, §8.1): reading them,
 * what each message's readers can see, its parameters and plural selectors,
 * and the parity rules every translated locale is held to.
 */

import { readFile } from "node:fs/promises";
import type { LocaleTag } from "../../apps/client/src/features/i18n/locales";

export type VariantMessage = {
  readonly declarations?: readonly string[];
  readonly selectors?: readonly string[];
  readonly match: Readonly<Record<string, string>>;
};
export type MessageValue = string | readonly VariantMessage[];
export type Catalogue = Readonly<Record<string, MessageValue>>;
export type ContextEntry = { readonly note: string; readonly maxChars?: number; readonly screenshot?: string };

const MESSAGES = "apps/client/messages";

export async function readCatalogue(locale: LocaleTag, part: "ui" | "content", root = MESSAGES): Promise<Catalogue> {
  try {
    const raw = JSON.parse(await readFile(`${root}/${part}/${locale}.json`, "utf8")) as Record<string, unknown>;
    delete raw["$schema"];
    return raw as Catalogue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Both parts merged as the compiler merges them: the UI file is last and wins. */
export async function readMessages(locale: LocaleTag, root = MESSAGES): Promise<Catalogue> {
  return { ...(await readCatalogue(locale, "content", root)), ...(await readCatalogue(locale, "ui", root)) };
}

export async function readContext(root = MESSAGES): Promise<Readonly<Record<string, ContextEntry>>> {
  return JSON.parse(await readFile(`${root}/context.json`, "utf8")) as Record<string, ContextEntry>;
}

/** Every pattern a reader can see: the string, or each variant's text. */
export function visibleTexts(value: MessageValue): string[] {
  return typeof value === "string" ? [value] : value.flatMap((message) => Object.values(message.match));
}

/**
 * `{name}` placeholders in the visible patterns; markup like `{#strong}` is not
 * a parameter. A declared input is not counted: a plural translation whose
 * variants never print the number has dropped it, whatever it declares.
 */
export function parameterNames(value: MessageValue): string[] {
  const names = new Set<string>();
  for (const text of visibleTexts(value)) {
    for (const match of text.matchAll(/(?<!\\)\{\s*([A-Za-z_]\w*)\s*\}/g)) names.add(match[1]!);
  }
  return [...names].sort();
}

/**
 * The plural categories a whole number from 0 to 100 reaches: every count and
 * place this game shows. CLDR's other categories (Spanish and Portuguese
 * "many", for millions written compactly) are never reached, so are not asked for.
 */
function reachableCategories(locale: LocaleTag, type: "cardinal" | "ordinal"): string[] {
  const rules = new Intl.PluralRules(locale, { type });
  return [...new Set(Array.from({ length: 101 }, (_, n) => rules.select(n)))];
}

export function pluralSelectors(
  value: MessageValue,
): { variable: string; type: "cardinal" | "ordinal"; categories: string[] }[] {
  if (typeof value === "string") return [];
  return value.flatMap((message) =>
    (message.declarations ?? []).flatMap((declaration) => {
      const local = /^local\s+(\w+)\s*=\s*\w+\s*:\s*plural(.*)$/.exec(declaration);
      if (!local) return [];
      const variable = local[1]!;
      const categories = Object.keys(message.match).map((key) => {
        const condition = key
          .split(",")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${variable}=`));
        return condition?.slice(variable.length + 1) ?? "*";
      });
      return [{ variable, type: /type=ordinal/.test(local[2]!) ? ("ordinal" as const) : ("cardinal" as const), categories }];
    }),
  );
}

/** The canonical text of a message, for the review hash: arrays as key-sorted JSON. */
export function messageText(value: MessageValue): string {
  if (typeof value === "string") return value;
  const sort = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sort)
      : typeof input === "object" && input !== null
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, child]) => [key, sort(child)]),
          )
        : input;
  return JSON.stringify(sort(value));
}

/** Everything wrong with one translated catalogue against EN (spec §8.1, parity). */
export function parityProblems(
  locale: LocaleTag,
  en: Catalogue,
  translated: Catalogue,
  context: Readonly<Record<string, ContextEntry>>,
): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(en)) {
    if (context[key] === undefined) problems.push(`${key}: no context entry`);
    const value = translated[key];
    if (value === undefined) {
      problems.push(`${locale} ${key}: missing`);
      continue;
    }
    const expected = parameterNames(en[key]!);
    const actual = parameterNames(value);
    if (expected.join() !== actual.join()) problems.push(`${locale} ${key}: parameters ${actual.join()} ≠ ${expected.join()}`);
    for (const selector of pluralSelectors(value)) {
      // A catch-all is "other", and only that: a category the language uses needs its own variant.
      const covered = selector.categories.map((category) => (category === "*" ? "other" : category));
      const missing = reachableCategories(locale, selector.type).filter((category) => !covered.includes(category));
      if (missing.length > 0) problems.push(`${locale} ${key}: ${selector.type} lacks ${missing.join(", ")}`);
    }
    const max = context[key]?.maxChars;
    if (max !== undefined) {
      for (const text of visibleTexts(value)) {
        const length = [...text.replace(/\{[^}]*\}/g, "")].length;
        if (length > max) problems.push(`${locale} ${key}: ${length} characters > maxChars ${max}`);
      }
    }
  }
  for (const key of Object.keys(translated)) if (en[key] === undefined) problems.push(`${locale} ${key}: not an EN key`);
  return problems;
}
