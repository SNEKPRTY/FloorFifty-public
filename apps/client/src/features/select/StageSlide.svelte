<script lang="ts">
  /**
   * One stage in the fullscreen picker (select spec §6.8): its preview still,
   * filling the scene and slowly panned; or the Random slide. No caption:
   * the panel's headline names it, as the showcase's does. A locked or DLC
   * stage is dimmed or greyed, with its badge.
   */
  import * as m from "../../paraglide/messages.js";
  import type { PickerItem } from "./picker-model";
  import { revealOnce } from "../kit/reveal";
  import AsyncImage from "../kit/AsyncImage.svelte";
  let { item, pan }: { item: PickerItem; pan: boolean } = $props();
</script>

<div class="ff-slide" data-testid="stage-slide" data-state={item.state} data-pan={pan ? "pan" : "still"} use:revealOnce={item.isNew === true}>
  {#if item.id === "?"}
    <div class="ff-slide__random" aria-hidden="true">?</div>
  {:else if item.art !== undefined}
    <AsyncImage src={item.art} class="ff-slide__still" fit="cover" />
  {/if}
  {#if item.state === "locked"}<span class="ff-slide__badge" aria-hidden="true">🔒</span>{/if}
  {#if item.state === "dlc"}<span class="ff-slide__badge ff-slide__badge--pill">{m.select_dlc()}</span>{/if}
  {#if item.isNew === true}<span data-testid="stage-slide-new" class="ff-slide__badge ff-slide__badge--pill ff-slide__badge--new">{m.select_new()}</span>{/if}
</div>

<style>
  .ff-slide {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    /* No ground of its own: the picker's glass backing shows behind the art while it loads. */
  }
  /* The still's frame and image are `AsyncImage`'s, outside this scope. */
  .ff-slide :global(.ff-slide__still) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  .ff-slide :global(.ff-slide__still img) {
    object-position: 50% 50%;
  }
  .ff-slide[data-pan="pan"] :global(.ff-slide__still img) {
    animation: ff-slide-pan 18s ease-in-out infinite alternate;
  }
  @keyframes ff-slide-pan {
    from {
      object-position: 0% 50%;
    }
    to {
      object-position: 100% 50%;
    }
  }
  .ff-slide[data-state="locked"] :global(.ff-slide__still) {
    filter: saturate(0.55) brightness(0.8);
  }
  .ff-slide[data-state="dlc"] :global(.ff-slide__still) {
    filter: grayscale(1) brightness(0.9);
  }
  .ff-slide__random {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 600 round(down, clamp(64px, 18vmin, 160px), var(--ff-type-hint)) / 1 var(--ff-font-ui);
    color: var(--ff-text);
  }
  .ff-slide__badge {
    position: absolute;
    top: 12px;
    right: 12px;
    font-size: var(--ff-type-title);
  }
  .ff-slide__badge--pill {
    padding: 2px 10px;
    border-radius: 6px;
    background: var(--ff-panel-border);
    color: white;
    font: 600 var(--ff-type-hint) / 1.4 var(--ff-font-ui);
  }
  .ff-slide__badge--new {
    background: var(--ff-plain);
  }
  /* The first sight of an earned item (unlockables spec §7.2): a flip, or a
     fade under reduced motion. */
  .ff-slide:global([data-reveal="flip"]) {
    animation: ff-reveal-flip 400ms steps(8) both;
  }
  .ff-slide:global([data-reveal="fade"]) {
    animation: ff-reveal-fade 200ms linear both;
  }
  @keyframes ff-reveal-flip {
    from {
      transform: perspective(600px) rotateY(180deg);
    }
    to {
      transform: none;
    }
  }
  @keyframes ff-reveal-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
