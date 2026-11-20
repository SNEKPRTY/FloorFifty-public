import { describe, expect, it } from "vitest";
import { defaultRacerName, nameIsBlocked, normaliseName } from "@floor-fifty/shared/common/names";
import { playerNameSchema } from "@floor-fifty/shared/common/schemas";

const WORDS = ["blorp"];

describe("normaliseName", () => {
  it("lowercases, folds look-alikes and keeps only letters", () => {
    expect(normaliseName("BL0RP")).toBe("blorp");
    expect(normaliseName("b_l-0 r.p")).toBe("blorp");
    expect(normaliseName("7h3 $@m3")).toBe("thesame");
  });

  it("keeps a letter from any script", () => {
    expect(normaliseName("Ñandú")).toBe("ñandú");
  });
});

describe("nameIsBlocked", () => {
  it("blocks the word whatever its case", () => {
    expect(nameIsBlocked("BLORP", WORDS)).toBe(true);
    expect(nameIsBlocked("Blorp", WORDS)).toBe(true);
  });

  it("blocks it split by spacing and punctuation", () => {
    expect(nameIsBlocked("b l o r p", WORDS)).toBe(true);
    expect(nameIsBlocked("b-l_o r-p", WORDS)).toBe(true);
  });

  it("blocks it written with look-alike characters", () => {
    expect(nameIsBlocked("bl0rp", WORDS)).toBe(true);
    expect(nameIsBlocked("8l0rp", WORDS)).toBe(false);
  });

  it("blocks it hidden inside a longer name", () => {
    expect(nameIsBlocked("xxBlorpxx", WORDS)).toBe(true);
    expect(nameIsBlocked("The Blorp Fan", WORDS)).toBe(true);
  });

  it("keeps a clean name that only resembles the word", () => {
    expect(nameIsBlocked("Kite", WORDS)).toBe(false);
    expect(nameIsBlocked("Blor", WORDS)).toBe(false);
    expect(nameIsBlocked("Bl orb", WORDS)).toBe(false);
  });

  it("normalises the word the same way, so an authored 'bl0rp' still matches", () => {
    expect(nameIsBlocked("Blorp", ["bl0rp"])).toBe(true);
  });

  it("never lets a word that normalises to nothing block every name", () => {
    expect(nameIsBlocked("Kite", ["123", "---"])).toBe(false);
    expect(nameIsBlocked("Kite", [])).toBe(false);
  });
});

describe("defaultRacerName", () => {
  it("is Racer and two digits, 10 to 99", () => {
    expect(defaultRacerName(() => 0)).toBe("Racer 10");
    expect(defaultRacerName(() => 0.9999)).toBe("Racer 99");
  });

  it("is a name the server accepts", () => {
    for (const r of [0, 0.5, 0.9999]) expect(playerNameSchema.safeParse(defaultRacerName(() => r)).success).toBe(true);
  });
});
