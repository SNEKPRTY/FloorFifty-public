<script lang="ts">
  /**
   * The select screen's one frame (select spec §6.8, the Character
   * showcase's composition, §6.1): a scene beside a glass panel holding the
   * headline, the action line and the players. The stage step and the
   * reveal draw through it, so the screen keeps its shape between them.
   * Layout only.
   */
  import type { Snippet } from "svelte";
  import Panel from "../kit/Panel.svelte";
  let {
    heading,
    testId = "select-frame",
    scene,
    dots = undefined,
    headline,
    action,
    players,
    live = false,
  }: {
    heading: string;
    testId?: string;
    scene: Snippet;
    dots?: Snippet | undefined;
    headline: Snippet;
    action: Snippet;
    players: Snippet;
    /**
     * Announce the headline as it changes: the reveal's result. The picker
     * announces its own page turns, so its headline stays quiet (once, not twice).
     */
    live?: boolean;
  } = $props();
  /** Unique per frame, so two frames could never share a heading. */
  const headingId = $props.id();

</script>

{#snippet body()}
  <!-- A step that asks for a choice says what it is, on screen; the reveal's result announces itself (`live`). -->
  <div class="ff-frame__scene">{@render scene()}</div>
  <!-- The step it belongs to arrives and leaves by cross-fade (`ViewSwitch` in `SelectScreen`), so the panel adds neither. -->
  <Panel class="ff-frame__panel" arrive="none" leave="none">
    <div class="ff-frame__top">
      <h2 id={headingId} class={live ? "sr-only" : "ff-frame__heading"} data-testid="select-heading">{heading}</h2>
      <div class="ff-frame__lead">
        <p class="ff-frame__headline" data-testid="select-headline" aria-live={live ? "polite" : undefined}>{@render headline()}</p>
        <!-- Where the picker is, inside the card under its headline (spec §6.4). -->
        {#if dots !== undefined}<div class="ff-frame__dots">{@render dots()}</div>{/if}
        <div class="ff-frame__action">{@render action()}</div>
      </div>
    </div>
    <div class="ff-frame__players">{@render players()}</div>
  </Panel>
{/snippet}

<section class="ff-frame" data-testid={testId} aria-labelledby={headingId}>
  {@render body()}
</section>

<style>
  /* Portrait: the scene on top, the panel below (the showcase's rows). */
  .ff-frame {
    display: grid;
    grid-template-areas: "scene" "panel";
    grid-template-columns: minmax(0, 1fr);
    /* The spec's §7: the scene about 40 % on a phone held upright, 45 % on a
       tablet; the panel never below what it holds, and the scene never below
       the preview's minimum, so the scene gives way first on a short phone
       and the art is never cut away entirely (m7). */
    grid-template-rows: minmax(var(--ff-preview-min, 96px), 40fr) minmax(min-content, 60fr);
    gap: 10px;
    height: 100%;
    min-height: 0;
  }
  :global(.ff-select[data-layout="tablet"]) .ff-frame { grid-template-rows: minmax(var(--ff-preview-min, 96px), 45fr) minmax(min-content, 55fr); gap: 14px; }
  /* Wide: the scene on the left, the panel on the right, where the showcase's sits. */
  :global(.ff-select[data-layout="desk"]) .ff-frame {
    grid-template-areas: "scene panel";
    /* 540 px at most, 45 % of the frame where that is less (an iPad held
       sideways, a 1000 x 700 window): a fixed 540 left the scene a narrow
       strip. Narrower than its one-line lead (about 500, visual audit
       2026-10-05), a short desk's lead wraps its action to a second line
       (below) rather than run Lock in past the panel's edge. */
    grid-template-columns: minmax(0, 1fr) minmax(0, min(540px, 45%));
    grid-template-rows: minmax(0, 1fr);
    gap: 12px 40px;
    width: min(100%, 1180px);
    justify-self: center;
  }
  :global(.ff-select[data-layout="sideways"]) .ff-frame {
    grid-template-areas: "scene panel";
    grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 4px 8px;
  }
  /* A narrow phone held sideways (667 to 780 px): the stage step's lead (with its
     seed chip) needs about 400 px in its one row, so the panel takes more of
     the width and the scene less
     (visual audit, 2026-10-05: at 45/55 Lock in was cut by the screen edge). */
  @container ff-screen (max-width: 800px) {
    :global(.ff-select[data-layout="sideways"]) .ff-frame:has(:global(.ff-seed-chip)) { grid-template-columns: minmax(0, 36fr) minmax(0, 64fr); }
  }
  .ff-frame__scene { grid-area: scene; position: relative; min-height: 0; }
  .ff-frame__dots { display: flex; justify-content: center; }
  /* As tall as what it holds, from the top of its area: a room of one or two
     reads calm, not half empty. Never taller than the area. */
  :global(.ff-frame__panel) {
    grid-area: panel;
    align-self: start;
    max-height: 100%;
    display: grid;
    /* `minmax(0, 1fr)`, not the implicit `auto`: a one-line lead's nowrap
       headline asks for its whole width as its minimum, and an auto column
       grew to it, past the panel's edge, instead of the headline ending in
       an ellipsis. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    padding: 16px;
  }
  :global(.ff-select[data-layout="sideways"] .ff-frame__panel) { gap: 6px; padding: 6px 10px; }
  .ff-frame__lead { display: grid; gap: 10px; justify-items: center; }
  :global(.ff-select[data-layout="desk"]) .ff-frame__lead { justify-items: start; }
  .ff-frame__top { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-height: 0; }
  .ff-frame__heading { margin: 0; text-align: center; font: 600 var(--ff-type-title) / 1.1 var(--ff-font-ui); color: var(--ff-text-2); }
  :global(.ff-select[data-layout="desk"]) .ff-frame__heading { text-align: start; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__heading { text-align: start; font-size: var(--ff-type-hint); line-height: 1; }
  .ff-frame__headline { margin: 0; font: 800 var(--ff-type-hero) / 1.05 var(--ff-font-ui); color: var(--ff-text); }
  :global(.ff-select[data-layout="tablet"]) .ff-frame__headline { font-size: var(--ff-type-display); }
  :global(.ff-select[data-layout="upright"]) .ff-frame__headline { font-size: var(--ff-type-hero); }
  /* A phone upright is narrow: the seed chip, the seconds and Lock in take a
     second line before Lock in's word is cut in two ("Con-firmar"). */
  :global(.ff-select[data-layout="upright"]) .ff-frame__action { flex-wrap: wrap; }
  :global(.ff-select[data-layout="upright"]) .ff-frame__action :global(.ff-picker__lock) { min-width: max-content; hyphens: manual; }
  /* Sideways: the headline and the action share one row, as the showcase's
     do; the row never wraps, since on a phone held sideways its height is a
     player's row. The headline is a heading, not a control, so a long one
     (a translated stage name) takes a second balanced line inside that row
     rather than an ellipsis on one (languages spec §6.3). */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__lead { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__headline { flex: 0 1 auto; min-width: 3.5em; font-size: var(--ff-type-title); line-height: 1.25; text-wrap: balance; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  /* Sideways, the dots give way before the headline: they take the room the
     headline and the action leave, and where four dots do not fit there the
     pager turns to its counter rather than cut the name (spec §6.4). */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__dots { flex: 1 1 0; min-width: 0; }
  /* The pager measures its own width to choose: it fills the room it has, or
     once a counter it would measure only the counter and never go back. */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__dots > :global(*) { flex: 1 1 auto; }
  /* Never narrower than the counter it turns to: squeezed, "9 / 11" ran
     under the seconds and the headline was cut without its ellipsis. */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__dots:has(:global(.ff-pager__counter)) { min-width: max-content; }
  /* And a slimmer counter there, so a name like "Moving On" fits whole at 667 px. */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__dots :global(.ff-pager__counter) { padding-inline: 8px; }
  .ff-frame__action { display: flex; align-items: center; gap: 12px; width: 100%; }
  /* Sideways, the step's heading and the pager share the first row and the
     name and the action the second, so a name like "Moving On" keeps a line
     of its own on the smallest phone instead of fighting the pager for room. */
  :global(.ff-select[data-layout="sideways"]) .ff-frame__top { grid-template-columns: minmax(0, 1fr) minmax(0, auto); column-gap: 8px; row-gap: 4px; align-items: center; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__lead { display: contents; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__heading { grid-column: 1; grid-row: 1; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__dots { grid-column: 2; grid-row: 1; flex: none; justify-self: end; min-width: 0; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__headline { grid-column: 1; grid-row: 2; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__action { grid-column: 2; grid-row: 2; }
  :global(.ff-select[data-layout="sideways"]) .ff-frame__action { width: auto; flex: none; margin-left: auto; }
  /* Clips a room too big for the panel, padded in by a ring's reach so the
     winner's ink ring and a focus ring are drawn whole. */
  .ff-frame__players { min-height: 0; overflow: hidden; padding: var(--ff-ring-room); margin: calc(-1 * var(--ff-ring-room)); }
  /* The smallest phone upright (an iPhone SE): the scene and the lead take most of the height,
     so the scene keeps only its minimum, the rows are a size smaller, and the list scrolls
     inside the panel rather than running off its bottom (review R14: the third and fourth
     racers were cut on the stage and song picks). */
  @container ff-screen (max-height: 640px) and (max-width: 599px) {
    :global(.ff-select[data-layout="upright"]) .ff-frame { grid-template-rows: 80px minmax(0, 1fr); gap: 8px; }
    :global(.ff-select[data-layout="upright"] .ff-frame__panel) { gap: 8px; padding: 12px; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__lead { gap: 6px; }
    /* Random, the seconds and Confirm on one line, as the song pick's: tighter gaps and a
       narrower Confirm make the room the random button's own line was taking from the list. */
    :global(.ff-select[data-layout="upright"]) .ff-frame__action { gap: 8px; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__action :global(.ff-picker__lock) { padding-inline: 10px; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__dots :global(.ff-pager__dot) { height: 28px; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__players { overflow-y: auto; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__players :global(.ff-rows) { gap: 4px; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__players :global(.ff-rows__row) { min-height: 32px; padding-block: 0; }
    :global(.ff-select[data-layout="upright"]) .ff-frame__players :global(.ff-rows__art) { width: 24px; height: 24px; }
  }
  /* A short desk (a 900 x 600 window): the headline, the dots and the action
     share one line, as sideways, so the corner row's height is not a
     player's row. Asked of the room the frame gives it, not the window. */
  @container ff-screen (max-height: 460px) {
    /* Wraps where the panel (at most 45 % of the frame) is narrower than its
       one line, as at 1280 x 720 on the stage step: the action takes a
       second line. */
    :global(.ff-select[data-layout="desk"]) .ff-frame__lead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    :global(.ff-select[data-layout="desk"]) .ff-frame__headline { flex: 0 1 auto; min-width: 3.5em; font-size: var(--ff-type-hero); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* The dots count at their own width (`auto`, not 0): at basis 0 the pill
       fit any line, the action came back up, the slot shrank, the pager
       turned to its counter, the action wrapped again, and the lead flipped
       every frame (review of #257). */
    :global(.ff-select[data-layout="desk"]) .ff-frame__dots { flex: 1 1 auto; min-width: 0; }
    :global(.ff-select[data-layout="desk"]) .ff-frame__dots > :global(*) { flex: 1 1 auto; }
    :global(.ff-select[data-layout="desk"]) .ff-frame__dots:has(:global(.ff-pager__counter)) { min-width: max-content; }
    :global(.ff-select[data-layout="desk"]) .ff-frame__action { width: auto; flex: none; margin-left: auto; }
  }
</style>
