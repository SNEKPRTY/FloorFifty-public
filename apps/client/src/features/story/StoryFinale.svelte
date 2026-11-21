<script lang="ts">
  /**
   * The story's last screens (story mode v2 spec, "The ending and the
   * credits"), after the ending's cutscene: the thesis card, held until a
   * press; the credits, scrolling once over the last panel, dimmed, about
   * 20 s (a press speeds them four times, "Skip" ends them); then Frog's last
   * line and one big button on, with a ghost "Chapters".
   */
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";
  import Button from "../kit/Button.svelte";
  import type { CutsceneLineView } from "./cutscene";

  const CREDITS_MS = 20_000;
  const FAST = 4;

  let {
    thesis,
    songs,
    last,
    art,
    primaryLabel,
    clock,
    reduced,
    onLast,
    onPrimary,
    onChapters,
  }: {
    thesis: readonly string[];
    /** Each song the story played, by its name. */
    songs: readonly string[];
    last: CutsceneLineView;
    /** The last panel's picture, under the credits. */
    art: string | undefined;
    primaryLabel: string;
    clock: (step: (ms: number) => void) => () => void;
    reduced: boolean;
    /** The last line is up: the story is finished. */
    onLast: () => void;
    onPrimary: () => void;
    onChapters: () => void;
  } = $props();

  let phase = $state<"thesis" | "credits" | "last">("thesis");
  let share = $state(0);
  let speed = 1;
  let thesisButton = $state<HTMLButtonElement | undefined>();
  let primary = $state<HTMLButtonElement | undefined>();

  function toLast(): void {
    if (phase === "last") return;
    phase = "last";
    onLast();
  }

  function press(): void {
    if (phase === "thesis") phase = "credits";
    else if (phase === "credits") speed = FAST;
  }

  onMount(() => {
    thesisButton?.focus({ preventScroll: true });
    const stop = clock((ms) => {
      if (phase !== "credits") return;
      share = Math.min(1, share + (ms * speed) / CREDITS_MS);
      if (share >= 1) toLast();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || phase !== "credits") return;
      event.preventDefault();
      toLast();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  });

  $effect(() => {
    if (phase === "last") primary?.focus({ preventScroll: true });
  });
</script>

<div class="ff-finale" data-testid="story-finale" data-phase={phase}>
  {#if art !== undefined}
    <img class="ff-finale__art" class:ff-finale__art--dim={phase !== "thesis"} src={art} alt="" draggable="false" />
  {/if}

  {#if phase !== "last"}
    <button bind:this={thesisButton} type="button" data-motion="none" class="ff-finale__advance" data-testid="story-finale-advance" aria-label={m.instructions_next()} onclick={press}></button>
  {/if}

  {#if phase === "thesis"}
    <div class="ff-finale__centre" transition:fade={{ duration: reduced ? 0 : 300 }}>
      <Panel as="div" arrive={reduced ? "none" : "rise"} leave="none" class="ff-finale__thesis" data-testid="story-thesis">
        {#each thesis as line, index (index)}
          <p class="ff-finale__thesis-line">{line}</p>
        {/each}
      </Panel>
    </div>
  {:else if phase === "credits"}
    <Button kind="ghost" class="ff-finale__skip" data-testid="story-credits-skip" data-sfx="back" onclick={toLast}>{m.gate_skip()}</Button>
    <div class="ff-finale__roll" data-testid="story-credits" style="transform: translateY({reduced ? 0 : (0.5 - share) * 100}%);">
      <h1 class="ff-wordmark ff-wordmark--light ff-finale__wordmark m-0"><span>Floor</span> <span>Fifty</span></h1>
      <p class="ff-finale__credit">{m.story_credits_by()}</p>
      <p class="ff-finale__credit">{m.story_credits_story()}</p>
      <ul class="ff-finale__songs">
        {#each songs as song (song)}
          <li>{song}</li>
        {/each}
      </ul>
      <p class="ff-finale__credit ff-finale__credit--thanks">{m.story_credits_thanks()}</p>
    </div>
  {:else}
    <div class="ff-finale__centre ff-finale__centre--last" transition:fade={{ duration: reduced ? 0 : 300 }}>
      <Panel as="section" arrive={reduced ? "none" : "rise"} leave="none" class="ff-finale__last" data-testid="story-last">
        {#if last.portrait !== undefined}
          <img class="ff-finale__portrait" src={last.portrait} alt="" width="96" height="96" draggable="false" />
        {/if}
        <p class="ff-finale__last-line">
          {#if last.speaker !== undefined}<strong>{last.speaker}:</strong>{/if}
          {last.text}
        </p>
      </Panel>
      <div class="ff-finale__actions">
        <Button bind:ref={primary} kind="go" data-testid="story-race-now" onclick={onPrimary}>{primaryLabel}</Button>
        <Button kind="ghost" data-testid="story-chapters" onclick={onChapters}>{m.story_chapters()}</Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .ff-finale {
    /* The whole window, past the game's frame on a tall phone: a cutscene is the only thing on screen. */
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: hidden;
    background: #2e222f;
    user-select: none;
  }
  .ff-finale__art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    transition: filter 600ms ease;
  }
  .ff-finale__art--dim {
    filter: brightness(0.38);
  }
  .ff-finale__advance {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .ff-finale__advance:focus-visible {
    outline: none;
  }
  .ff-finale__centre {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding-block: max(var(--ff-gutter, 16px), env(safe-area-inset-top)) max(var(--ff-gutter, 16px), env(safe-area-inset-bottom));
    padding-inline: max(var(--ff-gutter, 16px), env(safe-area-inset-left), env(safe-area-inset-right), var(--ff-host-reserved-left, 0px), var(--ff-host-reserved-right, 0px));
    pointer-events: none;
  }
  .ff-finale__centre--last {
    pointer-events: auto;
  }
  /* The thesis is the story's last word: two lines, large, the widest card on any screen (review R17). */
  :global(.ff-finale__thesis) {
    width: min(960px, 100%);
    padding: clamp(20px, 4vmin, 44px) clamp(20px, 5vmin, 56px);
    text-align: center;
  }
  .ff-finale__thesis-line {
    margin: 0;
    color: #ffffff;
    font-size: var(--ff-type-hero);
    line-height: 1.2;
    text-wrap: balance;
  }
  .ff-finale__thesis-line + .ff-finale__thesis-line {
    margin-top: 12px;
    color: #fbff86;
  }
  :global(.ff-finale__skip) {
    position: absolute;
    z-index: 1;
    top: max(12px, env(safe-area-inset-top));
    right: max(var(--ff-gutter, 16px), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
  }
  .ff-finale__roll {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    color: #ffffff;
    text-align: center;
    pointer-events: none;
  }
  .ff-finale__wordmark {
    font-size: var(--ff-type-wordmark);
  }
  .ff-finale__credit {
    margin: 0;
    font-size: var(--ff-type-body);
  }
  .ff-finale__credit--thanks {
    margin-top: 24px;
    color: #fbff86;
  }
  .ff-finale__songs {
    margin: 0;
    padding: 0;
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
    line-height: 2;
    list-style: none;
  }
  :global(.ff-finale__last) {
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: 720px;
    padding: 16px 24px 16px 16px;
  }
  .ff-finale__portrait {
    flex: none;
    width: 96px;
    height: 96px;
    image-rendering: pixelated;
  }
  .ff-finale__last-line {
    margin: 0;
    color: #ffffff;
    font-size: var(--ff-type-body);
    line-height: 1.4;
  }
  .ff-finale__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
</style>
