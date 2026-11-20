// @vitest-environment node
import { describe, expect, it } from "vitest";
import { entrySeed, moveCursor, nudge, parseSeedText, seedEntry, typeDigit } from "../../../../apps/client/src/features/select/seed-entry";

describe("the seed editor's model (stage seeds spec §4.2)", () => {
  it("opens on a seed's six digits, cursor on the first", () => {
    expect(seedEntry(48213)).toEqual({ digits: [0, 4, 8, 2, 1, 3], cursor: 0 });
  });

  it("nudges the digit under the cursor, wrapping 9 to 0 and 0 to 9", () => {
    expect(entrySeed(nudge(seedEntry(900000), 1))).toBe(0);
    expect(entrySeed(nudge(seedEntry(0), -1))).toBe(900000);
  });

  it("moves the cursor within the six cells, never past either end", () => {
    let entry = moveCursor(seedEntry(0), -1);
    expect(entry.cursor).toBe(0);
    for (let step = 0; step < 9; step += 1) entry = moveCursor(entry, 1);
    expect(entry.cursor).toBe(5);
  });

  it("types a digit into the cell and advances, staying on the last", () => {
    let entry = seedEntry(0);
    for (const digit of [1, 2, 3, 4, 5, 6, 7]) entry = typeDigit(entry, digit);
    expect(entrySeed(entry)).toBe(123457);
    expect(entry.cursor).toBe(5);
  });

  it("reads typed text as a seed only when it is one to six digits", () => {
    expect(parseSeedText("12345")).toBe(12345);
    expect(parseSeedText(" 048213 ")).toBe(48213);
    expect(parseSeedText("#048213")).toBe(48213);
    for (const bad of ["", "12a45", "1234567", "-5", "1.5", "１２３", "#"]) expect(parseSeedText(bad)).toBeUndefined();
  });
});
