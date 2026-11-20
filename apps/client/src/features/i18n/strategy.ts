/**
 * Where the active locale comes from (languages spec §3.4).
 *
 * Paraglide asks the `custom-settings` strategy on every message call. It
 * answers from the settings store's `$state`, so a template that calls a
 * message re-renders when the choice changes: the switch is live, with no
 * reload, and a race, a room or the tutorial carries on (D-L6). While the
 * choice is Automatic it answers detection, read fresh each time so a
 * browser's language change is followed on the next boot.
 */

import { loadLocaleFaces } from "./fonts";
import { defineCustomClientStrategy, getLocale } from "../../paraglide/runtime.js";
import { detectLocale } from "./detect";
import { isLocaleTag, type LocaleTag } from "./locales";

export type LocaleSource = {
  readonly value: { readonly locale: LocaleTag | null };
  update(patch: { locale: LocaleTag | null }): void;
};

/** The browser's languages, best first; some WebViews report an empty list and only `language`. */
export const browserLanguages = (
  nav: Pick<Navigator, "languages" | "language"> | undefined = globalThis.navigator,
): readonly string[] => {
  if (nav === undefined) return [];
  return nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [];
};

let source: LocaleSource | undefined;
let languages: () => readonly string[] = browserLanguages;

const answer = (): LocaleTag | undefined =>
  source === undefined ? undefined : (source.value.locale ?? detectLocale(languages()));

defineCustomClientStrategy("custom-settings", {
  getLocale: answer,
  // The runtime's first `getLocale()` echoes what it resolved back through
  // here, often from inside a template. Writing that echo would save the
  // detected locale as a choice (ending Automatic) and mutate state
  // mid-render, so only a change is written.
  setLocale: (locale) => {
    if (isLocaleTag(locale) && locale !== answer()) source?.update({ locale });
  },
});

/** Points the strategy at the store. Returns the undo, for tests. */
export function installLocaleStrategy(
  settings: LocaleSource,
  preferred: () => readonly string[] = browserLanguages,
): () => void {
  source = settings;
  languages = preferred;
  return () => {
    source = undefined;
    languages = browserLanguages;
  };
}

/** What Automatic chooses: the browser's first language the game has, from the same source the strategy reads. */
export function detectedLocale(): LocaleTag {
  return detectLocale(languages());
}

/** The locale messages are drawn in right now. */
export function activeLocale(): LocaleTag {
  const locale = getLocale();
  return isLocaleTag(locale) ? locale : "en";
}

/** The newest pick; an older one whose face arrives later must not undo it. */
let latestPick = 0;

/**
 * The picker's one call: a tag, or null for Automatic. Never reloads.
 * Resolves true when this pick was applied, false when a later pick
 * overtook it while its face was loading (so the caller announces once).
 */
export async function applyLocale(choice: LocaleTag | null): Promise<boolean> {
  const ticket = ++latestPick;
  // The new face first (languages spec §6.2): a label drawn the moment the
  // locale flips, Pixi's above all, must not rasterise in the fallback.
  await loadLocaleFaces(choice ?? detectedLocale());
  if (ticket !== latestPick) return false;
  // Written here, not through Paraglide's setLocale: the strategy ignores a
  // locale it already answers (the runtime's echo), and an explicit pick of
  // the language Automatic already shows must still be saved as a choice.
  source?.update({ locale: choice });
  return true;
}
