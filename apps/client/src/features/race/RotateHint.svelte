<script lang="ts">
  /**
   * "Turn your phone for a bigger view", once, in portrait (spec 2.5).
   *
   * Landscape is still the better way to play on a phone, and saying so once
   * is kinder than leaving a player to find out. A small toast under the race
   * timer rather than a row in the ready room: the room is where the player
   * reads the code, and a race held upright is where the advice applies. It
   * fades on its own after a few seconds, and either way it has been said:
   * dismissed for good on this device; without storage, for this visit. The
   * flag is one of the settings' "seen" flags (§3.1.2), read and written
   * through the one store: a write around it was overwritten by the store's
   * next save.
   */
  import * as m from "../../paraglide/messages.js";
  import { onMount } from "svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import Button from "../kit/Button.svelte";
  import Toast from "../kit/Toast.svelte";

  let {
    portrait,
    settings,
    lingerMs = ROTATE_HINT_LINGER_MS,
  }: { portrait: boolean; settings: SettingsStore; lingerMs?: number } = $props();

  const dismissed = $derived(settings.value.seen.rotateHint);

  function dismiss(): void {
    if (dismissed) return;
    settings.update({ seen: { rotateHint: true } });
  }

  onMount(() => {
    if (!portrait || dismissed) return;
    const timer = setTimeout(dismiss, lingerMs);
    return () => clearTimeout(timer);
  });
</script>

<script lang="ts" module>
  /** How long the toast stays before it retires itself. */
  export const ROTATE_HINT_LINGER_MS = 6000;
</script>

{#if portrait && !dismissed}
  <!-- Small, and under the timer: the course below stays clear, and the only
       part a thumb can hit is the OK, at the 44 px touch floor. A kit toast: it
       rises in and falls out as it retires. -->
  <Toast tone="menu" data-testid="rotate-hint" role="note" class="ff-rotate-toast ff-aq-secondary text-aq-ink">
    <span aria-hidden="true" class="ff-rotate-toast__icon">⟳</span>
    <span>{m.shell_rotate_hint()}</span>
    <Button kind="ghost" data-testid="rotate-hint-dismiss" data-sfx="back" class="ff-rotate-toast__ok" aria-label={m.shell_rotate_dismiss()} onclick={dismiss}>{m.shell_ok()}</Button>
  </Toast>
{/if}

<style>
  /* `:global`: these classes land on the kit toast's and button's own roots. */
  :global(.ff-rotate-toast) {
    display: flex;
    align-items: center;
    gap: 4px;
    width: max-content;
    max-width: 100%;
    padding: 0 2px 0 12px;
    font-size: var(--ff-type-hint);
    white-space: nowrap;
  }

  .ff-rotate-toast__icon {
    font-size: var(--ff-type-hint);
    line-height: 1;
  }

  :global(.ff-rotate-toast__ok) {
    min-width: var(--ff-aq-target);
    min-height: var(--ff-aq-target);
    padding: 0 8px;
    /* The HUD takes no pointer; the OK is the one part of the hint a thumb can hit. */
    pointer-events: auto;
  }
</style>
