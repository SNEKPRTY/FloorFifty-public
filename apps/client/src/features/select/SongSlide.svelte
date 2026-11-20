<script lang="ts">
  /**
   * One song in the fullscreen picker (select spec §6.2, §6.8): a music
   * player. The cover large and an equaliser drawn from the
   * preview's analyser. No title caption: the panel's headline names the
   * song, as it names a stage. A cover that is missing or fails to load leaves
   * a navy plate with the title on it, so the slide is never blank (Review
   * Focus 5). A locked song is a navy silhouette with a padlock and its hint;
   * a DLC song is greyed, with its pill. Random is a quiet "?".
   */
  import * as m from "../../paraglide/messages.js";
  import { RANDOM_PICK } from "@floor-fifty/shared/common/constants";
  import type { MusicSpectrum } from "../audio";
  import type { PickerItem } from "./picker-model";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import Equaliser from "../kit/Equaliser.svelte";
  import { revealOnce } from "../kit/reveal";

  let { item, spectrum, live }: { item: PickerItem; spectrum: () => MusicSpectrum | undefined; live: boolean } = $props();

  // A cover that fails to load is `AsyncImage`'s to catch; it then draws the same plate.
  const plate = $derived(item.art === undefined);
</script>

<div class="ff-song-slide" data-testid="song-slide" data-state={item.state} use:revealOnce={item.isNew === true}>
  {#if item.id === RANDOM_PICK}
    <div class="ff-song-slide__random" aria-hidden="true">?</div>
  {:else}
    <div class="ff-song-slide__player">
      <div class="ff-song-slide__cover" data-testid="song-slide-cover">
        {#snippet titlePlate()}<span class="ff-song-slide__plate" data-testid="song-slide-title">{item.label}</span>{/snippet}
        {#if plate}
          {@render titlePlate()}
        {:else}
          <!-- No tone: the cover's navy is the placeholder, and a failure's plate is drawn on it. -->
          <AsyncImage src={item.art!} class="ff-song-slide__art" fit="cover" tone="none" fallback={titlePlate} />
        {/if}
        {#if item.state === "locked"}<span class="ff-song-slide__lock" aria-hidden="true">🔒</span>{/if}
        {#if item.state === "dlc"}<span class="ff-song-slide__pill">{m.select_dlc()}</span>{/if}
        {#if item.isNew === true}<span data-testid="song-slide-new" class="ff-song-slide__pill ff-song-slide__pill--new">{m.select_new()}</span>{/if}
      </div>
      <div class="ff-song-slide__meta">
        {#if item.state === "locked"}
          <span class="ff-song-slide__line" data-testid="song-slide-hint">{item.reason ?? ""}</span>
        {:else}
          {#if item.state === "open"}<Equaliser {spectrum} still={!live} />{/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .ff-song-slide {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    /* The cover's size reads the scene's own box (cqw, cqh), so one rule fits
       a tablet's tall scene and a phone's sideways strip alike. */
    container-type: size;
    /* No ground of its own: the picker's glass backing shows behind the art while it loads. */
  }
  .ff-song-slide__player {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    padding: 18px 0;
  }
  .ff-song-slide__cover {
    position: relative;
    /* As large as the scene allows: its height less the line under it
       (18 + 12 + 28 + 18), its width less an arrow and a gap either side. */
    width: max(64px, min(calc(100cqh - 76px), calc(100cqw - 2 * (var(--ff-aq-target) + 20px))));
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--ff-control-radius);
    box-shadow: none;
    background: var(--ff-panel-border);
  }
  /* The cover's frame and image are `AsyncImage`'s, outside this scope. */
  .ff-song-slide__cover :global(.ff-song-slide__art) {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  /* The navy plate a missing cover leaves, with the title on it. */
  .ff-song-slide__plate {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 12px;
    text-align: center;
    font: 600 round(down, clamp(16px, 10cqmin, 32px), var(--ff-type-hint)) / 1.1 var(--ff-font-ui);
    color: var(--ff-text);
  }
  /* Locked: a navy silhouette, not black, so it still belongs to the palette. */
  .ff-song-slide[data-state="locked"] .ff-song-slide__cover :global(img) {
    filter: grayscale(1) contrast(1.2);
  }
  .ff-song-slide[data-state="locked"] .ff-song-slide__cover::after {
    content: "";
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--ff-panel-border) 85%, transparent);
  }
  .ff-song-slide[data-state="dlc"] .ff-song-slide__cover :global(img) {
    filter: grayscale(1) brightness(0.9);
  }
  .ff-song-slide__lock {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    font-size: round(down, clamp(24px, 12cqmin, 48px), var(--ff-type-hint));
  }
  .ff-song-slide__pill {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    padding: 2px 10px;
    border-radius: 6px;
    background: var(--ff-panel-border);
    color: white;
    font: 600 var(--ff-type-hint) / 1.4 var(--ff-font-ui);
  }
  .ff-song-slide__pill--new {
    background: var(--ff-plain);
  }
  /* The first sight of an earned item (unlockables spec §7.2): a flip, or a
     fade under reduced motion. */
  .ff-song-slide:global([data-reveal="flip"]) {
    animation: ff-reveal-flip 400ms steps(8) both;
  }
  .ff-song-slide:global([data-reveal="fade"]) {
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
  .ff-song-slide__meta {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 28px;
  }
  .ff-song-slide__line {
    font: 600 var(--ff-type-hint) / 1.2 var(--ff-font-ui);
    color: var(--ff-text);
    white-space: nowrap;
  }
  /* A short scene (a small phone held upright gives it 80 px): the line
     stands beside the cover, not under it, where a stacked pair overflowed
     the scene and the hint was drawn behind the cover. The cover takes the
     scene's height; the line wraps in the room left between the arrows. */
  @container (max-height: 160px) {
    .ff-song-slide__player {
      grid-auto-flow: column;
      grid-template-columns: auto minmax(0, max-content);
      align-items: center;
      gap: 10px;
      padding: 8px calc(var(--ff-aq-target) + 16px);
    }
    .ff-song-slide__cover { width: max(48px, calc(100cqh - 16px)); }
    .ff-song-slide__line { white-space: normal; text-align: start; }
  }
  .ff-song-slide__random {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 600 round(down, clamp(64px, 18vmin, 160px), var(--ff-type-hint)) / 1 var(--ff-font-ui);
    color: var(--ff-text);
  }
</style>
