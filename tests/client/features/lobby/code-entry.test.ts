import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET } from "@floor-fifty/shared/common/schemas";
import {
  codeEntry,
  entryCode,
  eraseLetter,
  moveCodeCursor,
  stepLetter,
  typeLetter,
} from "../../../../apps/client/src/features/lobby/code-entry";

describe("the room code a pad types", () => {
  it("opens on the code typed so far, the cursor on the next empty cell", () => {
    expect(codeEntry("ab")).toEqual({ letters: ["A", "B", "", "", "", ""], cursor: 2 });
    expect(codeEntry("ABCDEFGH")).toEqual({ letters: ["A", "B", "C", "D", "E", "F"], cursor: 5 });
  });

  it("steps an empty cell to the alphabet's first letter going up and its last going down", () => {
    expect(stepLetter(codeEntry(""), 1).letters[0]).toBe(ROOM_CODE_ALPHABET[0]);
    expect(stepLetter(codeEntry(""), -1).letters[0]).toBe(ROOM_CODE_ALPHABET.at(-1));
  });

  it("walks the whole code alphabet and wraps round to where it began", () => {
    let entry = codeEntry("A");
    entry = { ...entry, cursor: 0 };
    const seen: string[] = [];
    for (let step = 0; step < ROOM_CODE_ALPHABET.length; step += 1) {
      entry = stepLetter(entry, 1);
      seen.push(entry.letters[0]!);
    }
    expect(seen.at(-1)).toBe("A");
    expect(new Set(seen).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("moves the cursor but never off either end", () => {
    const entry = codeEntry("");
    expect(moveCodeCursor(entry, -1).cursor).toBe(0);
    expect(moveCodeCursor({ ...entry, cursor: 5 }, 1).cursor).toBe(5);
  });

  it("types and moves on, and erases back", () => {
    let entry = typeLetter(codeEntry(""), "k");
    expect(entry).toEqual({ letters: ["K", "", "", "", "", ""], cursor: 1 });
    entry = eraseLetter(entry);
    expect(entry).toEqual({ letters: ["", "", "", "", "", ""], cursor: 0 });
  });

  it("spells a code only once every cell holds a letter", () => {
    expect(entryCode(codeEntry("ABC"))).toBeUndefined();
    expect(entryCode(codeEntry("ABC234"))).toBe("ABC234");
  });
});
