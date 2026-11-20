<script lang="ts">
  /**
   * One row of actions (UI layout system spec §5).
   *
   * Gives way in a fixed order as its container narrows (`collapseLevel`):
   * utilities to their icon, then secondaries to their short label, and only
   * then a wrap with the primary on its own row. Three hidden, inert copies
   * of the row ([data-measure]) report how wide it would be at each level, so
   * the choice is measured rather than guessed from breakpoints.
   */
  import Button from "../Button.svelte";
  import { collapseLevel, measureBar, type BarAction, type CollapseLevel } from "./action-bar";
  import { observeWidth } from "../../../lib/observe-size";

  let {
    actions,
    testId,
    measure = measureBar,
    keepWords = false,
  }: {
    actions: BarAction[];
    testId?: string;
    measure?: (bar: HTMLElement) => { available: number; widths: [number, number, number] };
    /** Every button keeps its word on every size: a bar too narrow wraps instead of dropping to icons. */
    keepWords?: boolean;
  } = $props();

  let bar: HTMLElement | undefined = $state();
  let level = $state<CollapseLevel>(0);

  $effect(() => {
    if (bar === undefined) return;
    void actions;
    const decide = (): void => {
      const { available, widths } = measure(bar!);
      // Words kept: the icon-only and short-label rows are not an option.
      if (available > 0) level = keepWords ? (widths[0] <= available ? 0 : 3) : collapseLevel(available, widths);
    };
    decide();
    // The widest measuring row too: a web font arriving widens the rows
    // without resizing the bar, and the level must follow it.
    const widest = bar.querySelector('[data-measure="0"]');
    const stops = [observeWidth(bar, decide), ...(widest === null ? [] : [observeWidth(widest, decide)])];
    return () => stops.forEach((stop) => stop());
  });

  /** Its colour: primary is green, the rest blue, unless the action says. */
  const toneOf = (action: BarAction): "go" | "stop" | "plain" => action.tone ?? (action.kind === "primary" ? "go" : "plain");

  /**
   * The look of the hidden measuring copies: they are spans, not buttons, so
   * they take the button's class by hand, and must stay in step with `Button`.
   */
  const measureClass = (action: BarAction): string => {
    const tone = toneOf(action);
    const colour = tone === "go" ? " ff-aq-control--go" : tone === "stop" ? " ff-aq-control--stop" : "";
    return `ff-aq-control${colour} ff-action-bar__${action.kind}`;
  };

  const iconOnly = (action: BarAction, at: number): boolean =>
    !keepWords && action.kind === "utility" && at >= 1 && action.icon !== undefined;

  const words = (action: BarAction, at: number): string =>
    action.kind === "secondary" && at >= 2 ? (action.shortLabel ?? action.label) : action.label;
</script>

<!-- No whitespace between icon and words: a button's text is its words alone. -->
{#snippet face(action: BarAction, at: number)}
  {#if action.icon}<span class="ff-aq-control__icon" aria-hidden="true">{@render action.icon()}</span>{/if}{#if !iconOnly(action, at)}<span
      >{words(action, at)}</span
    >{/if}
{/snippet}

<div bind:this={bar} class="ff-action-bar" data-action-bar data-collapse={level} data-testid={testId}>
  <div class="ff-action-bar__row" data-row="visible">
    {#each actions as action (action.id)}
      <Button
        kind={toneOf(action)}
        class="ff-action-bar__{action.kind}"
        data-testid={action.testId ?? action.id}
        aria-label={iconOnly(action, level) || words(action, level) !== action.label ? action.label : undefined}
        aria-pressed={action.pressed === undefined ? undefined : String(action.pressed)}
        data-pad-guard={action.padGuard ? "" : undefined}
        data-sfx={action.sfx}
        data-kind={action.kind}
        data-short-label={action.shortLabel}
        disabled={action.disabled}
        onclick={(event) => action.onSelect(event)}
      >
        {@render face(action, level)}
      </Button>
    {/each}
  </div>
  <!-- The measuring rows, in a box that fills the bar and clips, so a row
       wider than the bar never widens a scroll container above it. -->
  <div class="ff-action-bar__measures" data-measures aria-hidden="true" inert>
    {#each [0, 1, 2] as at (at)}
      <div class="ff-action-bar__row ff-action-bar__measure" data-measure={at} aria-hidden="true" inert>
        {#each actions as action (action.id)}
          <span class={measureClass(action)}>{@render face(action, at)}</span>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  /* `min-width: 0`, so as a grid or flex item it can be narrower than its
     unwrapped row and give way. A parent that is itself such an item needs
     the same, or the row's min-content widens it (the title's card). */
  .ff-action-bar {
    position: relative;
    min-width: 0;
  }

  .ff-action-bar__row {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
  }

  .ff-action-bar__row > :global(.ff-action-bar__primary),
  .ff-action-bar__row > :global(.ff-action-bar__secondary) {
    flex: 1 1 auto;
    white-space: nowrap;
  }

  .ff-action-bar__row > :global(.ff-action-bar__utility) {
    flex: none;
    white-space: nowrap;
  }

  /* The measuring rows: laid out, unwrapped and unflexed, but never seen.
     Their box is the bar's own size and clips them, so their overflow stays
     inside it; `scrollWidth` still reads each row's whole width. */
  .ff-action-bar__measures {
    position: absolute;
    inset: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }

  .ff-action-bar__measure {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
  }

  .ff-action-bar__measure > :global(*) {
    flex: none;
  }

  /* Level 2 also draws its buttons tighter, measured so as drawn: the short
     labels and 10 px sides keep a translated bar ("Otra carrera · Repetición
     · Menú") on one row at 360 px (visual audit, 2026-10-05). */
  .ff-action-bar[data-collapse="2"] [data-row="visible"],
  .ff-action-bar__measure[data-measure="2"] {
    gap: 6px;
  }
  .ff-action-bar[data-collapse="2"] [data-row="visible"] > :global(*),
  .ff-action-bar__measure[data-measure="2"] > :global(*) {
    padding-inline: 10px;
  }

  /* The last resort: the primary alone on the first row, the rest under it. */
  .ff-action-bar[data-collapse="3"] [data-row="visible"] {
    flex-wrap: wrap;
  }

  .ff-action-bar[data-collapse="3"] [data-row="visible"] > :global(.ff-action-bar__primary) {
    flex-basis: 100%;
  }
</style>
