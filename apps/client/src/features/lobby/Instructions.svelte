<script lang="ts">
  /**
   * Instructions: a glass carousel of six short looping demos, each with one
   * line under it (story-mode spec, "Instructions"). Opening it counts as
   * having been shown how. The demos are recordings of the game, fetched by
   * URL as the player reaches them and never part of a boot, menu or race
   * bundle; a clip that does not load leaves its still, or just the caption,
   * which is the instruction (the demo only supports it).
   */
  import * as m from "../../paraglide/messages.js";
  import { onMount } from "svelte";
  import type { StoryContent } from "@floor-fifty/shared/content/game-content";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import PagerDots from "../kit/layout/PagerDots.svelte";
  import { GLYPHS } from "../i18n/glyphs";
  import { inputMethod } from "../platform/input-method.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import { isTap, releaseStep } from "../select/page-swipe";
  import { GLYPH_FOR_CHIP, chipWords } from "../story/control-chip";
  import { INSTRUCTION_SLIDES, slideAfter } from "./instructions";

  let {
    settings,
    prompts,
    artSrc,
    onClose,
  }: {
    settings: SettingsStore;
    /** The story's prompts: slides 1 and 3 name the control the player holds. */
    prompts: StoryContent["prompts"] | undefined;
    artSrc: (alias: string) => string | undefined;
    onClose: () => void;
  } = $props();

  let index = $state(0);
  const slide = $derived(INSTRUCTION_SLIDES[index]!);
  const last = $derived(index === INSTRUCTION_SLIDES.length - 1);
  /** Slides whose clip failed: their still stands in. */
  let failed = $state<Record<string, boolean>>({});
  let stillFailed = $state<Record<string, boolean>>({});

  const caption = $derived.by(() => {
    if (slide.caption !== undefined) return { before: slide.caption(), after: "" } as const;
    if (slide.prompt === undefined || prompts === undefined) return { before: "", after: "" } as const;
    const glyph = inputMethod.method === "gamepad" ? GLYPHS[inputMethod.family][GLYPH_FOR_CHIP[slide.prompt]]() : undefined;
    return chipWords(prompts, slide.prompt, inputMethod.method, settings.value.input.touchMode, glyph);
  });

  function go(step: -1 | 1): void {
    index = slideAfter(index, step);
  }
  function next(): void {
    if (last) onClose();
    else go(1);
  }

  // Opening it is being shown how, so the match gate stays quiet from here on.
  onMount(() => {
    settings.update({ seen: { tutorial: true } });
    // Focus starts on Next, which sits in the dialog's action row, outside the group: the arrows and the
    // pad's left and right are taken wherever focus is while this is open, so one press turns one slide.
    document.addEventListener("ff-steer", steer);
    // Focus lands on Next, the one main action, once the modal has taken its own first stop.
    const timer = setTimeout(() => nextButton?.focus({ preventScroll: true }), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("ff-steer", steer);
    };
  });
  let nextButton: HTMLButtonElement | undefined = $state();

  // The shown slide and the one after it are fetched; the rest when the player gets there.
  const wanted = $derived([index, index + 1].filter((at) => at < INSTRUCTION_SLIDES.length));

  // A swipe, by the same tracker the pickers use.
  let start: { x: number; y: number; t: number; id: number } | undefined;
  let frame: HTMLElement | undefined = $state();
  function down(event: PointerEvent): void {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
  }
  function up(event: PointerEvent): void {
    if (start === undefined || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const gone = start;
    start = undefined;
    if (isTap(dx, event.clientY - gone.y)) return;
    const step = releaseStep(dx, event.timeStamp - gone.t, frame?.clientWidth ?? 320);
    if (step !== 0) go(step);
  }
  /** A pad's left and right, and the arrow keys, reach the dialog as `ff-steer` (FocusNavigator). */
  function steer(event: Event): void {
    // Only while this dialog holds focus: a dialog opened over it has its own.
    if (!(event.target instanceof Node) || !(event.target as Element).closest?.('[data-testid="instructions"]')) return;
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (direction !== "left" && direction !== "right") return;
    event.preventDefault();
    go(direction === "left" ? -1 : 1);
  }
</script>

<Modal title={m.shell_instructions()} testId="instructions" {onClose}>
  <div
    bind:this={frame}
    class="ff-instructions grid gap-8"
    data-slide={slide.id}
    data-framed={artSrc(slide.clip) !== undefined}
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={() => (start = undefined)}
    role="group"
    aria-roledescription="carousel"
    aria-label={m.shell_instructions()}
  >
    <!-- A slide whose recording is not in the manifest is its words alone: no empty box above them. -->
    {#if artSrc(slide.clip) !== undefined}
    <div class="ff-instructions__frame" data-testid="instructions-frame">
      {#each INSTRUCTION_SLIDES as each, at (each.id)}
        {#if at === index && wanted.includes(at)}
          {@const still = stillFailed[each.id] === true ? undefined : artSrc(each.still)}
          {@const clip = failed[each.id] === true ? still : artSrc(each.clip)}
          {#if clip !== undefined}
            <picture data-testid="instructions-demo">
              {#if still !== undefined}<source media="(prefers-reduced-motion: reduce)" srcset={still} />{/if}
              <img
                src={clip}
                alt=""
                width="480"
                height="270"
                draggable="false"
                data-testid="instructions-image"
                onerror={() => {
                  if (failed[each.id] !== true) failed = { ...failed, [each.id]: true };
                  else stillFailed = { ...stillFailed, [each.id]: true };
                }}
              />
            </picture>
          {/if}
        {/if}
      {/each}
    </div>
    {/if}
    <!-- Prefetch the next slide's clip so the move is not a wait. -->
    {#if index + 1 < INSTRUCTION_SLIDES.length}
      {@const upcoming = artSrc(INSTRUCTION_SLIDES[index + 1]!.clip)}
      {#if upcoming !== undefined}<link rel="prefetch" as="image" href={upcoming} />{/if}
    {/if}
    <div class="ff-instructions__text grid gap-8">
      <p class="ff-aq-body m-0 text-center text-aq-ink" data-testid="instructions-caption" aria-live="polite">
        {caption.before}{#if "glyph" in caption && caption.glyph !== undefined}<kbd class="ff-keycap">{caption.glyph}</kbd>{/if}{caption.after}
      </p>
      <PagerDots count={INSTRUCTION_SLIDES.length} {index} onSelect={(at) => (index = at)} label={m.shell_instructions()} testId="instructions-dot" />
    </div>
  </div>
  {#snippet actions()}
    <!-- Side by side, Back then Next: the pair takes one row, so the demo keeps the height. -->
    <div class="ff-instructions__actions">
      <Button kind="ghost" data-testid="instructions-back" data-sfx="back" disabled={index === 0} onclick={() => go(-1)}>
        {m.shell_back()}
      </Button>
      <Button kind="go" data-testid="instructions-next" bind:ref={nextButton} onclick={next}>
        {last ? m.instructions_done() : m.instructions_next()}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .ff-instructions {
    touch-action: pan-y;
  }
  /* The frame keeps the clip's 16:9 box before the clip loads, so nothing jumps. */
  .ff-instructions__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--ff-dialog-gap);
  }
  /* The frame takes the height the dialog has left (the title, the caption, the dots and the buttons need
     about 17rem), so on a short window the demo shrinks and nothing scrolls. */
  .ff-instructions__frame {
    aspect-ratio: 16 / 9;
    width: min(100%, 28rem, calc((100cqh - 17rem) * 16 / 9));
    margin-inline: auto;
    overflow: hidden;
    touch-action: pan-y;
  }
  /* A short, wide window (a phone held sideways): the demo beside its words, the dialog's whole width. */
  @container ff-modal (max-height: 480px) and (min-width: 440px) {
    .ff-instructions[data-framed="true"] {
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      align-items: center;
    }
    .ff-instructions__frame {
      width: min(100%, calc((100cqh - 10rem) * 16 / 9));
      margin-inline: 0;
    }
  }
  .ff-instructions__frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    user-select: none;
  }
</style>
