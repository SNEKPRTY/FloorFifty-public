<script lang="ts">
  /**
   * The chapter card (story mode v2 spec, "The chapter card"): "Chapter {n}"
   * small and the chapter's name large, on a glass band that slides in from
   * the left and out to the right, over the loaded stage for 2.2 s. A press
   * ends it sooner. It never takes the press: the climb under it hears it too.
   */
  import { onMount } from "svelte";
  import * as m from "../../paraglide/messages.js";
  import Panel from "../kit/Panel.svelte";

  const CARD_MS = 2200;

  let {
    number,
    title,
    clock,
    reduced,
    onDone,
  }: {
    number: number;
    title: string;
    clock: (step: (ms: number) => void) => () => void;
    reduced: boolean;
    onDone: () => void;
  } = $props();

  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    onDone();
  };

  onMount(() => {
    let elapsed = 0;
    const stop = clock((ms) => {
      elapsed += ms;
      if (elapsed >= CARD_MS) end();
    });
    window.addEventListener("keydown", end);
    window.addEventListener("pointerdown", end);
    return () => {
      stop();
      window.removeEventListener("keydown", end);
      window.removeEventListener("pointerdown", end);
    };
  });
</script>

<div class="ff-title-card" class:ff-title-card--still={reduced} data-testid="story-card" style="--card-ms: {CARD_MS}ms">
  <Panel as="div" tone="hud" arrive="none" leave="none" class="ff-title-card__band">
    <p class="ff-title-card__number">{m.story_chapter_number({ number })}</p>
    <h2 class="ff-title-card__name" data-testid="story-card-title">{title}</h2>
  </Panel>
</div>

<style>
  .ff-title-card {
    position: absolute;
    inset-inline: 0;
    top: 30%;
    z-index: 30;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  :global(.ff-title-card__band) {
    display: flex;
    min-width: min(92vw, 560px);
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 16px 48px 20px;
    animation: ff-title-card var(--card-ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .ff-title-card__number {
    margin: 0;
    color: #c7dcd0;
    font-size: var(--ff-type-hint);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .ff-title-card__name {
    margin: 0;
    color: #ffffff;
    font-size: var(--ff-type-title);
    line-height: 1.1;
    text-align: center;
  }

  @keyframes ff-title-card {
    0% {
      transform: translateX(-60vw);
      opacity: 0;
    }
    15% {
      transform: translateX(0);
      opacity: 1;
    }
    85% {
      transform: translateX(0);
      opacity: 1;
    }
    100% {
      transform: translateX(60vw);
      opacity: 0;
    }
  }
  @keyframes ff-title-card-still {
    0%,
    100% {
      opacity: 0;
    }
    10%,
    90% {
      opacity: 1;
    }
  }
  .ff-title-card--still :global(.ff-title-card__band) {
    animation-name: ff-title-card-still;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.ff-title-card__band) {
      animation-name: ff-title-card-still;
    }
  }
</style>
