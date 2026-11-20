/**
 * The name a racer gets when none was typed, in the player's language.
 *
 * A controller has no keyboard, and a first-time controller player was
 * stopped at the lobby by "Enter a name". Letters, digits and a space, so it
 * passes the wire schema like any typed name. The server's own fallback
 * (`@floor-fifty/shared/common/names`) stays English: it has no language.
 */

import type { LocaleTag } from "../i18n/locales";
import * as m from "../../paraglide/messages.js";

export function defaultRacerName(random: () => number = Math.random, locale?: LocaleTag): string {
  const number = String(10 + Math.floor(random() * 90));
  return locale === undefined ? m.lobby_default_name({ number }) : m.lobby_default_name({ number }, { locale });
}
