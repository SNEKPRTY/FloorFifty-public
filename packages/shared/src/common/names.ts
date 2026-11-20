/**
 * What a typed name may say, and the name a racer gets when none was typed.
 *
 * Pure, so the server and the client agree: the server replaces a blocked name
 * with `defaultRacerName()`, and the connect panel makes the same kind of name
 * for a player with no keyboard.
 */

/** Characters a name may use to stand in for a letter. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

/**
 * A name or a word, reduced to the letters it would be read as: lowercase,
 * look-alikes folded, everything that is not a letter removed. Spacing and
 * punctuation therefore cannot split a word.
 */
export function normaliseName(value: string): string {
  let reduced = "";
  for (const character of value.toLowerCase()) {
    const folded = LOOK_ALIKES[character] ?? character;
    if (/\p{L}/u.test(folded)) reduced += folded;
  }
  return reduced;
}

/**
 * Whether a typed name contains any authored word, after both are reduced the
 * same way. A word that reduces to nothing is ignored, so it can never block
 * every name.
 */
export function nameIsBlocked(name: string, words: readonly string[]): boolean {
  const reduced = normaliseName(name);
  return words.some((word) => {
    const blocked = normaliseName(word);
    return blocked.length > 0 && reduced.includes(blocked);
  });
}

/**
 * The name a racer gets when none was typed.
 *
 * A controller has no keyboard, and a first-time controller player was
 * stopped at the lobby by "Enter a name". Letters, digits and a space, so it
 * passes the wire schema like any typed name.
 */
export function defaultRacerName(random: () => number = Math.random): string {
  return `Racer ${10 + Math.floor(random() * 90)}`;
}
