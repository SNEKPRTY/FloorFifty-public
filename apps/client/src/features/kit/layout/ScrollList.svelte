<script lang="ts">
  /**
   * A list that keeps its rows (UI layout system spec §5).
   *
   * It reserves `min(minRows, rowCount)` rows of `--ff-row-h` as its minimum
   * height, so on a short screen its siblings shrink before a row is lost
   * (audit B1). For that to work its parent must give it a `1fr` grid row or
   * `flex: 1 1 auto` -- never `minmax(0, 1fr)`, which ignores an item's
   * minimum. Rows mark themselves `data-row`; the height of the first one is
   * where they end is what "N more" counts. That line sits under the list, in
   * flow, and is reserved whenever a row may be hidden, so it never covers a
   * row and showing it never changes the list's height.
   *
   * The screen contract (tests/e2e/support/contract.ts) reads `data-min-rows`
   * and fails any screen where fewer whole rows show.
   */
  import * as m from "../../../paraglide/messages.js";
  import type { Snippet } from "svelte";
  import { reservedRows, rowsBelow } from "./scroll-list";
  import { observeWidth } from "../../../lib/observe-size";
  import { tabbables } from "../../platform/focus-nav";

  let {
    minRows,
    rowCount,
    rowGap = undefined,
    label,
    children,
    testId,
  }: {
    minRows: number;
    rowCount: number;
    /** The CSS gap between its rows, so the reserve holds whole rows and the gaps between them. */
    rowGap?: string | undefined;
    label: string;
    children: Snippet;
    testId?: string;
  } = $props();

  /** Where the last reserved row ends, once rows have a height; 0 before. */
  let measured = $state(0);
  /** Whether the reserved rows share lines (two seats across, a podium): then the row token over-counts them. */
  let sideBySide = $state(false);

  /**
   * The reserve: the rows at the row token (and their gaps), or where the
   * last of them actually ends if that is further -- the local racer's row
   * carries its badges and is taller than the token.
   */
  const reserve = $derived.by(() => {
    const rows = reservedRows(minRows, rowCount);
    const token = rowGap === undefined || rows < 2 ? `calc(${rows} * var(--ff-row-h))` : `calc(${rows} * var(--ff-row-h) + ${rows - 1} * ${rowGap})`;
    if (measured > 0 && sideBySide) return `${Math.ceil(measured)}px`;
    return measured > 0 ? `max(${token}, ${Math.ceil(measured)}px)` : token;
  });

  /** Whether rows beyond the reserved ones may scroll out of view, so the line under the list is reserved. */
  const mayHide = $derived(rowCount > reservedRows(minRows, rowCount));

  let list: HTMLElement | undefined = $state();
  let hidden = $state(0);
  let overflowing = $state(false);

  /**
   * Each row's foot in the list's scrolled coordinates, from its box: rows
   * set side by side (the tablet's podium) share a line and end together.
   * Where nothing is laid out (jsdom) every box is empty, and the feet are
   * the rows' heights stacked.
   */
  function rowBottoms(view: HTMLElement, rows: readonly HTMLElement[]): number[] {
    const boxes = rows.map((row) => row.getBoundingClientRect());
    if (boxes.some((box) => box.height > 0)) {
      // A screen is scaled with CSS `zoom`: boxes are drawn sizes, while `scrollTop` and
      // `clientHeight` are the list's own, so the boxes are brought back to the list's units
      // (the scale is 1 unzoomed). Left drawn, a zoomed list kept counting rows it had scrolled to.
      const frame = view.getBoundingClientRect();
      const scale = frame.height > 0 && view.offsetHeight > 0 ? frame.height / view.offsetHeight : 1;
      return boxes.map((box) => (box.height > 0 ? (box.bottom - frame.top) / scale - view.clientTop + view.scrollTop : 0));
    }
    let stacked = 0;
    return rows.map((row) => (stacked += row.offsetHeight));
  }

  function count(): void {
    if (list === undefined) return;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-row]")];
    const bottoms = rowBottoms(list, rows);
    hidden = rowsBelow(list.scrollTop + list.clientHeight, bottoms);
    overflowing = list.scrollHeight > list.clientHeight;
    const reserved = bottoms.slice(0, reservedRows(minRows, rowCount));
    measured = Math.max(0, ...reserved);
    sideBySide = reserved.length > 1 && new Set(reserved.map(Math.round)).size < reserved.length;
  }

  $effect(() => {
    if (list === undefined) return;
    void rowCount;
    count();
    const view = list;
    const stopObserving = observeWidth(view, count);
    // The menu routes keyboard arrows and controller directions through the
    // same events. A focused region must work even when its controls are all
    // disabled (a guest's race options), so it scrolls only then. Child controls keep their own events;
    // an edge lets focus walk to the next control instead of trapping it.
    const scroll = (event: Event, amount: number): void => {
      if (event.target !== view) return;
      const next = Math.max(0, Math.min(view.scrollHeight - view.clientHeight, view.scrollTop + amount));
      // Under a pixel from the edge is the edge: a browser rounds scrollTop, and
      // a fractional foot would otherwise be scrolled to on every step.
      if (Math.abs(next - view.scrollTop) < 1) return;
      view.scrollTop = next;
      count();
      event.preventDefault();
    };
    const firstControlInView = (region: HTMLElement): boolean => {
      const first = tabbables(region)[0];
      if (first === undefined) return false;
      const outer = region.getBoundingClientRect();
      const inner = first.getBoundingClientRect();
      return inner.top >= outer.top && inner.bottom <= outer.bottom;
    };
    const steer = (event: Event): void => {
      const direction = (event as CustomEvent<{ direction?: string }>).detail?.direction;
      if (direction !== "up" && direction !== "down") return;
      // Going down, once its first control of its own is in view, the step goes
      // on to that control (the next one in focus order), and each control
      // scrolls itself into view from there. Until then it scrolls a row, so
      // rows above that control (a list of keys, say) are read on the way.
      if (direction === "down" && firstControlInView(view)) return;
      const rowHeight = view.querySelector<HTMLElement>("[data-row]")?.offsetHeight || view.clientHeight;
      scroll(event, direction === "down" ? rowHeight : -rowHeight);
    };
    const page = (event: Event): void => {
      const direction = (event as CustomEvent<{ direction?: string }>).detail?.direction;
      if (direction !== "previous" && direction !== "next") return;
      scroll(event, direction === "next" ? view.clientHeight : -view.clientHeight);
    };
    view.addEventListener("ff-steer", steer);
    view.addEventListener("ff-page", page);
    return () => {
      stopObserving();
      view.removeEventListener("ff-steer", steer);
      view.removeEventListener("ff-page", page);
    };
  });
