<script lang="ts">
  /**
   * One chapter on the story hub (story mode v2 spec, "The story hub"): its
   * picture (a 240 by 135 crop of its first panel), "Chapter {n}", its name,
   * three stars and its glims. A locked card is dim, with a lock and the
   * chapter to finish first.
   *
   * A glass button: a press focuses it, and a press on the focused card
   * plays it (so a pad's confirm on a card is "Play"). The focused card lifts
   * 4 px with a glow border. Stars earned on the results just closed pop in.
   * Only the chosen card is a Tab stop (the row is one stop, walked with the
   * arrows), so Tab goes from it straight to Play.
   */
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";
  import GlimIcon from "./GlimIcon.svelte";
  import StarIcon from "./StarIcon.svelte";

  let {
    number,
    title,
    art,
    stars,
    fresh = [false, false, false],
    glims,
    glimsTotal,
    locked,
    selected,
    order,
    reduced,
    ref = $bindable(),
    onPress,
    onPointerDown,
    onFocus,
  }: {
    /** From 1. */
    number: number;
    title: string;
    art: string | undefined;
    stars: readonly [boolean, boolean, boolean];
    /** Stars earned on the run just finished, which pop in. */
    fresh?: readonly [boolean, boolean, boolean];
    glims: number;
    glimsTotal: number;
    locked: boolean;
    selected: boolean;
    /** Its place in the row's rise. */
    order: number;
    reduced: boolean;
    ref?: HTMLElement | undefined;
    onPress: () => void;
    /** A pointer went down on it, before its focus. */
    onPointerDown?: () => void;
    onFocus: () => void;
  } = $props();

  let broken = $state(false);
  const earned = $derived(stars.filter(Boolean).length);
</script>

<Panel
  as="button"
  type="button"
  bind:ref
  order={order}
  arrive={reduced ? "none" : "rise"}
  leave="none"
  class="ff-chapter-card {selected ? 'ff-chapter-card--selected' : ''} {locked ? 'ff-chapter-card--locked' : ''}"
  data-testid="story-chapter-card"
  data-chapter={number}
  data-locked={locked}
  data-selected={selected}
  aria-pressed={selected}
  tabindex={selected ? 0 : -1}
  aria-label="{m.story_chapter_number({ number })}: {title}. {locked ? m.story_locked({ number: number - 1 }) : `${m.story_stars({ count: earned })}, ${m.story_glims_count({ count: glims, total: glimsTotal })}`}"
  onclick={onPress}
  onpointerdown={onPointerDown}
  onfocus={onFocus}
>
  <span class="ff-chapter-card__art" aria-hidden="true">
    {#if art !== undefined && !broken}
      <img src={art} alt="" width="240" height="135" draggable="false" onerror={() => (broken = true)} />
    {/if}
    {#if locked}
      <span class="ff-chapter-card__lock" data-testid="story-chapter-lock">
        <svg viewBox="0 0 9 9" shape-rendering="crispEdges">
          <path d="M3 0h3v1h1v3h1v5h-7v-5h1v-3h1zM3 2v2h3v-2h-1v-1h-1v1z" fill="#c7dcd0" />
          <path d="M4 5h1v2h-1z" fill="#2e222f" />
        </svg>
      </span>
    {/if}
  </span>
  <span class="ff-chapter-card__number">{m.story_chapter_number({ number })}</span>
  <span class="ff-chapter-card__title">{title}</span>
  {#if locked}
    <span class="ff-chapter-card__why">{m.story_locked({ number: number - 1 })}</span>
  {:else}
    <span class="ff-chapter-card__stars" aria-hidden="true">
      {#each stars as star, index (index)}
        <span class="ff-chapter-card__star" class:ff-chapter-card__star--fresh={fresh[index] && star && !reduced} style="--ff-star-order: {index};">
          <StarIcon earned={star} />
        </span>
      {/each}
    </span>
    <span class="ff-chapter-card__glims"><GlimIcon class="ff-chapter-card__glim" />{m.story_glims_count({ count: glims, total: glimsTotal })}</span>
  {/if}
</Panel>

<style>
  :global(.ff-chapter-card) {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: var(--ff-chapter-card-width, 240px);
    padding: 8px 8px 12px;
    border-radius: 16px;
    color: #ffffff;
    text-align: left;
    cursor: pointer;
    scroll-snap-align: center;
    transition: translate 160ms ease;
  }
  :global(.ff-chapter-card--selected) {
    translate: 0 -4px;
    border-color: #fbff86;
    box-shadow:
      0 0 0 2px #fbff86,
      0 0 24px rgba(251, 255, 134, 0.35);
  }
  :global(.ff-chapter-card:focus-visible) {
    outline: none;
  }
  :global(.ff-chapter-card--locked) .ff-chapter-card__art img {
    filter: grayscale(1) brightness(0.45);
  }
  :global(.ff-chapter-card--locked) .ff-chapter-card__title,
  :global(.ff-chapter-card--locked) .ff-chapter-card__number {
    opacity: 0.6;
  }
  .ff-chapter-card__art {
    position: relative;
    display: block;
    overflow: hidden;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-bottom: 4px;
    border-radius: 8px;
    background: #2e222f;
  }
  .ff-chapter-card__art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
  }
  .ff-chapter-card__lock {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .ff-chapter-card__lock svg {
    width: 36px;
    height: 36px;
  }
  .ff-chapter-card__number {
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
  }
  .ff-chapter-card__title {
    font-size: var(--ff-type-title);
    font-weight: 600;
    line-height: 1.2;
  }
  .ff-chapter-card__why {
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
    line-height: 1.3;
  }
  .ff-chapter-card__stars {
    display: flex;
    gap: 4px;
  }
  .ff-chapter-card__star {
    display: block;
    width: 24px;
    height: 24px;
  }
  .ff-chapter-card__star :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .ff-chapter-card__star--fresh {
    animation: ff-chapter-star-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    animation-delay: calc(360ms + var(--ff-star-order) * 350ms);
  }
  @keyframes ff-chapter-star-pop {
    from {
      opacity: 0;
      scale: 0.2;
      rotate: -40deg;
    }
    to {
      opacity: 1;
      scale: 1;
      rotate: 0deg;
    }
  }
  .ff-chapter-card__glims {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
  }
  .ff-chapter-card__glims :global(.ff-chapter-card__glim) {
    width: 16px;
    height: 16px;
  }
</style>
