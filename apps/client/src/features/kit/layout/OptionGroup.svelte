<script lang="ts">
  import Button from "../Button.svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import { pulse } from "../motion";

  /**
   * A choice of one (UI layout system spec §5, audit m1): a segmented row
   * whose selected option is filled, never underlined. A radio group, because
   * exactly one option holds; `data-selected` is said too, for the suites that
   * read it. Controlled: it reports a choice and shows the `value` it is given.
   */
  let {
    label,
    options,
    value,
    onChange,
    disabled = false,
    testId,
  }: {
    label: string;
    /** `icon` draws the option instead of, or before, its label; `ariaLabel` then names it. */
    options: { value: string; label: string; testId?: string; ariaLabel?: string; icon?: IconName; badge?: string }[];
    value: string | undefined;
    onChange: (value: string) => void;
    disabled?: boolean;
    testId?: string;
  } = $props();

  let row: HTMLElement | undefined = $state();
  // Plain, not reactive: it only remembers what the last run saw. `null` marks the first run.
  let shown: string | undefined | null = null;

  /**
   * One pulse on the option just picked (scale, never colour). Not on first
   * render, and not on the option it replaced. The effect runs after the DOM
   * holds the new selection, so the picked button is the one marked selected.
   */
  $effect(() => {
    const now = value;
    const first = shown === null;
    const same = now === shown;
    shown = now;
    if (first || same) return;
    const picked = row?.querySelector<HTMLElement>('[data-selected="true"]');
    if (picked !== null && picked !== undefined) pulse(picked);
  });
  const labelId = `ff-option-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div role="radiogroup" aria-labelledby={labelId} data-testid={testId} class="ff-options">
  <span id={labelId} class="ff-aq-label m-0">{label}</span>
  <div bind:this={row} class="ff-options__row">
    {#each options as option (option.value)}
      {@const selected = option.value === value}
      <Button
        role="radio"
        aria-checked={String(selected)}
        aria-label={option.ariaLabel}
        data-selected={String(selected)}
        data-testid={option.testId}
        class="ff-option {selected ? 'ff-option--selected' : ''}"
        {disabled}
        onclick={() => onChange(option.value)}
      >
        {#if option.icon !== undefined}<span class="ff-option__icon"><Icon name={option.icon} /></span>{/if}{option.label}
        {#if option.badge !== undefined}<span data-testid="mode-featured-badge" class="ff-option__badge font-mono text-xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--ff-glow)] text-[var(--ff-panel-border)] font-semibold ml-1.5">{option.badge}</span>{/if}
      </Button>
    {/each}

  </div>
</div>

<style>
  /* A group that does not fit beside its label drops the label above its
     options, and a row that still does not fit wraps whole buttons (screens
     audit 2026-11-14, L1). Never narrower than its text: an option keeps its
     label and badge on one line and its digits together. */
  .ff-options {
    display: inline-flex;
    align-items: center;
    gap: 4px 8px;
    flex-wrap: wrap;
  }
  .ff-options__row {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  /* `.ff-aq-control` lets a word break anywhere, which also lets a flex item
     shrink below its own text; an option is a number, an icon or a badge, so
     it keeps all of that on one line and takes the room it needs instead. */
  :global(.ff-option) {
    flex: none;
    white-space: nowrap;
    overflow-wrap: normal;
    hyphens: none;
  }
  /* An option not chosen keeps the panel's face but draws its whole edge in the quiet text
     colour, so every choice reads as a button and the chosen one is the one filled blue
     (review R13: "20" and "50" read as bare numbers on the panel). */
  :global(.ff-option:not(.ff-option--selected)) {
    --ff-btn-edge: var(--ff-text-2);
  }
  /* Sized to the option's own text, so a drawn choice keeps the row's height. */
  .ff-option__icon {
    --ff-icon-size: 1.1em;
    display: inline-grid;
    vertical-align: -0.15em;
  }
</style>
