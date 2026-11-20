/**
 * From a results snapshot to the race facts the predicates judge (unlockables
 * spec §4.1), and from a condition the store just granted to the thing the
 * banner draws (§7.1).
 */

import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { GameContentPayload, SongContent } from "@floor-fifty/shared/content/game-content";
import type { RaceFacts } from "@floor-fifty/shared/unlocks/conditions";
import { characterName } from "../i18n/content";
import type { NetworkPort } from "./network";
import * as m from "../../paraglide/messages.js";
import type { ProgressStore } from "../profile/store/progress.svelte";
import { portraitAliasFor } from "../profile/character-art";

/** How long a banner stays before it dismisses itself (unlockables spec §7.1). */
export const UNLOCK_BANNER_MS = 6000;

export type UnlockGrant =
  | { kind: "song"; conditionId: string; id: string; title: string; coverAlias: string | undefined; song: SongContent }
  | { kind: "character"; conditionId: string; id: string; name: string; portraitAlias: string; colour: SeatColour };

export function raceFactsOf(snapshot: RoomSnapshot, localPlayerId: string | undefined): RaceFacts {
  return {
    phase: snapshot.phase,
    localPlayerId,
    seats: snapshot.players.map(({ id, status, deviceClass, cpu }) => ({ id, status, deviceClass, cpu })),
  };
}

/** What a granted condition gives, songs first; a condition that gives nothing drawable has no banner. */
export function grantOf(content: GameContentPayload, conditionId: string, colour: SeatColour): UnlockGrant | undefined {
  const song = content.songs.find((candidate) => candidate.unlock === conditionId);
  if (song !== undefined)
    return { kind: "song", conditionId, id: song.id, title: song.displayName, coverAlias: song.coverAlias, song };
  const character = content.characters.find((candidate) => candidate.unlock === conditionId);
  if (character !== undefined)
    return {
      kind: "character",
      conditionId,
      id: character.id,
      name: characterName(character),
      portraitAlias: portraitAliasFor(content, character.id, colour, "win"),
      colour,
    };
  return undefined;
}

/** What a screen reader hears, and the replay window's status line shows, when a grant lands. */
export function grantAnnouncement(grant: UnlockGrant): string {
  return grant.kind === "song" ? m.results_unlocked_song({ title: grant.title }) : m.results_unlocked_character({ name: grant.name });
}

/** The round's grant slot closes when the next race's countdown begins (§5.2). */
export function closeSlotOnCountdown(
  network: Pick<NetworkPort, "subscribe">,
  progress: Pick<ProgressStore, "closeSlot">,
): () => void {
  return network.subscribe({
    onSnapshot: (snapshot) => {
      if (snapshot.phase === "countdown") progress.closeSlot();
    },
  });
}
