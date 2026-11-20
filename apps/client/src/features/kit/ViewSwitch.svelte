<script lang="ts">
  /**
   * The one way a panel shows view A and then view B (audit: the pause and
   * settings views swapped by a cut). The new view cross-fades in over
   * `SCREEN_FADE_MS` while the old one fades out, nothing sliding. The leaving
   * view is `inert` from its first frame and lifted out of the flow, so the
   * two overlap instead of stacking and the new view takes input at once.
   */
  import type { Snippet } from "svelte";
  import { fadeIn, fadeOut } from "./motion";

  let { view, class: className = "", children }: { view: string; class?: string; children: Snippet<[string]> } = $props();
</script>

<div class="ff-view-switch {className}">
  {#key view}
    <div class="ff-view" data-view={view} in:fadeIn out:fadeOut>{@render children(view)}</div>
  {/key}
</div>

<style>
  .ff-view-switch {
    position: relative;
    display: grid;
    min-width: 0;
  }
  .ff-view {
    min-width: 0;
  }
  .ff-view:global([inert]) {
    position: absolute;
    inset: 0;
  }
</style>
