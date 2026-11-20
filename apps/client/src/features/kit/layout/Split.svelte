<script lang="ts">
  /**
   * Two panels side by side where both fit at `min` css px, stacked
   * otherwise (UI layout system spec §5). Measured, because a container
   * query cannot read a prop; stacked until the first measurement.
   */
  import type { Snippet } from "svelte";
  import { observeWidth } from "../../../lib/observe-size";
  import { splitMode } from "./split";

  let {
    min,
    gap = 16,
    ratio = "1fr 1fr",
    first,
    second,
  }: { min: number; gap?: number; ratio?: string; first: Snippet; second: Snippet } = $props();

  let root: HTMLElement | undefined = $state();
  let mode = $state<"row" | "stack">("stack");

  $effect(() => {
    if (root === undefined) return;
    return observeWidth(root, (width) => (mode = splitMode(width, min, gap)));
  });
</script>

<div
  bind:this={root}
  class="ff-split"
  data-split={mode}
  style:gap={`${gap}px`}
  style:grid-template-columns={mode === "row" ? ratio : "minmax(0, 1fr)"}
>
  <div class="ff-split__pane">{@render first()}</div>
  <div class="ff-split__pane">{@render second()}</div>
</div>

<style>
  .ff-split {
    display: grid;
    min-width: 0;
    min-height: 0;
  }

  .ff-split__pane {
    min-width: 0;
    min-height: 0;
    display: grid;
  }
</style>
