<script lang="ts">
  /**
   * The connection indicator.
   *
   * During a disconnect the race canvas stays exactly where it was and this
   * appears over it. Tearing the canvas down would throw away the last thing
   * the player saw and make a recovered race feel like a new one; the rule is
   * that a transport problem changes what is said, never what is drawn.
   *
   * `aria-live="polite"` rather than assertive: a reconnect is worth announcing
   * but never worth interrupting, and it can change several times in a few
   * seconds while the transport settles.
   *
   * Rendered always and hidden when healthy, rather than conditionally
   * rendered. A live region has to be in the document before the text changes,
   * or a screen reader has nothing to observe and announces nothing.
   */
  import type { ConnectionState } from "./network";
  import { CONNECTION_LABELS } from "./connection-labels";
  import Notice from "../kit/Notice.svelte";

  let { state }: { state: ConnectionState } = $props();

  /** States worth interrupting a player for. A healthy connection says nothing. */
  const VISIBLE: readonly ConnectionState[] = ["connecting", "reconnecting", "offline"];

  const hidden = $derived(!VISIBLE.includes(state));
</script>

<!-- Above the race HUD (z 3), which mounts after it: a dropped connection is
     the one thing the timer must never cover. -->
<Notice
  testId="connection-state"
  tone={state === "offline" ? "problem" : "info"}
  message={CONNECTION_LABELS[state]()}
  extra={{ "data-centre-in-race": "true", "data-state": state, "data-breathing": String(state === "reconnecting") }}
  {hidden}
  layer={5}
/>

<style>
  /* While reconnecting it breathes, in steps and on opacity alone, and stops
     the moment the connection is back (polish spec §6). The word is the
     signal; the breath only says the wait is live. */
  :global([data-breathing="true"]) {
    animation: ff-breathe 1.2s steps(4) infinite;
  }

  @keyframes ff-breathe {
    50% {
      opacity: 0.6;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global([data-breathing="true"]) {
      animation: none;
    }
  }
</style>
