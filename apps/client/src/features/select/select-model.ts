/**
 * What the select screen reads from a snapshot, as pure functions, so the
 * numbers are tested without mounting anything (as `hud-model.ts` is).
 */

import { stageName } from "../i18n/content";
import * as m from "../../paraglide/messages.js";
import { RANDOM_PICK, TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import { formatSeed, type SeedChoice } from "@floor-fifty/shared/room/select";
import { portraitAliasFor } from "../profile/character-art";

/** Whole seconds left in the current step, rounded up, never below zero. */
export function secondsLeft(snapshot: RoomSnapshot): number {
  const select = snapshot.select;
  if (select === undefined) return 0;
  return Math.max(0, Math.ceil((select.endsAtTick - snapshot.tick) / TICK_HZ));
}

/** One player in the select panel's list (select spec §6.8): never a slot nobody holds. */
export type PlayerRow = {
  seat: number;
  name: string;
  colour: SeatColour;
  /** The bust, in the player's colour. */
  art?: string;
  /** What they are on in the current pick step ("?" for Random); absent before select. */
  itemId?: string;
  itemLabel?: string;
  /**
   * Their seed choice, named, on the stage step only, and only when it is not
   * the default Random (stage seeds spec §4.3): four rows of "Random" would
   * say nothing a row without it does not.
   */
  seedLabel?: string;
  locked: boolean;
  /** This device's seat. */
  local: boolean;
};

/** Which pick step a row's item belongs to. */
export type PickKindOnScreen = "stage" | "song";

/** The label for an item ID in a pick step: its name, or "Random stage" / "Random song". */
export function itemLabel(content: GameContentPayload | undefined, kind: PickKindOnScreen, id: string): string {
  if (id === RANDOM_PICK) return kind === "stage" ? m.select_random_stage() : m.select_random_song();
  if (kind === "stage") {
    const stage = content?.stages.find((entry) => entry.id === id);
    return stage === undefined ? id : stageName(stage);
  }
  // A song's name is its title, the same in every language (languages spec D-L4).
  return content?.songs.find((entry) => entry.id === id)?.displayName ?? id;
}

/**
 * Every player in the room, in seat order, with what they are on in the
 * current pick step, named for that step's kind.
 */
export function playerRows(
  snapshot: RoomSnapshot,
  content: GameContentPayload | undefined,
  artSrc: (alias: string) => string | undefined,
  localPlayerId: string | undefined,
  kind: PickKindOnScreen = "stage",
): PlayerRow[] {
  return snapshot.players.map((player, seat) => {
    const pick = snapshot.select?.picks[player.id];
    const row: PlayerRow = {
      seat,
      name: player.name,
      colour: player.colour,
      locked: pick?.locked ?? false,
      local: player.id === localPlayerId,
    };
    const art = artSrc(portraitAliasFor(content, player.characterId, player.colour, "neutral"));
    if (art !== undefined) row.art = art;
    if (pick !== undefined) {
      row.itemId = pick.focus;
      row.itemLabel = itemLabel(content, kind, pick.focus);
      if (kind === "stage" && pick.seed !== "random") row.seedLabel = seedChoiceLabel(pick.seed);
    }
    return row;
  });
}

/** A seed choice as a player reads it: "Random", "Classic" or "#048213" (stage seeds spec §4.1). */
export function seedChoiceLabel(choice: SeedChoice): string {
  if (choice === "random") return m.select_seed_random();
  if (choice === "classic") return m.select_seed_classic();
  return formatSeed(choice);
}

/** "Picked by Sable", or "Your pick" when the winner is this device's seat. */
export function revealByline(rows: readonly PlayerRow[], winnerSeat: number): string {
  const winner = rows.find((row) => row.seat === winnerSeat);
  if (winner === undefined) return "";
  return winner.local ? m.select_reveal_your_pick() : m.select_reveal_pick_of({ name: winner.name });
}

/**
 * The pick rows as the step shows them (UI layout system spec §6.4): another
 * player on the same pick as you shows no pick, so four rows of "Rooftops"
 * stop repeating what your own row says. Every row stays, so a lock is
 * never hidden. The reveal reads `playerRows` unfiltered: its highlight
 * passes over every pick.
 */
export function distinctPicks(rows: readonly PlayerRow[]): PlayerRow[] {
  const mine = rows.find((row) => row.local)?.itemId;
  if (mine === undefined) return [...rows];
  return rows.map((row) => {
    if (row.local || row.itemId !== mine) return row;
    const { itemId: _id, itemLabel: _label, ...rest } = row;
    return rest;
  });
}

/**
 * The large covers the song reveal may land on: each song a player is on
 * during the song step, once each (Owner, 2026-10-10). Song select fetches them
 * as the picks change, so the reveal's 1200 px cover is already in when it
 * lands, rather than the panel cover sharpening into it. Random and an unknown
 * song ask for nothing; the panel cover under the reveal stays the fallback on
 * a link too slow to bring the large one in time.
 */
export function revealCoversToFetch(
  snapshot: RoomSnapshot,
  content: GameContentPayload | undefined,
  artSrc: (alias: string) => string | undefined,
): string[] {
  if (snapshot.select?.step !== "song" || content === undefined) return [];
  const urls = Object.values(snapshot.select.picks).flatMap((pick) => {
    const alias = content.songs.find((song) => song.id === pick.focus)?.coverAlias;
    const url = alias === undefined ? undefined : artSrc(`${alias}Full`);
    return url === undefined ? [] : [url];
  });
  return [...new Set(urls)];
}
