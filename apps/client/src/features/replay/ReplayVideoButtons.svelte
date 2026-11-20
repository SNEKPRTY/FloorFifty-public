<script lang="ts">
  /**
   * Save video and Share video (unlockables spec §6.4, amended): two buttons
   * that are pictures only (Owner, 2026-11-19; the name is the label), on the replay window's right edge, under
   * the HUD, clear of the bar. They stay visible while the bar steps aside.
   * Disabled with the visible reason when this race has no video. The note
   * and the share's outcome are said in notices placed with the buttons
   * (beside them on wide windows, under them on narrow ones), the outcome
   * one always in the document so it is heard when it changes.
   */
  import * as m from "../../paraglide/messages.js";
  import IconButton from "../kit/IconButton.svelte";
  import Notice from "../kit/Notice.svelte";
  import type { ReplayShare } from "./replay-share.svelte";

  let { share, available, top }: { share: ReplayShare; available: boolean; top: number } = $props();

  /** How long a tick stands in for the picture once a save or share has gone through. */
  const DONE_MS = 1400;
  let saved = $state(false);
  let shared = $state(false);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function tick(set: (on: boolean) => void): void {
    set(true);
    const timer = setTimeout(() => {
      timers.delete(timer);
      set(false);
    }, DONE_MS);
    timers.add(timer);
  }
  $effect(() => () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
  function save(): void {
    share.save();
    tick((on) => (saved = on));
  }
  async function send(): Promise<void> {
    // Only a share that went through earns the tick: not a cancel, a refusal or a second press.
    if (await share.share()) tick((on) => (shared = on));
  }
</script>

<div class="ff-replay-video" data-testid="replay-video" style:--ff-replay-video-top="{top}px">
  <div class="ff-replay-video__buttons">
    <!-- Ruken's frame blocks downloads, so there only Share is offered. -->
    {#if share.canSave}
      <IconButton
        icon="download"
        label={m.replay_save_video()}
        class="ff-replay-video__button"
        data-testid="replay-save-video"
        disabled={!available}
        done={saved}
        onclick={save}
      />
    {/if}
    <IconButton
      icon="share"
      label={m.replay_share_video()}
      class="ff-replay-video__button"
      data-testid="replay-share-video"
      disabled={!available}
      done={shared}
      onclick={() => void send()}
    />
  </div>
  {#if !available}
    <p class="ff-aq-label ff-replay-video__line" data-testid="replay-video-unavailable">{m.replay_video_unavailable()}</p>
  {/if}

  <!-- What the player is told: the share's outcome first, else the note that
       videos show everyone's names. -->
  <Notice
    testId="replay-share-note"
    extra={{ "data-replay-share": "" }}
    tone="info"
    message={share.note ?? ""}
    hidden={share.note === undefined || (share.status ?? "") !== ""}
    onClose={() => share.dismiss()}
  />
  <Notice
    testId="replay-share-status"
    extra={{ "data-replay-share": "" }}
    tone={share.refused ? "problem" : "info"}
    message={share.status ?? ""}
    hidden={(share.status ?? "") === ""}
    onClose={() => share.dismiss()}
  />
</div>

<style>
  .ff-replay-video {
    position: absolute;
    top: var(--ff-replay-video-top);
    right: max(12px, env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    max-width: min(60vw, 18rem);
    pointer-events: none;
  }
  .ff-replay-video__buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    pointer-events: auto;
  }
  .ff-replay-video__line {
    margin: 0;
    text-align: right;
  }
  /* A narrow screen: the share answer is the next thing in the buttons' column, under
     them and never over them, however big the screen or short the band. */
  .ff-replay-video :global(.ff-notice[data-replay-share]) {
    position: relative;
    inset: auto;
    margin: 0;
    width: auto;
    max-width: 100%;
    pointer-events: auto;
  }
  /* Wide, there is no height under the buttons (the bar is there), so the
     answer stands to their left, level with them. */
  @media (min-width: 521px) {
    .ff-replay-video :global(.ff-notice[data-replay-share]) {
      position: absolute;
      top: 0;
      right: calc(100% + 8px);
      width: max-content;
      max-width: min(22rem, calc(100vw - 18rem - 40px));
    }
  }
</style>
