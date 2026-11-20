<script lang="ts">
  /**
   * The tutorial's prompt and its way out (launch polish §3.1.4).
   *
   * While it runs: the step count, the prompt in the player's own controls,
   * and Skip. Exit is the pause menu's, behind the HUD's Menu, so the prompt
   * carries one control. Centred, so nothing the tutorial adds can sit on a
   * HUD control in any layout. A slim toast at the top centre, below the
   * HUD's metric row, on every input: the lower half is the thumbs', and the
   * same card in the same place needs no second set of words. It stays solid;
   * where the racer would be behind it, it hangs under the racer instead.
   * Under the pause panel it is not drawn. A step opens frozen, under a light veil, until the player
   * does what it asks; once done, the prompt says so for a beat before the
   * next step.
   *
   * When done: a dialog, so focus, Escape and a controller behave as on every
   * other one. From the lobby it offers Race now; from the title, Play now
   * (which goes to the lobby) and Back to title.
   */
  import * as m from "../../paraglide/messages.js";
  import { GLYPHS } from "../i18n/glyphs";
  import { inputMethod } from "../platform/input-method.svelte";
  import {
    GLYPH_FOR_STEP,
    promptWords,
    type TutorialPromptModel,
    type TutorialPromptOptions,
  } from "./tutorial-prompt.svelte";
  import Button from "../kit/Button.svelte";
  import Modal from "../kit/Modal.svelte";
  import Panel from "../kit/Panel.svelte";

  let {
    model,
    steps,
    origin,
    settings,
    onSkip,
    onRaceNow,
    onBackToTitle,
  }: TutorialPromptOptions & { model: TutorialPromptModel } = $props();


  const step = $derived(steps[model.index]);
  const glyphAction = $derived(step === undefined ? undefined : GLYPH_FOR_STEP[step.kind]);
  const glyph = $derived(
    inputMethod.method === "gamepad" && glyphAction !== undefined ? GLYPHS[inputMethod.family][glyphAction]() : undefined,
  );
  const words = $derived(
    step === undefined ? undefined : promptWords(step, inputMethod.method, settings.value.input.touchMode, glyph),
  );

  /** The foot of the HUD's metric row, which the card stays below. Measured, as the pause overlay does. */
  let hudFoot = $state(0);

  /**
   * Where the card goes, in the overlay's pixels: under the HUD, or under the
   * racer where the racer would be behind it. Worked from the card's natural
   * place, so it does not flip as it moves.
   */
  const cardTop = $derived.by(() => {
    const natural = hudFoot + 8;
    const racer = model.racer;
    if (racer === undefined || cardHeight === 0) return natural;
    const top = frameTop + natural;
    const behind = racer.top < top + cardHeight + 8 && racer.bottom > top - 8;
    return behind ? Math.max(natural, racer.bottom + 8 - frameTop) : natural;
  });

  /** The card's positioned row, whose containing block the foot is measured against. */
  let row = $state<HTMLElement | undefined>();
  /** The overlay's top in the viewport, and the card's own height: where the card would be, to see whether the racer is behind it. */
  let frameTop = $state(0);
  let cardHeight = $state(0);

  /**
   * The lowest HUD edge above the card's column: the metric row, and the
   * roster where it runs under it as a band (a tablet held upright).
   * A roster in a corner, beside the card rather than above it, does not count.
   */
  function hudFootOverCard(): number {
    const card = row?.firstElementChild?.getBoundingClientRect();
    const middle = window.innerWidth / 2;
    const [left, right] = card === undefined || card.width === 0 ? [middle, middle] : [card.left, card.right];
    let foot = 0;
    for (const node of document.querySelectorAll('[data-hud-metrics], [data-testid="hud-roster"]')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= left || box.left >= right) continue;
      foot = Math.max(foot, box.bottom);
    }
    return foot;
  }

  /**
   * A band edge in viewport px, once `app.ts` has written it; `fallback`
   * before then, while the token still holds its `100dvh` default.
   */
  function bandPx(name: string, fallback: number): number {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value.endsWith("px") ? Number.parseFloat(value) : fallback;
  }

  function measureHud(): void {
    const foot = hudFootOverCard();
    // `top` is set in the overlay's coordinates, and the overlay does not
    // always start at the viewport's top: on a phone held sideways it runs
    // behind the browser's toolbar. The HUD is fixed to the viewport.
    const frame = (row?.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    hudFoot = Math.max(foot, bandPx("--ff-band-top", 0)) - (frame?.top ?? 0);
    frameTop = frame?.top ?? 0;
    cardHeight = row?.firstElementChild?.getBoundingClientRect().height ?? 0;
  }

  // The HUD places itself after its first frame, and again whenever the play
  // field's frame changes, so one measure at mount can read a row that has
  // not landed yet -- which put the card on the landscape timer. Measured
  // again on every resize of the HUD or its row.
  $effect(() => {
    measureHud();
    const watched = document.querySelectorAll('[data-testid="race-hud"], [data-hud-metrics], [data-testid="hud-roster"]');
    if (typeof ResizeObserver === "undefined" || watched.length === 0) return;
    const observer = new ResizeObserver(measureHud);
    for (const node of watched) observer.observe(node);
    const frame = requestAnimationFrame(measureHud);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  // Each step's card has its own width, which decides what is above it.
  $effect(() => {
    void model.index;
    void model.phase;
    measureHud();
  });
</script>

<svelte:window onresize={measureHud} />

{#if model.done}
  <Modal title={m.tutorial_ready_title()} testId="tutorial-done" onClose={origin === "Lobby" ? onRaceNow : onBackToTitle}>
    <p class="ff-aq-body m-0 text-aq-ink">{m.tutorial_ready_body()}</p>
    {#snippet actions()}
      <Button kind="go" data-testid="tutorial-race-now" onclick={onRaceNow}>
        {origin === "Lobby" ? m.tutorial_race_now() : m.tutorial_play_now()}
      </Button>
      {#if origin === "MainMenu"}
        <Button kind="ghost" data-testid="tutorial-back-to-title" data-sfx="back" onclick={onBackToTitle}>
          {m.tutorial_back_to_title()}
        </Button>
      {/if}
    {/snippet}
  </Modal>
{:else if step !== undefined && words !== undefined && !model.paused}
  {#if model.phase === "frozen"}
    <!-- The world holds still under a light veil until the player does what
         the card asks; the veil says it is waiting, not paused by a menu.
         Fixed, so it covers the viewport rather than only the letterbox the
         overlay tracks; and it never takes the pointer, so a swipe under it
         still reaches the swipe surface. -->
    <div data-testid="tutorial-freeze" class="pointer-events-none fixed inset-0 z-[9] bg-aq-ink/35"></div>
  {/if}
  <div
    bind:this={row}
    class="ff-tutorial pointer-events-none absolute inset-x-0 z-10 flex justify-center px-[max(var(--ff-gutter),env(safe-area-inset-left),var(--ff-host-reserved-left,0px))]"
    style:top="max({cardTop}px, calc(env(safe-area-inset-top) + 8px))"
  >
    <!-- Keyed on the step, so each new one rises in (the panel's own arrive,
         stilled under reduced motion). The old card leaves at once: two cards
         in the one row would sit side by side while it fell. -->
    {#key model.index}
      <Panel
        as="section"
        tone="hud"
        leave="none"
        aria-live="polite"
        data-tutorial-card
        class="ff-tutorial__card ff-tutorial__card--toast pointer-events-auto font-ui text-aq-ink"
      >
        <div class="ff-tutorial__count ff-aq-label m-0">
          <span data-testid="tutorial-practice" class="ff-tutorial__practice">{m.tutorial_practice_label()}</span>
          <span data-testid="tutorial-step">{m.tutorial_step_toast({ step: model.index + 1, total: steps.length })}{#if model.phase === "frozen"}<span
              data-testid="tutorial-waiting"
              class="sr-only">&nbsp;· {m.tutorial_your_move()}</span
            >{/if}</span>
        </div>
        {#if model.phase === "cleared"}
          <p data-testid="tutorial-cleared" class="ff-tutorial__words ff-aq-body m-0 font-semibold">
            <span aria-hidden="true">✓&nbsp;</span>{m.tutorial_done()}
          </p>
        {:else}
          <!-- After a catch, the card says so in place of the step's words until she moves again. -->
          <p data-testid="tutorial-prompt" class="ff-tutorial__words ff-aq-body m-0" role={model.caught ? "status" : undefined}>
            {#if model.caught}{m.tutorial_caught()}{:else}{words.before}{#if words.glyph !== undefined}<kbd data-testid="tutorial-glyph" class="ff-keycap"
                >{words.glyph}</kbd
              >{/if}{words.after}{/if}
          </p>
        {/if}
        <Button kind="ghost" data-testid="tutorial-skip" class="ff-tutorial__skip" onclick={onSkip}>
          {m.tutorial_skip()}
        </Button>
      </Panel>
    {/key}
  </div>
{/if}

<style>
  /* While the end card is up the race is over: the HUD steps aside, so no
     strip of it (the clock's TIME) sticks out above the card on a short
     screen (review R31). */
  :global(body:has([data-testid="tutorial-done"]) .ff-hud) {
    visibility: hidden;
  }

  .ff-tutorial__practice { display: block; max-width: 6rem; font-size: var(--ff-type-hint); line-height: 1.2; }

  /* The card: count, words and Skip stacked and centred. */
  :global(.ff-tutorial__card) {
    display: grid;
    justify-items: center;
    gap: 8px;
    max-width: min(34rem, 100%);
    padding: 12px;
    text-align: center;
    transition: opacity 160ms ease-out;
  }

  /* The toast: one slim row -- count, words, Skip -- the height of a line or
     two of small type, as the swipe coach is set. */
  :global(.ff-tutorial__card--toast) {
    display: flex;
    align-items: center;
    gap: 10px;
    /* One width for every step, so the pill does not shift as the words
       change (ui layout spec §6.10, p2). */
    width: min(30rem, 100%);
    padding: 2px 2px 2px 14px;
    text-align: start;
  }
  :global(.ff-tutorial__card--toast) .ff-tutorial__count {
    flex: none;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  :global(.ff-tutorial__card--toast) .ff-tutorial__words {
    flex: 1;
    min-width: 0;
    font-size: var(--ff-type-hint);
    line-height: 1.3;
    padding-block: 6px;
  }
  /* A 320 px screen: the words take the whole width on the first row, and
     the count and Skip share the second, instead of a column of single words
     between them. */
  @media (max-width: 400px) {
    :global(.ff-tutorial__card--toast) {
      flex-wrap: wrap;
      gap: 0 10px;
      padding: 2px 8px 2px 14px;
    }
    :global(.ff-tutorial__card--toast) .ff-tutorial__words {
      order: 1;
      flex: 1 1 100%;
      padding-block: 8px 0;
    }
    :global(.ff-tutorial__card--toast) .ff-tutorial__count { order: 2; display: flex; gap: 6px; align-items: baseline; }
    /* "Práctica de escalada 1/5" on one line beside Skip, not three short ones (review R30). */
    :global(.ff-tutorial__card--toast) .ff-tutorial__practice { max-width: none; white-space: nowrap; }
    :global(.ff-tutorial__card--toast) :global(.ff-tutorial__skip) { order: 3; margin-inline-start: auto; }
  }
  /* A real button, as every other way out is (review R30: underlined words did not read as
     something to press), at the card's small type so the slim row stays slim. */
  :global(.ff-tutorial__skip) {
    flex: none;
    min-width: var(--ff-aq-target);
    min-height: var(--ff-aq-target);
    padding: 0 12px;
    font-size: var(--ff-type-hint);
    color: var(--ff-text);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.ff-tutorial__card) {
      transition: none;
    }
  }
</style>
