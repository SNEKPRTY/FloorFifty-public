<script lang="ts">
  /**
   * The one-time swipe coach (spec §3.1.3).
   *
   * Shown once per device, the first race with swipe steering on, and gone
   * for good on OK or on the first touch anywhere: a player who has
   * started steering has already understood it. The thumb demo is CSS on the
   * render clock, never the simulation, and plays three times; with reduced
   * motion it is a still toast.
   */
  import * as m from "../../paraglide/messages.js";
  import { onMount } from "svelte";
  import Button from "../kit/Button.svelte";
  import Panel from "../kit/Panel.svelte";

  let { onDismiss, endless = false }: { onDismiss: () => void; endless?: boolean } = $props();
  let open = $state(true);

  function dismiss(): void {
    if (!open) return;
    open = false;
    onDismiss();
  }

  onMount(() => {
    // Capture, so the touch that starts steering also retires the coach
    // without the surface having to know it exists.
    const onPointer = (): void => dismiss();
    window.addEventListener("pointerdown", onPointer, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointer, { capture: true });
  });
</script>

{#if open}
  <!-- A small toast, not a card: the course stays in view behind it, and the
       only part a thumb can hit is the OK, at the 44 px touch floor. -->
  <Panel
    tone="hud"
    role="note"
    data-testid="swipe-coach"
    class="ff-swipe-coach ff-aq-secondary pointer-events-auto text-aq-ink"
  >
    <div class="ff-swipe-coach__track" aria-hidden="true">
      <span class="ff-swipe-coach__thumb"></span>
    </div>
    <p class="m-0">{endless ? m.shell_swipe_coach_survival() : m.shell_swipe_coach()}</p>
    <Button kind="ghost" data-testid="swipe-coach-dismiss" data-sfx="back" class="ff-swipe-coach__ok" onclick={dismiss}>{m.shell_ok()}</Button>
  </Panel>
{/if}

<style>
  :global(.ff-swipe-coach) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: min(24rem, 100%);
    padding: 4px 2px 4px 14px;
    font-size: var(--ff-type-hint);
    line-height: 1.3;
  }
  :global(.ff-swipe-coach__ok) {
    flex: none;
    padding: 0 8px;
    font-size: var(--ff-type-hint);
  }
  .ff-swipe-coach__track {
    position: relative;
    flex: none;
    width: 40px;
    height: 3px;
    background: color-mix(in srgb, var(--ff-text) 25%, transparent);
    border-radius: 2px;
  }
  .ff-swipe-coach__thumb {
    position: absolute;
    top: -5px;
    left: 15px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ff-plain);
    animation: ff-swipe-coach-drag 1.6s ease-in-out 3;
  }
  /* A 320 px screen needs the room for the words: the demo goes. */
  @media (max-width: 400px) {
    .ff-swipe-coach__track { display: none; }
    :global(.ff-swipe-coach) { padding-left: 12px; gap: 8px; }
  }
  @keyframes ff-swipe-coach-drag {
    0%,
    100% {
      transform: translateX(0);
    }
    30% {
      transform: translateX(-14px);
    }
    70% {
      transform: translateX(14px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ff-swipe-coach__thumb {
      animation: none;
    }
  }
</style>
