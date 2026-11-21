<script lang="ts">
  /**
   * A chapter's results (story mode v2 spec, "Chapter results"): a glass
   * dialog over the frozen climb. "Chapter done!", then three stars that
   * pop in 350 ms apart, each with its line: what earned it, or for a star
   * not earned (an outline), what it takes. One main action, "Next"; ghosts
   * "Again" and "Chapters" (also the dialog's Close and Escape).
   *
   * The stars count on the story's clock, so a pause holds them.
   */
  import { onMount } from "svelte";
  import * as m from "../../paraglide/messages.js";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import StarIcon from "./StarIcon.svelte";

  /** Before the first star, and between stars. */
  const FIRST_MS = 300;
  const APART_MS = 350;

  let {
    number,
    title,
    stars,
    glims,
    glimsTotal,
    time,
    par,
    clock,
    reduced,
    onStar,
    onNext,
    onAgain,
    onChapters,
  }: {
    /** From 1. */
    number: number;
    title: string;
    /** The stars this run earned. */
    stars: readonly [boolean, boolean, boolean];
    glims: number;
    glimsTotal: number;
    /** This run's time (`m:ss.t`, as the HUD's clock read it) and the chapter's par (`m:ss`). */
    time: string;
    par: string;
    clock: (step: (ms: number) => void) => () => void;
    reduced: boolean;
    /** A star has popped in, for its sound. */
    onStar: (index: number, earned: boolean) => void;
    onNext: () => void;
    onAgain: () => void;
    onChapters: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let shown = $state(reduced ? 3 : 0);
  let elapsed = 0;

  const lines = $derived([
    m.story_star_finished(),
    stars[1] ? m.story_star_glims({ count: glims, total: glimsTotal }) : m.story_star_glims_need({ total: glimsTotal }),
    stars[2] ? m.story_star_fast({ time, par }) : m.story_star_fast_need({ par }),
  ]);

  onMount(() => {
    if (reduced) {
      stars.forEach((earned, index) => onStar(index, earned));
      return;
    }
    return clock((ms) => {
      if (shown >= 3) return;
      elapsed += ms;
      while (shown < 3 && elapsed >= FIRST_MS + shown * APART_MS) {
        onStar(shown, stars[shown]!);
        shown += 1;
      }
    });
  });
</script>

<Modal title={m.story_results_title()} eyebrow="{m.story_chapter_number({ number })} · {title}" testId="story-results" onClose={onChapters}>
  <ul class="ff-results__stars" data-shown={shown}>
    {#each stars as earned, index (index)}
      <li class="ff-results__star" class:ff-results__star--shown={index < shown} class:ff-results__star--earned={earned} class:ff-results__star--still={reduced} data-testid="story-results-star" data-earned={earned}>
        <span class="ff-results__icon"><StarIcon {earned} /></span>
        <span class="ff-results__line">{lines[index]}</span>
      </li>
    {/each}
  </ul>
  {#snippet actions()}
    <div class="ff-results__actions">
      <Button kind="go" data-testid="story-next" onclick={onNext}>{m.instructions_next()}</Button>
      <Button kind="ghost" data-testid="story-again" onclick={onAgain}>{m.story_again()}</Button>
      <Button kind="ghost" data-testid="story-results-chapters" data-sfx="back" onclick={onChapters}>{m.story_chapters()}</Button>
    </div>
  {/snippet}
</Modal>

<style>
  .ff-results__stars {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ff-results__star {
    display: flex;
    align-items: center;
    gap: 16px;
    opacity: 0;
    color: #c7dcd0;
    font-size: var(--ff-type-body);
  }
  .ff-results__star--earned {
    color: #ffffff;
  }
  .ff-results__star--shown {
    animation: ff-results-in 260ms ease-out both;
  }
  .ff-results__star--shown.ff-results__star--earned .ff-results__icon {
    animation: ff-results-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .ff-results__star--still {
    opacity: 1;
    animation: none;
  }
  .ff-results__star--still .ff-results__icon {
    animation: none !important;
  }
  .ff-results__icon {
    flex: none;
    display: block;
    width: 48px;
    height: 48px;
  }
  .ff-results__icon :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .ff-results__line {
    line-height: 1.3;
  }
  .ff-results__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  @keyframes ff-results-in {
    from {
      opacity: 0;
      translate: 0 8px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }
  @keyframes ff-results-pop {
    0% {
      scale: 0.2;
      rotate: -40deg;
    }
    100% {
      scale: 1;
      rotate: 0deg;
    }
  }
</style>
