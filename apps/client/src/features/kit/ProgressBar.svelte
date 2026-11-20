<script lang="ts">
  /**
   * The load bar the splash and the race loader share (launch polish §3.1.5).
   * A real `progressbar` whose value is the bundle's own progress: it never
   * runs on a timer and never moves backwards (`MonotonicProgress`). The fill
   * eases between reports, except for a player who asked for less motion.
   */
  import * as m from "../../paraglide/messages.js";
  import type { MonotonicProgress } from "../profile/progress.svelte";
  import Panel from "./Panel.svelte";

  let { progress, testId }: { progress: MonotonicProgress; testId: string } = $props();
  const percent = $derived(Math.round(progress.value * 100));
</script>

<Panel
  role="progressbar"
  aria-label={m.shell_loading()}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={percent}
  data-testid={testId}
  data-complete={String(progress.value >= 1)}
  class="ff-progress"
>
  <div class="ff-progress__fill" style:width={`${percent}%`}></div>
</Panel>

<style>
  /* A glass pill (the one panel rule) with the white fill inside it, never a bare line. */
  :global(.ff-progress) {
    box-sizing: content-box;
    width: min(280px, 70vw);
    height: 8px;
    padding: 4px;
    overflow: hidden;
  }

  /* The fill steps between reports rather than gliding (polish spec §6). */
  .ff-progress__fill {
    position: relative;
    height: 100%;
    background: var(--ff-text);
    transition: width 160ms steps(4);
  }

  /* A full bar glints once: a white band crossing the fill in a few frames.
     A shape moving, never a colour tween. */
  .ff-progress__fill::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 24px;
    background: var(--ff-text);
    opacity: 0;
  }
  :global([data-complete="true"]) .ff-progress__fill::after {
    animation: ff-glint 240ms steps(6) both;
  }

  @keyframes ff-glint {
    from {
      opacity: 0.8;
      transform: translateX(-24px);
    }
    to {
      opacity: 0;
      transform: translateX(280px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-progress__fill {
      transition: none;
    }
    :global([data-complete="true"]) .ff-progress__fill::after {
      animation: none;
    }
  }
</style>
