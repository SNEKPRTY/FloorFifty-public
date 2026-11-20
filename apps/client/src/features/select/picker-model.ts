/**
 * The fullscreen picker's arithmetic (select spec §6.8), as pure functions,
 * so paging and what a settled slide means are tested without a browser.
 * Stages and songs, each building its own items for the same shell.
 */

import { characterName, packTitle, stageName } from "../i18n/content";
import * as m from "../../paraglide/messages.js";
import { RANDOM_PICK } from "@floor-fifty/shared/common/constants";
import type { ItemKind } from "@floor-fifty/shared/content/access";
import type { GameContentPayload, PackContent } from "@floor-fifty/shared/content/game-content";
import { portraitAliasFor } from "../profile/character-art";
import { tileAccess, type AccessOptions } from "../profile/access";
import { type TileState, wrapPage } from "./tile-pages";

/** One slide: an item the room could race, or Random. */
export type PickerItem = {
  id: string;
  label: string;
  state: TileState;
  art?: string;
  /** Why it cannot be picked: the unlock hint, or its pack. Absent when open. */
  reason?: string;
  /** Earned by play and not yet revealed (unlockables spec §7.2). */
  isNew?: boolean;
};

/** Random first, then every stage in pack order, each with its preview still. */
export function stageItems(
  content: GameContentPayload,
  artSrc: (alias: string) => string | undefined,
  access: AccessOptions,
): PickerItem[] {
  const items: PickerItem[] = [{ id: RANDOM_PICK, label: m.select_random_stage(), state: "open" }];
  for (const pack of content.packs) {
    for (const id of pack.stages) {
      const stage = content.stages.find((entry) => entry.id === id);
      if (stage === undefined) continue;
      const tile = tileAccess(content, "stage", id, access);
      const item: PickerItem = { id, label: stageName(stage), state: tile.state };
      const still = stage.theme.previewAlias === undefined ? undefined : artSrc(stage.theme.previewAlias);
      if (still !== undefined) item.art = still;
      if (tile.state === "locked") item.reason = tile.hint;
      if (tile.state === "dlc") item.reason = m.select_dlc_pack({ pack: packTitle(pack) });
      if (tile.state === "open" && tile.isNew === true) item.isNew = true;
      items.push(item);
    }
  }
  return items;
}

/**
 * Random first, then every song in pack order, each with its large cover
 * (select spec §6.2): the slide is a music player, and the cover is most of it.
 */
export function songItems(
  content: GameContentPayload,
  artSrc: (alias: string) => string | undefined,
  access: AccessOptions,
): PickerItem[] {
  const items: PickerItem[] = [{ id: RANDOM_PICK, label: m.select_random_song(), state: "open" }];
  for (const pack of content.packs) {
    for (const id of pack.songs) {
      const song = content.songs.find((entry) => entry.id === id);
      if (song === undefined) continue;
      const tile = tileAccess(content, "song", id, access);
      const item: PickerItem = { id, label: song.displayName, state: tile.state };
      const cover = song.coverAlias === undefined ? undefined : artSrc(`${song.coverAlias}Large`);
      if (cover !== undefined) item.art = cover;
      if (tile.state === "locked") item.reason = tile.hint;
      if (tile.state === "dlc") item.reason = m.select_dlc_pack({ pack: packTitle(pack) });
      if (tile.state === "open" && tile.isNew === true) item.isNew = true;
      items.push(item);
    }
  }
  return items;
}

/**
 * Every item in a pack, for its Coming soon sheet (unlockables spec §7.3):
 * stages with their still, songs with their cover, characters with their bust.
 */
export function packItems(
  content: GameContentPayload,
  pack: PackContent,
  artSrc: (alias: string) => string | undefined,
): { kind: ItemKind; id: string; label: string; art?: string }[] {
  const items: { kind: ItemKind; id: string; label: string; art?: string }[] = [];
  const add = (kind: ItemKind, id: string, label: string, alias: string | undefined) => {
    const art = alias === undefined ? undefined : artSrc(alias);
    items.push(art === undefined ? { kind, id, label } : { kind, id, label, art });
  };
  for (const id of pack.stages) {
    const stage = content.stages.find((entry) => entry.id === id);
    if (stage !== undefined) add("stage", id, stageName(stage), stage.theme.previewAlias);
  }
  for (const id of pack.songs) {
    const song = content.songs.find((entry) => entry.id === id);
    if (song !== undefined) add("song", id, song.displayName, song.coverAlias);
  }
  for (const id of pack.characters) {
    const character = content.characters.find((entry) => entry.id === id);
    if (character !== undefined) add("character", id, characterName(character), portraitAliasFor(content, id, "scarlet", "neutral"));
  }
  return items;
}

/** Where a move of `delta` slides from `index` lands; paging wraps. */
export function moveTo(index: number, delta: number, count: number): number {
  return wrapPage(index + delta, count);
}

export function indexOf(items: readonly PickerItem[], id: string | undefined): number {
  return id === undefined ? -1 : items.findIndex((item) => item.id === id);
}

/**
 * What a slide that has come to rest picks: its ID when it is open, nothing
 * when it is locked or DLC, so the seat's focus stays where it was.
 */
export function settledPick(items: readonly PickerItem[], index: number): string | undefined {
  const item = items[index];
  return item !== undefined && item.state === "open" ? item.id : undefined;
}

/** "Stage, 3 of 4: Snow Shrine". */
export function accessibleLabel(kind: string, items: readonly PickerItem[], index: number): string {
  const item = items[index];
  const fields = { kind, position: index + 1, total: items.length, label: item?.label ?? "" };
  return item?.isNew === true ? m.select_item_position_new(fields) : m.select_item_position(fields);
}
