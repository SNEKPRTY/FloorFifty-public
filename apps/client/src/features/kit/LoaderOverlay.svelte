<script lang="ts">
  /**
   * The loader between screens (launch polish §3.1.5): the race's bundles'
   * real progress, over the stage, with what is loading said in words. It
   * sits above the liquid veil (`layer`, the render feature's `LOADER_Z`, which the caller passes), because the moves that load a
   * race are the ones the veil covers; after eight seconds a quiet line says
   * it is slow, not failing.
   */
  import * as m from "../../paraglide/messages.js";
  import type { MonotonicProgress, Readiness } from "../profile/progress.svelte";
  import { fadeIn, fadeOut } from "./motion";
  import ProgressBar from "./ProgressBar.svelte";

  let { progress, label, slow, layer }: { progress: MonotonicProgress; label: string; slow?: Readiness; layer: number } = $props();
</script>

<!-- Fades in and out over `SCREEN_FADE_MS`; global, as it is shown by the caller's `{#if}`. -->
<div
  data-testid="loader-overlay"
  in:fadeIn|global
  out:fadeOut|global
  style:z-index={layer}
  class="ff-loader ff-screen grid place-content-center justify-items-center gap-12 font-ui"
>
  <p class="ff-aq-body ff-loader__label m-0">{label}</p>
  <ProgressBar {progress} testId="loader-progress" />
  <p class="ff-aq-secondary ff-loader__label ff-loader__slow m-0" aria-live="polite" data-testid="loader-slow">
    {#if slow?.ready}{m.shell_loading_slow()}{/if}
  </p>
</div>

<style>
  .ff-loader {
    inset: 0;
    background: color-mix(in srgb, var(--ff-panel-border) 55%, transparent);
  }

  .ff-loader__label {
    color: var(--ff-text);
  }

  /* Holds its line's height, so the label and the bar do not shift when it comes. */
  .ff-loader__slow {
    min-height: 1.4em;
    text-align: center;
  }
</style>
