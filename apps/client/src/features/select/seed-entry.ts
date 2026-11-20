/**
 * The seed editor's model (stage seeds spec §4.2): six digit cells and a
 * cursor, as pure functions, so a pad, a keyboard and a tap share one set of
 * rules, and the numbers are tested without mounting anything.
 */

import { isSeed, SEED_DIGITS } from "@floor-fifty/shared/room/select";

export type SeedEntry = { readonly digits: readonly number[]; readonly cursor: number };

/** A seed's six digits, zero-padded, with the cursor on the first. */
export function seedEntry(seed: number): SeedEntry {
  return { digits: String(seed).padStart(SEED_DIGITS, "0").split("").map(Number), cursor: 0 };
}

/** Raises or lowers the digit under the cursor, wrapping 9 to 0 and 0 to 9. */
export function nudge(entry: SeedEntry, delta: 1 | -1): SeedEntry {
  const digits = [...entry.digits];
  digits[entry.cursor] = (digits[entry.cursor]! + delta + 10) % 10;
  return { ...entry, digits };
}

/** Moves the cursor one cell, never past either end. */
export function moveCursor(entry: SeedEntry, delta: 1 | -1): SeedEntry {
  return { ...entry, cursor: Math.min(SEED_DIGITS - 1, Math.max(0, entry.cursor + delta)) };
}

/** Types a digit into the cell under the cursor and moves on, staying on the last cell. */
export function typeDigit(entry: SeedEntry, digit: number): SeedEntry {
  const digits = [...entry.digits];
  digits[entry.cursor] = digit;
  return { digits, cursor: Math.min(SEED_DIGITS - 1, entry.cursor + 1) };
}

export function entrySeed(entry: SeedEntry): number {
  return Number(entry.digits.join(""));
}

/** Typed or pasted text, with an optional leading "#": a seed only when it is one to six ASCII digits. */
export function parseSeedText(text: string): number | undefined {
  const match = /^#?([0-9]{1,6})$/.exec(text.trim());
  if (match === null) return undefined;
  const seed = Number(match[1]);
  return isSeed(seed) ? seed : undefined;
}
