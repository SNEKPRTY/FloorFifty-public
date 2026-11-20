/**
 * The room code editor's model: six letter cells and a cursor, as pure
 * functions, so a pad steps through the code's own alphabet and a keyboard
 * types into it under one set of rules. The seed editor's twin
 * (`select/seed-entry.ts`), with letters for digits.
 */

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";

export type CodeEntry = { readonly letters: readonly string[]; readonly cursor: number };

/** Up from an empty cell starts at the alphabet's first letter, down at its last. */
const EMPTY = "";

/**
 * The cells for a code typed so far, empty past its end. A character the
 * code alphabet lacks is kept as typed: the room says whether it exists.
 */
export function codeEntry(text: string): CodeEntry {
  const typed = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH).split("");
  const letters = Array.from({ length: ROOM_CODE_LENGTH }, (_, at) => typed[at] ?? EMPTY);
  return { letters, cursor: Math.min(typed.length, ROOM_CODE_LENGTH - 1) };
}

/** The next or previous letter of the code alphabet under the cursor, wrapping at both ends. */
export function stepLetter(entry: CodeEntry, delta: 1 | -1): CodeEntry {
  const letters = [...entry.letters];
  const letter = letters[entry.cursor] ?? EMPTY;
  // Not `indexOf` of the empty string, which is 0: an empty cell is off the alphabet.
  const at = letter === EMPTY ? -1 : ROOM_CODE_ALPHABET.indexOf(letter);
  const size = ROOM_CODE_ALPHABET.length;
  const next = at === -1 ? (delta === 1 ? 0 : size - 1) : (at + delta + size) % size;
  letters[entry.cursor] = ROOM_CODE_ALPHABET[next]!;
  return { ...entry, letters };
}

/** Moves the cursor one cell, never past either end. */
export function moveCodeCursor(entry: CodeEntry, delta: 1 | -1): CodeEntry {
  return { ...entry, cursor: Math.min(ROOM_CODE_LENGTH - 1, Math.max(0, entry.cursor + delta)) };
}

/** Types a letter or digit into the cell under the cursor and moves on, staying on the last cell. */
export function typeLetter(entry: CodeEntry, key: string): CodeEntry {
  const letters = [...entry.letters];
  letters[entry.cursor] = key.toUpperCase();
  return { letters, cursor: Math.min(ROOM_CODE_LENGTH - 1, entry.cursor + 1) };
}

/** Clears the cell under the cursor, or the one before it when it is already empty. */
export function eraseLetter(entry: CodeEntry): CodeEntry {
  const letters = [...entry.letters];
  const at = letters[entry.cursor] === EMPTY ? Math.max(0, entry.cursor - 1) : entry.cursor;
  letters[at] = EMPTY;
  return { letters, cursor: at };
}

/** The code the cells spell, or undefined until every cell holds a letter. */
export function entryCode(entry: CodeEntry): string | undefined {
  return entry.letters.every((letter) => letter !== EMPTY) ? entry.letters.join("") : undefined;
}
