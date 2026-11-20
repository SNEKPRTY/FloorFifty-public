/**
 * Review state (languages spec §7.2). A review is a hash of the English and
 * the translation together: change either and the string is unreviewed again
 * by itself, with no flag to clear by hand.
 */

import { createHash } from "node:crypto";
import { messageText, type Catalogue, type MessageValue } from "./catalogue";

export function reviewHash(en: MessageValue, translation: MessageValue): string {
  return createHash("sha256").update(`${messageText(en)}\u0000${messageText(translation)}`).digest("hex");
}

/** Which EN keys a locale has reviewed now, and which it has not (missing or changed since). */
export function reviewState(
  en: Catalogue,
  translated: Catalogue,
  review: Readonly<Record<string, string>>,
): { reviewed: string[]; unreviewed: string[] } {
  const reviewed: string[] = [];
  const unreviewed: string[] = [];
  for (const key of Object.keys(en).sort()) {
    const translation = translated[key];
    if (translation !== undefined && review[key] === reviewHash(en[key]!, translation)) reviewed.push(key);
    else unreviewed.push(key);
  }
  return { reviewed, unreviewed };
}
