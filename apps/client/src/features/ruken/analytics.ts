/**
 * The analytics events Floor Fifty discloses to Ruken (P6 spec §4).
 *
 * Ruken shows players this list (`[analytics].custom_events` in `ruken.toml`)
 * and sends them only with the player's consent. None carries a name, a room
 * code or any free text: only the fields typed here.
 */

import type { SettingsStore } from "../profile/store/settings.svelte";

export const DISCLOSED_EVENTS = [
  "race_started",
  "race_finished",
  "tutorial_completed",
  "tutorial_skipped",
  "character_selected",
] as const;

export type FfEventName = (typeof DISCLOSED_EVENTS)[number];

export type FfEvent =
  | { readonly name: "race_started"; readonly props: { readonly mode: "quick" | "room" | "tutorial" } }
  | { readonly name: "race_finished"; readonly props: { readonly place: number; readonly players: number } }
  | { readonly name: "tutorial_completed" }
  | { readonly name: "tutorial_skipped" }
  | { readonly name: "character_selected"; readonly props: { readonly character: string } };

/**
 * `character_selected`, whenever the player picks a body: at the title or in
 * the lobby, both of which remember the pick in settings. Watching the
 * setting rather than each picker means a new picker cannot forget to report.
 */
export function reportCharacterPicks(
  settings: Pick<SettingsStore, "value" | "subscribe">,
  hosting: { track(event: FfEvent): void },
): () => void {
  let last = settings.value.profile.lastCharacter;
  return settings.subscribe((value) => {
    const character = value.profile.lastCharacter;
    if (character === last) return;
    last = character;
    hosting.track({ name: "character_selected", props: { character } });
  });
}
