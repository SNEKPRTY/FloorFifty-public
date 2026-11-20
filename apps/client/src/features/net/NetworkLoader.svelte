<script lang="ts">
  /**
   * The loader for a request to the server (`NetworkActivity`).
   *
   * Two parts on two clocks. The scrim is up the moment a request goes out, so
   * nothing under it can be pressed twice while the server decides. The
   * spinner waits `SPINNER_DELAY_MS` first: most answers arrive inside it, and
   * a spinner that flashes for a frame on every Ready reads as a stutter, not
   * as progress.
   *
   * Rendered always and hidden when idle, as the connection indicator is, so
   * the live region is in the document before its text changes.
   */
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";
  import type { NetworkActivity } from "./store/network-activity.svelte";

  let { activity }: { activity: NetworkActivity } = $props();

  const SPINNER_DELAY_MS = 200;

  let spinning = $state(false);
  $effect(() => {
    if (!activity.busy) {
      spinning = false;
      return;
    }
    const timer = setTimeout(() => (spinning = true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  });
</script>

<div data-testid="network-loader" class="ff-net-loader" hidden={!activity.busy} aria-busy={activity.busy}>
  <!-- Comes and goes with the spinner's delay, so it neither rises nor falls itself. -->
  <Panel tone="hud" arrive="none" leave="none" class="ff-net-loader__badge" hidden={!spinning} role="status" aria-live="polite">
    <span class="ff-net-loader__spinner" aria-hidden="true"></span>
    <span>{m.shell_working()}</span>
  </Panel>
</div>

<style>
  /* Over everything a request can come from, modals included (z 50). */
  .ff-net-loader {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-content: center;
    /* Clear, not dimmed: the scrim is there to catch a second tap, and the
       screen under it has not changed. */
    background: transparent;
  }

  :global(.ff-net-loader__badge) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    color: var(--ff-text);
    font-size: var(--ff-type-hint);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  /* A ring turned in eight steps, as the chrome's motion is (`STEP_EASE`). */
  .ff-net-loader__spinner {
    width: 14px;
    height: 14px;
    border: 3px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: ff-net-spin 800ms steps(8) infinite;
  }

  @keyframes ff-net-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-net-loader__spinner {
      animation: none;
    }
  }

  /* `hidden` is only a weak default in CSS, and `display` is set above. */
  [hidden],
  :global(.ff-net-loader__badge[hidden]) {
    display: none;
  }
</style>
