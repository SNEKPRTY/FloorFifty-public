<script lang="ts">
  /**
   * The stage step (select spec §6.2, amended 2026-09-30): one stage at a
   * time on the fullscreen picker (§6.8), swiped; on screen is the pick.
   */
  import * as m from "../../paraglide/messages.js";
  import { type AccessOptions } from "../profile/access";
  import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import { stageItems, type PickerItem } from "./picker-model";
  import { distinctPicks, playerRows, secondsLeft } from "./select-model";
  import FullscreenPicker from "./FullscreenPicker.svelte";
  import ComingSoonSheet from "./ComingSoonSheet.svelte";
  import type { PackContent } from "@floor-fifty/shared/content/game-content";
  import StageSlide from "./StageSlide.svelte";
  import SeedChip from "./SeedChip.svelte";
  import SeedEditor from "./SeedEditor.svelte";
  import type { SeedChoice } from "@floor-fifty/shared/room/select";

  let {
    snapshot,
    localPlayerId,
    content,
    artSrc,
    access,
    onPick,
    onLockIn,
    onSeed,
    lastSeed = undefined,
  }: {
    snapshot: RoomSnapshot;
    localPlayerId: string | undefined;
    content: GameContentPayload | undefined;
    artSrc: (alias: string) => string | undefined;
    access: AccessOptions;
    onPick: (id: string) => void;
    onLockIn: () => void;
    /** The seat's seed choice (stage seeds spec §4.1). */
    onSeed: (choice: SeedChoice) => void;
    lastSeed?: number | undefined;
  } = $props();

  const mine = $derived(localPlayerId === undefined ? undefined : snapshot.select?.picks[localPlayerId]);
  const items = $derived(content === undefined ? [] : stageItems(content, artSrc, access));

  /** The Coming soon sheet a DLC slide opened; the step's clock keeps running under it (unlockables spec §7.3). */
  let teaser = $state<PackContent | undefined>(undefined);
  /** The seed editor, open (stage seeds spec §4.2); a lock closes it with the sheet. */
  let editingSeed = $state(false);
  $effect(() => {
    if (mine?.locked === true) {
      teaser = undefined;
      editingSeed = false;
    }
  });
</script>

{#snippet stage(item: PickerItem, pan: boolean)}<StageSlide {item} {pan} />{/snippet}
{#snippet seed()}<SeedChip choice={mine?.seed ?? "random"} locked={mine?.locked ?? false} onChoose={onSeed} onEdit={() => (editingSeed = true)} />{/snippet}

<!-- Mounted once the stages are known, so it opens on the seat's focus. -->
{#if items.length > 0}
<FullscreenPicker
  onReveal={(id: string) => access.progress?.reveal?.(`stage:${id}`)}
  onTeaser={(id: string) => (teaser = content?.packs.find((pack) => pack.dlc && pack.stages.some((stage) => stage === id)))}
  labels={{ kind: m.select_stage_kind(), previous: m.select_stage_previous(), next: m.select_stage_next(), group: m.select_stage_group() }}
  heading={m.select_stage_heading()}
  seconds={secondsLeft(snapshot)}
  {items}
  focusedId={mine?.focus}
  rows={distinctPicks(playerRows(snapshot, content, artSrc, localPlayerId))}
  locked={mine?.locked ?? false}
  {onPick}
  {onLockIn}
  slide={stage}
  extra={seed}
/>
{/if}

<!-- Outside the picker, as the Coming soon sheet is: the panel's glass would hold a fixed dialog inside it. -->
{#if editingSeed}
  <SeedEditor
    start={typeof mine?.seed === "number" ? mine.seed : (lastSeed ?? 0)}
    onChoose={onSeed}
    onClose={() => (editingSeed = false)}
  />
{/if}

{#if teaser !== undefined && content !== undefined}
  <ComingSoonSheet pack={teaser} {content} {artSrc} onClose={() => (teaser = undefined)} />
{/if}
