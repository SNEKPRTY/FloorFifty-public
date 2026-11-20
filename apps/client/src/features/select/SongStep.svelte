<script lang="ts">
  /**
   * The song step (select spec §6.2, amended 2026-09-30): one song at a time
   * on the fullscreen picker (§6.8), presented as a music player, swiped. On
   * screen is the pick, and what is on screen previews (§6.4): the step tells
   * the screen through `onView`, and the screen's deck plays it.
   */
  import * as m from "../../paraglide/messages.js";
  import { type AccessOptions } from "../profile/access";
  import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import type { MusicSpectrum } from "../audio";
  import { songItems, type PickerItem } from "./picker-model";
  import { distinctPicks, playerRows, secondsLeft } from "./select-model";
  import FullscreenPicker from "./FullscreenPicker.svelte";
  import ComingSoonSheet from "./ComingSoonSheet.svelte";
  import type { PackContent } from "@floor-fifty/shared/content/game-content";
  import SongSlide from "./SongSlide.svelte";

  let {
    snapshot,
    localPlayerId,
    content,
    artSrc,
    access,
    spectrum,
    onPick,
    onLockIn,
    onView,
  }: {
    snapshot: RoomSnapshot;
    localPlayerId: string | undefined;
    content: GameContentPayload | undefined;
    artSrc: (alias: string) => string | undefined;
    access: AccessOptions;
    spectrum: () => MusicSpectrum | undefined;
    onPick: (id: string) => void;
    onLockIn: () => void;
    onView: (item: PickerItem) => void;
  } = $props();

  const mine = $derived(localPlayerId === undefined ? undefined : snapshot.select?.picks[localPlayerId]);
  const items = $derived(content === undefined ? [] : songItems(content, artSrc, access));

  /** The Coming soon sheet a DLC slide opened; the step's clock keeps running under it (unlockables spec §7.3). */
  let teaser = $state<PackContent | undefined>(undefined);
  $effect(() => {
    if (mine?.locked === true) teaser = undefined;
  });
</script>

{#snippet song(item: PickerItem, live: boolean)}<SongSlide {item} {spectrum} {live} />{/snippet}

<!-- Mounted once the songs are known, so it opens on the seat's focus. -->
{#if items.length > 0}
<FullscreenPicker
  onReveal={(id: string) => access.progress?.reveal?.(`song:${id}`)}
  onTeaser={(id: string) => (teaser = content?.packs.find((pack) => pack.dlc && pack.songs.some((song) => song === id)))}
  labels={{ kind: m.select_song_kind(), previous: m.select_song_previous(), next: m.select_song_next(), group: m.select_song_group() }}
  heading={m.select_song_heading()}
  seconds={secondsLeft(snapshot)}
  {items}
  focusedId={mine?.focus}
  rows={distinctPicks(playerRows(snapshot, content, artSrc, localPlayerId, "song"))}
  locked={mine?.locked ?? false}
  {onPick}
  {onLockIn}
  {onView}
  slide={song}
/>
{/if}

{#if teaser !== undefined && content !== undefined}
  <ComingSoonSheet pack={teaser} {content} {artSrc} onClose={() => (teaser = undefined)} />
{/if}