</script>

<div class="ff-scroll-list" style:min-height={mayHide ? `calc(${reserve} + var(--ff-more-line))` : undefined}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (An overflowing region needs keyboard/controller access even when its child controls are disabled.) -->
  <div
    bind:this={list}
    class="ff-scroll-list__view"
    data-scroll-region
    data-min-rows={minRows}
    data-more={hidden > 0 ? "true" : undefined}
    data-testid={testId}
    aria-label={label}
    role="region"
    tabindex={overflowing ? 0 : undefined}
    style:min-height={reserve}
    onscroll={count}
  >
    {@render children()}
  </div>
  {#if mayHide}
    <div class="ff-scroll-list__line" aria-hidden="true">
      {#if hidden > 0}<span data-testid="scroll-more">{m.shell_more({ count: hidden })}</span>{/if}
    </div>
  {/if}
</div>

<style>
  /* The list and, under it, the line that says how many rows are below. */
  .ff-scroll-list {
    --ff-more-line: 24px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  /* It clips what scrolls, so it pads in by a ring's reach and pulls back
     by it: a focused row's ring is drawn whole, and nothing moves. */
  .ff-scroll-list__view {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--ff-ring-room);
    margin: calc(-1 * var(--ff-ring-room));
    /* A control focused at the list's edge is scrolled clear of it by the
       ring's reach, rather than left whole with its ring cut. */
    scroll-padding: var(--ff-ring-room);
  }

  /* Rows run on under a soft edge when there are more than fit. */
  .ff-scroll-list__view[data-more="true"] {
    /* A mask reads only alpha; any opaque palette swatch does. */
    mask-image: linear-gradient(to bottom, var(--ff-text) calc(100% - var(--ff-row-h) / 2), transparent);
  }

  /* The overflow mask also masks an exterior outline. Keep a region's focus
     ring inside its viewport so it stays visible while more rows are below. */
  .ff-scroll-list__view:focus-visible {
    --ff-focus-offset: -2px;
    outline: 2px solid var(--ff-text);
    outline-offset: -2px;
  }

  /* A line of its own, whether or not it has words: reserved, so saying
     "more" never changes the list's height. A label, never a target. */
  .ff-scroll-list__line {
    flex: none;
    display: grid;
    place-items: center;
    height: var(--ff-more-line);
    font: 600 var(--ff-type-hint)/1 var(--ff-font-ui);
    color: var(--ff-text-2);
    pointer-events: none;
  }
</style>
