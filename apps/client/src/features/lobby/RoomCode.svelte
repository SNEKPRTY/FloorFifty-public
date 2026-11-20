<script lang="ts">
  /**
   * The room's code and Copy (UI layout spec §6.3), in the frame's corner row
   * between Back's place and Mute (on the centre line, or at the panel's left
   * edge in a portrait room), so a short screen spends no row of its own
   * on them. Copy says so for a moment, and the status line says so in words.
   */
  import * as m from "../../paraglide/messages.js";
  import type { NetworkPort } from "../net/network";
  import { copyText } from "../../lib/clipboard";
  import { CONFIRM_MS, confirm } from "../kit/motion";
  import Button from "../kit/Button.svelte";
  import Panel from "../kit/Panel.svelte";
  import type { RoomStore } from "../net/store/room-store.svelte";
  import { requestUiSound } from "../kit/ui-sounds";

  let {
    store,
    network,
    setStatus,
  }: { store: RoomStore; network: NetworkPort; setStatus: (message: () => string, tone?: "info" | "error") => void } = $props();

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let copyButton: HTMLButtonElement | undefined = $state();
  let confirming: ReturnType<typeof confirm> | undefined;

  // Copy swaps to its confirmation and back (`confirm`), driven from here because the kit's button is a component.
  $effect(() => {
    const active = copied;
    if (copyButton === undefined) return;
    if (confirming === undefined) confirming = confirm(copyButton, { active });
    else confirming.update({ active });
  });

  function copyCode(): void {
    // The code on screen, which is the one the player means to share.
    const value = store.roomCode ?? network.roomCode ?? "";
    copyText(value).then(
      () => {
        setStatus(() => m.ready_room_code_copied());
        if (copyButton !== undefined) requestUiSound(copyButton, "copied");
        copied = true;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => (copied = false), CONFIRM_MS);
      },
      () => setStatus(() => m.ready_room_code_copy_failed(), "error"),
    );
  }

  $effect(() => () => clearTimeout(copiedTimer));
</script>

<Panel order={1} class="ff-room-code flex min-w-0 items-center justify-start gap-8">
  <span class="ff-aq-label m-0">{m.lobby_room_code()}</span>
  <code data-testid="room-code" class="ff-aq-code">{store.roomCode ?? ""}</code>
  <!-- Swaps to its confirmation and back, never changing width: both labels
       share one cell (`confirm`, polish spec §5.1). Quiet, but for its own
       ui.copied. -->
  <Button
    bind:ref={copyButton}
    data-testid="copy-code"
    data-copied={String(copied)}
    data-sfx="none"
    onclick={copyCode}
    class="ff-copy shrink-0"
  >
    <span data-confirm-label="idle">{m.ready_copy()}</span>
    <span data-confirm-label="done">{m.ready_copied()}<span aria-hidden="true"> ✓</span></span>
  </Button>
</Panel>

<style>
  /* The code row is the one glass panel (review R11: the code stood on the
     bright sky with no plate), so its words need no outline. The label is
     body size and white, beside a code it introduces. */
  :global(.ff-room-code) {
    padding: 4px 4px 4px 10px;
    border-radius: 8px;
  }
  :global(.ff-room-code) :global(.ff-aq-label),
  :global(.ff-room-code) :global(.ff-aq-code) {
    line-height: 1;
    color: var(--ff-text);
  }
  :global(.ff-room-code) :global(.ff-aq-label) {
    margin-bottom: 0;
  }
  /* Japanese and Chinese may break between any two characters: the label
     would stand one character to a line beside the code. It stays whole. */
  :global(:root:is(:lang(ja), :lang(zh-Hans)) .ff-room-code) :global(.ff-aq-label) {
    word-break: keep-all;
  }
  /* The code takes the room its row has: a code of wide letters (W W W W W W)
     at the full 24 px ran Copy under Mute on a 430 px phone upright. Its
     letter spacing is in ems, so it closes up with it. */
  :global(.ff-room-code) :global(.ff-aq-label),
  :global(.ff-room-code) :global(.ff-aq-code) {
    font-size: round(down, clamp(16px, 6cqw, 24px), var(--ff-type-hint));
  }
  /* A narrow row sets the label over the code, on one line, rather than
     beside it: with a code of wide letters, label, code and Copy side by side
     ran Copy under Mute on a phone upright in Spanish (430 px and 375 px).
     Two short lines fit the corner row's height. */
  @container (max-width: 340px) {
    /* No padding above and below: the plate is Copy's height, so the corner
       row stays a touch target tall and the panel under it keeps Leave room
       on screen (SE upright, es-419). Copy's word at body size, not large. */
    :global(.ff-room-code) {
      padding-block: 0;
      display: grid;
      grid-template-columns: auto auto;
      column-gap: 8px;
      justify-content: start;
    }
    :global(.ff-room-code) :global(.ff-aq-label) {
      grid-area: 1 / 1;
      white-space: nowrap;
    }
    :global(.ff-room-code) :global(.ff-aq-code) {
      grid-area: 2 / 1;
    }
    :global(.ff-room-code) :global(.ff-copy) {
      grid-area: 1 / 2 / span 2 / 2;
      align-self: center;
      font-size: var(--ff-type-body);
    }
  }
  /* A tighter row draws the code closer: still spaced, never truncated. The
     row has the room between the panel's edge and Mute, which on the smallest
     phone is under 210px with the longest languages, so Copy gives up its
     tick and some padding (its word still says it was copied). */
  @container (max-width: 300px) {
    :global(.ff-room-code) {
      gap: 4px;
    }
    :global(.ff-room-code) :global(.ff-aq-label),
    :global(.ff-room-code) :global(.ff-aq-code) {
      font-size: var(--ff-type-hint);
    }
    :global(.ff-room-code) :global(.ff-aq-code) {
      letter-spacing: 0.15em;
    }
    :global(.ff-room-code) :global(.ff-copy) {
      padding-inline: 6px;
    }
    :global(.ff-room-code) :global(.ff-copy [aria-hidden="true"]) {
      display: none;
    }
  }
</style>
