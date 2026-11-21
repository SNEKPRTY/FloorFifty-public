<script lang="ts">
  /**
   * The story hub, the chapter select (story mode v2 spec, "The story hub").
   *
   * "Story", a line of the stars and glims carried so far, then the five
   * chapters in a row (they scroll sideways and snap on a phone). The focused
   * chapter is the first one not yet finished; left and right move it (keys,
   * pad, a swipe), and a press on a card focuses it. One main action, a big
   * "Play" for the focused chapter, disabled with the reason on a locked
   * one; a ghost "Back". The focused chapter's first panel fills the screen
   * behind, dimmed, and changes with the focus.
   */
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import * as m from "../../paraglide/messages.js";
  import Button from "../kit/Button.svelte";
  import Rise from "../kit/Rise.svelte";
  import ChapterCard from "./ChapterCard.svelte";
  import type { HubChapter } from "./progress";

  let {
    chapters,
    totals,
    focus,
    fresh,
    reduced,
    onPlay,
    onBack,
  }: {
    chapters: readonly HubChapter[];
    totals: { stars: number; starsTotal: number; glims: number; glimsTotal: number };
    /** The chapter focused on arrival. */
    focus: number;
    /** Stars the run just finished earned, which pop in on its card. */
    fresh?: { chapter: number; stars: readonly [boolean, boolean, boolean] } | undefined;
    reduced: boolean;
    onPlay: (chapter: number) => void;
    onBack: () => void;
  } = $props();

  // The arrival's focus, then the player's.
  // svelte-ignore state_referenced_locally
  let selected = $state(Math.max(0, Math.min(chapters.length - 1, focus)));
  const cards: (HTMLElement | null | undefined)[] = $state([]);
  let row = $state<HTMLElement | undefined>();
  let play = $state<HTMLButtonElement | undefined>();
  const current = $derived(chapters[selected]!);

  /** Moves the focus to chapter `index`, its card into view and under the keyboard's or pad's focus. */
  function select(index: number, options: { focusCard?: boolean } = {}): void {
    const next = Math.max(0, Math.min(chapters.length - 1, index));
    selected = next;
    const card = cards[next];
    if (card === undefined || card === null) return;
    if (options.focusCard === true && document.activeElement !== card) card.focus({ preventScroll: true });
    card.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }

  /**
   * The chapter chosen when a pointer went down, before that press's own
   * focus moved the choice: a tap on another card only chooses it, and a
   * tap on the chosen card plays. A key's or pad's press has no pointer
   * down, so it plays the chosen card.
   */
  let chosenAtPointer: number | undefined;

  function press(index: number): void {
    const chosen = chosenAtPointer ?? selected;
    chosenAtPointer = undefined;
    if (index === chosen && !chapters[index]!.locked) onPlay(index);
    else select(index);
  }

  /** The pad's and the arrow keys' directions on a card: sideways along the row, down to Play. */
  function steerRow(event: Event): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (direction === "left" || direction === "right") {
      event.preventDefault();
      select(selected + (direction === "left" ? -1 : 1), { focusCard: true });
    } else if (direction === "down") {
      event.preventDefault();
      (play?.disabled === false ? play : (document.querySelector('[data-testid="story-hub-back"]') as HTMLElement | null))?.focus({ preventScroll: true });
    } else if (direction === "up") {
      event.preventDefault();
    }
  }

  /** Up from the buttons goes back to the focused card. */
  function steerActions(event: Event): void {
    if ((event as CustomEvent<{ direction: string }>).detail.direction !== "up") return;
    event.preventDefault();
    cards[selected]?.focus({ preventScroll: true });
  }

  /** A swipe along the row on a phone: the card it settles on is the focused one. */
  let settle: ReturnType<typeof setTimeout> | undefined;
  function onScroll(): void {
    if (row === undefined) return;
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (row === undefined) return;
      // A swipe that leaves the focused card in sight leaves the focus with it; the row's last cards can never reach its middle.
      const frame = row.getBoundingClientRect();
      const focused = cards[selected]?.getBoundingClientRect();
      if (focused !== undefined && focused.left >= frame.left - 1 && focused.right <= frame.right + 1) return;
      const middle = row.getBoundingClientRect().left + row.clientWidth / 2;
      let nearest = selected;
      let best = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        if (card === undefined || card === null) return;
        const box = card.getBoundingClientRect();
        const distance = Math.abs(box.left + box.width / 2 - middle);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      // Only a real swipe moves the focus: a row that fits the screen does not scroll.
      if (row.scrollWidth > row.clientWidth + 1) selected = nearest;
    }, 120);
  }

  onMount(() => {
    void tick().then(() => {
      select(selected);
      (current.locked ? cards[selected] : play)?.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="ff-hub" data-testid="story-hub" data-selected={selected}>
  {#key selected}
    <div class="ff-hub__backdrop" transition:fade={{ duration: reduced ? 0 : 400 }}>
      {#if current.art !== undefined}
        <img src={current.art} alt="" draggable="false" class:ff-hub__backdrop--locked={current.locked} />
      {/if}
    </div>
  {/key}
  <div class="ff-hub__shade"></div>

  <div class="ff-hub__layout">
    <Rise still={reduced} class="ff-hub__head">
      <h1 class="ff-hub__heading">{m.shell_story()}</h1>
      <p class="ff-hub__totals" data-testid="story-hub-totals">
        {m.story_hub_totals({ stars: totals.stars, starsTotal: totals.starsTotal, glims: totals.glims, glimsTotal: totals.glimsTotal })}
      </p>
    </Rise>

    <div class="ff-hub__row" bind:this={row} onscroll={onScroll} onff-steer={steerRow} role="group" aria-label={m.story_chapters()}>
      {#each chapters as chapter, index (index)}
        <ChapterCard
          bind:ref={cards[index]}
          number={index + 1}
          title={chapter.title}
          art={chapter.art}
          stars={chapter.stars}
          fresh={fresh?.chapter === index ? fresh.stars : undefined}
          glims={chapter.glims}
          glimsTotal={chapter.glimsTotal}
          locked={chapter.locked}
          selected={index === selected}
          order={index + 1}
          {reduced}
          onPress={() => press(index)}
          onPointerDown={() => (chosenAtPointer = selected)}
          onFocus={() => {
            if (index !== selected) select(index);
          }}
        />
      {/each}
    </div>

    <Rise still={reduced} delay={chapters.length + 1}>
      <div class="ff-hub__actions" role="group" onff-steer={steerActions}>
        <Button bind:ref={play} kind="go" data-testid="story-play" disabled={current.locked} onclick={() => onPlay(selected)}>{m.title_play()}</Button>
        {#if current.locked}
          <p class="ff-hub__why" data-testid="story-locked-why">{m.story_locked({ number: selected })}</p>
        {/if}
        <Button kind="ghost" data-testid="story-hub-back" data-sfx="back" onclick={onBack}>{m.shell_back()}</Button>
      </div>
    </Rise>
  </div>
</div>

<style>
  .ff-hub {
    /* The whole window, as the cutscenes are: the hub is the only thing on screen. */
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: hidden;
    background: #2e222f;
    color: #ffffff;
  }
  .ff-hub__backdrop {
    position: absolute;
    inset: 0;
  }
  .ff-hub__backdrop img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    filter: brightness(0.5) saturate(0.9);
    transform: scale(1.04);
  }
  .ff-hub__backdrop img.ff-hub__backdrop--locked {
    filter: grayscale(1) brightness(0.3);
  }
  .ff-hub__shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(46, 34, 47, 0.7) 0%, rgba(46, 34, 47, 0.1) 40%, rgba(46, 34, 47, 0.1) 60%, rgba(46, 34, 47, 0.8) 100%);
    pointer-events: none;
  }
  .ff-hub__layout {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 24px;
    padding: max(16px, env(safe-area-inset-top)) 0 max(16px, env(safe-area-inset-bottom));
  }
  :global(.ff-hub__head) {
    padding-inline: max(var(--ff-gutter, 16px), env(safe-area-inset-left), env(safe-area-inset-right), var(--ff-host-reserved-left, 0px), var(--ff-host-reserved-right, 0px));
    text-align: center;
  }
  .ff-hub__heading {
    margin: 0;
    font-size: var(--ff-type-hero);
    line-height: 1.1;
    text-shadow: 0 2px 0 #2e222f;
  }
  .ff-hub__totals {
    margin: 8px 0 0;
    color: #fbff86;
    font-size: var(--ff-type-body);
    text-shadow: 0 1px 0 #2e222f;
  }
  .ff-hub__row {
    --ff-chapter-card-width: clamp(168px, 18vw, 240px);
    display: flex;
    gap: 16px;
    overflow-x: auto;
    /* Room for the focused card's lift and glow, which the scroller would cut. */
    padding: 12px max(var(--ff-gutter, 16px), calc(50% - 3 * var(--ff-chapter-card-width) - 40px));
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 16px;
    scrollbar-width: none;
    justify-content: safe center;
  }
  .ff-hub__row::-webkit-scrollbar {
    display: none;
  }
  .ff-hub__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 16px;
  }
  .ff-hub__actions :global([data-testid="story-play"]) {
    min-width: 240px;
  }
  .ff-hub__why {
    flex-basis: 100%;
    order: 2;
    margin: 0;
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
    text-align: center;
  }
  /* A phone held sideways: the row fills the height it has, and the cards shrink to fit two and a peek. */
  @media (max-height: 480px) {
    .ff-hub__layout {
      gap: 12px;
    }
    .ff-hub__heading {
      font-size: var(--ff-type-title);
    }
    .ff-hub__totals {
      margin-top: 4px;
      font-size: var(--ff-type-hint);
    }
    .ff-hub__row {
      --ff-chapter-card-width: 168px;
    }
  }
</style>
