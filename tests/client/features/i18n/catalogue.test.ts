// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LOCALE_TAGS } from "../../../../apps/client/src/features/i18n/locales";
import {
  messageText,
  parameterNames,
  parityProblems,
  pluralSelectors,
  readContext,
  readMessages,
} from "../../../../tools/i18n/catalogue";

describe("catalogue parity (languages spec §8.1)", () => {
  it.each(LOCALE_TAGS)("%s has every EN key, the same parameters, full plurals, and fits maxChars", async (locale) => {
    const [en, translated, context] = await Promise.all([readMessages("en"), readMessages(locale), readContext()]);
    expect(parityProblems(locale, en, translated, context)).toEqual([]);
  });

  it("gives every context entry a note, and names no key that does not exist", async () => {
    const [en, context] = await Promise.all([readMessages("en"), readContext()]);
    expect(Object.keys(context).filter((key) => en[key] === undefined)).toEqual([]);
    expect(Object.entries(context).filter(([, entry]) => entry.note.trim() === "").map(([key]) => key)).toEqual([]);
  });
});

describe("the parity rules themselves", () => {
  it("reads parameters from simple and variant messages, ignoring markup", () => {
    expect(parameterNames("{name} wins")).toEqual(["name"]);
    expect(parameterNames("{#strong}Race continues{/strong}")).toEqual([]);
    expect(
      parameterNames([
        { declarations: ["input count", "local n = count: plural"], selectors: ["n"], match: { "n=one": "1 s", "n=*": "{count} s" } },
      ]),
    ).toEqual(["count"]);
  });

  it("finds a missing plural category", () => {
    const value = [{ declarations: ["input count", "local n = count: plural"], selectors: ["n"], match: { "n=one": "one" } }];
    expect(pluralSelectors(value)).toEqual([{ variable: "n", type: "cardinal", categories: ["one"] }]);
    expect(parityProblems("en", { k: value }, { k: value }, { k: { note: "x" } })).toEqual(["en k: cardinal lacks other"]);
  });

  it("accepts a catch-all alone where a whole number reaches only other", () => {
    const value = [{ declarations: ["input count", "local n = count: plural type=ordinal"], selectors: ["n"], match: { "n=*": "{count}" } }];
    expect(pluralSelectors(value)).toEqual([{ variable: "n", type: "ordinal", categories: ["*"] }]);
    expect(parityProblems("ja", { k: value }, { k: value }, { k: { note: "x" } })).toEqual([]);
    // Spanish's "many" is for millions written compactly; no count this game shows reaches it.
    const cardinal = [{ declarations: ["input count", "local n = count: plural"], selectors: ["n"], match: { "n=one": "{count} s", "n=*": "{count} s" } }];
    expect(parityProblems("es-419", { k: cardinal }, { k: cardinal }, { k: { note: "x" } })).toEqual([]);
  });

  it("does not let a catch-all stand in for a category the language uses", () => {
    const en = [{ declarations: ["input seconds", "local n = seconds: plural"], selectors: ["n"], match: { "n=one": "{seconds} second", "n=*": "{seconds} seconds" } }];
    const pt = [{ declarations: ["input seconds", "local n = seconds: plural"], selectors: ["n"], match: { "n=*": "{seconds} segundos" } }];
    expect(parityProblems("pt-BR", { k: en }, { k: pt }, { k: { note: "x" } })).toEqual(["pt-BR k: cardinal lacks one"]);
  });

  it("refuses a plural translation that never prints its number", () => {
    const en = [{ declarations: ["input seconds", "local n = seconds: plural"], selectors: ["n"], match: { "n=one": "{seconds} second", "n=*": "{seconds} seconds" } }];
    const es = [{ declarations: ["input seconds", "local n = seconds: plural"], selectors: ["n"], match: { "n=one": "Pronto.", "n=*": "Pronto." } }];
    expect(parityProblems("es-419", { k: en }, { k: es }, { k: { note: "x" } })).toEqual(["es-419 k: parameters  ≠ seconds"]);
  });

  it("refuses a dropped parameter, an extra key and an overlong string", () => {
    const en = { a: "{name} wins", b: "Lap" };
    const problems = parityProblems("ja", en, { a: "勝ち", b: "ラップラップ", c: "x" }, { a: { note: "x" }, b: { note: "x", maxChars: 4 } });
    expect(problems).toEqual(["ja a: parameters  ≠ name", "ja b: 6 characters > maxChars 4", "ja c: not an EN key"]);
  });

  it("canonicalises a variant message by sorted keys, so the review hash is stable", () => {
    expect(messageText("Play")).toBe("Play");
    expect(messageText([{ match: { b: "2", a: "1" }, selectors: ["x"] }])).toBe('[{"match":{"a":"1","b":"2"},"selectors":["x"]}]');
  });
});
