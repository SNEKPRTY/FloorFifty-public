import { describe, expect, it } from "vitest";
import { buildPayload } from "@floor-fifty/content/canonicalize";
import { parseSources } from "@floor-fifty/content/parse";
import { nameIsBlocked } from "@floor-fifty/shared/common/names";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import { validTree } from "./support";

/**
 * Ordinary names, surnames and places that a word list could swallow by
 * accident. A silent replacement is the only effect of a false positive, so
 * the player never learns why: the shipped list must pass all of these.
 */
const ORDINARY_NAMES = [
  "Cassidy", "Dickens", "Dickinson", "Hancock", "Scunthorpe", "Essex", "Sussex", "Matsumoto",
  "Therapist", "Assistant", "Classic", "Passion", "Analyst", "Grasshopper", "Cocktail", "Shiitake",
  "Peacock", "Penistone", "Middlesex", "Arsenal", "Bassett", "Kite", "Sable", "Ninja 2",
  // Common given names and surnames, and handles that pick up a letter from a
  // look-alike digit (1 reads as i, 7 as t): the whole class a word list trips.
  "Harshit", "Harshita", "Akshita", "Rakshit", "Kshitij", "Nishita", "Shital",
  "Takeshita", "Morishita", "Yoshito", "Nishitani", "Josh17", "Ash 17", "Trish17",
];

describe("blocked-names.toml in the pipeline", () => {
  const parse = (text: string) => {
    const tree = validTree();
    return parseSources({ ...tree, blockedNames: { file: "content/blocked-names.toml", text } });
  };

  it("parses a list of words into the payload, sorted", () => {
    const result = parse('words = ["zeta", "alpha"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.blockedNames.value).toEqual(["zeta", "alpha"]);
    expect(buildPayload(result.parsed).blockedNames).toEqual(["alpha", "zeta"]);
  });

  it("refuses a word under three characters, which would block names by accident", () => {
    const result = parse('words = ["ab"]');
    expect(result.ok).toBe(false);
  });

  it("refuses a word with punctuation, which the check would strip anyway", () => {
    expect(parse('words = ["a-b-c"]').ok).toBe(false);
  });

  it("refuses an unknown field", () => {
    const result = parse('words = ["alpha"]\nextra = 1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.code).toBe("unknownField");
  });
});

describe("the shipped list", () => {
  const words = GENERATED_CONTENT.content.blockedNames;

  it("has words, each at least three characters", () => {
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) expect(word.length).toBeGreaterThanOrEqual(3);
  });

  it("blocks none of the ordinary names", () => {
    const blocked = ORDINARY_NAMES.filter((name) => nameIsBlocked(name, words));
    expect(blocked).toEqual([]);
  });
});
