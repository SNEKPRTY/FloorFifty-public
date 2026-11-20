<script lang="ts">
  /**
   * Where a picker is (UI layout system spec §5, audit m4): one row of dots
   * on a backing pill inside the card, or "3 / 11" once the dots would not
   * fit on one row. It never wraps.
   */
  import * as m from "../../../paraglide/messages.js";
  import { observeWidth } from "../../../lib/observe-size";
  import Panel from "../Panel.svelte";
  import { pagerMode } from "./pager";

  let {
    count,
    index,
    max = 9,
    onSelect,
    label,
    testId = undefined,
    ids = undefined,
    labels = undefined,
  }: {
    count: number;
    index: number;
    max?: number;
    onSelect?: (i: number) => void;
    label: string;
    /** On every dot (the pickers' `picker-dot`). */
    testId?: string | undefined;
    /** Each dot's `data-id`: the item it jumps to. */
    ids?: readonly string[] | undefined;
    /** Each dot's accessible name, where the items have names. */
    labels?: readonly string[] | undefined;
  } = $props();

  let root: HTMLElement | undefined = $state();
  let available = $state(Infinity);
  const markStyle = $derived(`--ff-pager-at: ${index}`);
  const mode = $derived(pagerMode(count, max, available));

  $effect(() => {
    if (root === undefined) return;
    return observeWidth(root, (width) => (available = width));
  });
</script>

<div bind:this={root} class="ff-pager" role="group" aria-label={label}>
  {#if mode === "dots"}
    <Panel class="ff-pager__pill" arrive="none" leave="none" style={markStyle}>
      <!-- The lit mark stands on the current dot and steps to the next one, so the dots show where the player is. -->
      <span class="ff-pager__marker" aria-hidden="true"></span>
      {#each { length: count } as _, i (i)}
        <button
          type="button"
          class="ff-pager__dot"
          data-pager-dot
          data-testid={testId}
          data-id={ids?.[i]}
          aria-label={labels?.[i] ?? m.a11y_slide_position({ position: i + 1, total: count })}
          aria-current={i === index ? "true" : undefined}
          onclick={() => onSelect?.(i)}
        >
          <span class="ff-pager__pip" aria-hidden="true"></span>
        </button>
      {/each}
    </Panel>
  {:else}
    <Panel class="ff-pager__pill ff-pager__counter" arrive="none" leave="none" data-testid="pager-counter" aria-live="polite">{index + 1} / {count}</Panel>
  {/if}
</div>

<style>
  .ff-pager {
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  /* A rounded square, as the controls are, not a pill; the pips stay round. */
  :global(.ff-pager__pill) {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: var(--ff-control-radius);
  }

  .ff-pager__dot {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: var(--ff-cursor-hot);
  }

  /* Every dot shows, so the player sees where in the list they are; the current one is
     bigger and lit blue. */
  .ff-pager__pip {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ff-text-2);
  }

  /* The current dot's own pip gives way to the marker that stands on it. */
  .ff-pager__dot[aria-current="true"] .ff-pager__pip {
    background: transparent;
  }

  /* One lit mark, a dot wide, that steps (eight frames, whole pixels) to the
     current dot: 44 px a place. */
  .ff-pager__marker {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 44px;
    display: grid;
    place-items: center;
    pointer-events: none;
    transform: translateX(calc(var(--ff-pager-at, 0) * 44px));
    transition: transform 150ms steps(8);
  }
  .ff-pager__marker::before {
    content: "";
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: var(--ff-glow);
  }
  :global([dir="rtl"]) .ff-pager__marker {
    transform: translateX(calc(var(--ff-pager-at, 0) * -44px));
  }
  @media (prefers-reduced-motion: reduce) {
    .ff-pager__marker {
      transition: none;
    }
  }

  /* One line: a squeezed counter took "10 / 11" onto three. */
  :global(.ff-pager__counter) {
    white-space: nowrap;
    padding: 6px 14px;
    font: 600 var(--ff-type-hint)/1.2 var(--ff-font-ui);
    font-variant-numeric: tabular-nums;
    color: var(--ff-text);
  }
</style>
