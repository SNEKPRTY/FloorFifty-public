<script lang="ts">
  /**
   * The Character page's roster of chips (stage, song and character select
   * spec §6.1, §6.3). Nothing in it scrolls: while every pack fits the box it
   * stacks them as sections; past that, chips sit on pages of a fixed shape,
   * one pack per page, and the pages slide sideways under a finger, a mouse
   * drag or a trackpad swipe, or by the side arrows, the keys and the pad.
   * There are no dots and no "1 of 2", and a seat's flag stands only on its
   * own chip.
   *
   * Tiles are keyed by item ID and never rebuilt by the snapshot stream, so a
   * press held across a 20 Hz broadcast still clicks (see `ReadyRoom.svelte`).
   * Only the visible page's tiles are focusable; the others are inert, so Tab
   * and the pad walk the page the player sees.
   */
  import * as m from "../../paraglide/messages.js";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import IconButton from "../kit/IconButton.svelte";
  import { untrack } from "svelte";
  import { reducedMotion } from "../kit/motion";
  import { revealOnce } from "../kit/reveal";
  import { isTap, releaseStep, WheelPager } from "./page-swipe";
  import { focusControl } from "../platform/focus-nav";
  import {
    fitColumns,
    fitShape,
    pageOf,
    paginate,
    stackedSide,
    tileSide,
    trimRows,
    wrapPage,
    type Cursor,
    type PackGroup,
    type Shape,
    type TileItem,
  } from "./tile-pages";

  let {
    label,
    groups,
    most,
    focusedId,
    cursors,
    random = undefined,
    onPress,
    announce = undefined,
    fitHeight = false,
    previewId = undefined,
    opensSheet = undefined,
    stack = false,
    onReveal = undefined,
  }: {
    label: string;
    groups: readonly PackGroup[];
    /** The most a page holds, the shape the screen root's layout picked. */
    most: Shape;
    focusedId: string | undefined;
    cursors: readonly Cursor[];
    random?: { label: string } | undefined;
    /**
     * Every tap on a chip or on "?", whatever its state: the picker decides
     * what a tap does (the Character page views, then picks, select spec
     * §6.1), and the grid neither focuses nor confirms.
     */
    onPress: (id: string) => void;
    announce?: ((message: string) => void) | undefined;
    /**
     * Fill the parent's height and size tiles to it. Only for a parent whose
     * height is set from outside (a page's row); in a panel sized by its
     * content the grid sizes by width alone.
     */
    fitHeight?: boolean;
    /** The tile the player is looking at, outlined apart from the chosen one. */
    previewId?: string | undefined;
    /**
     * The tile whose next tap opens a sheet (Coming soon). Quiet, so the
     * sheet's own `ui.open` is the one sound (polish spec §8.3).
     */
    opensSheet?: string | undefined;
    /**
     * Stack every pack as a section instead of paging, while they all fit the
     * box at the smallest chip (select spec §6.3). Needs `fitHeight`. The
     * packs are drawn untitled, named only for assistive technology, and their
     * room goes to the chips.
     */
    stack?: boolean;
    /** A tile earned by play was focused or tapped: it is no longer new (unlockables spec §7.2). */
    onReveal?: ((id: string) => void) | undefined;
  } = $props();

  function revealIfNew(item: TileItem): void {
    if (item.isNew === true) onReveal?.(item.id);
  }

  const GAP = 8;
  const MIN_TILE = 44;
  const MAX_TILE = 128;
  const RANDOM_ID = "?";
  // A stacked section's chrome above its chips: the chips' 16 px flag
  // headroom (`.ff-tiles__cards`). A chip has no caption (select spec §6.3).
  const FLAG_HEADROOM = 16;

  let boxWidth = $state(0);
  let boxHeight = $state(0);
  /**
   * The whole row's width: the viewport, the pinned ? chip and any side
   * arrows. Sizes come from this, not the viewport's own width, because the ?
   * chip is a tile wide: a size read from the viewport narrowed the viewport
   * it was read from, and the tiles flickered a pixel every frame.
   */
  let rowWidth = $state(0);
  /** A side arrow's width: the touch target. */
  const ARROW = 44;
  // Without `fitHeight` the measured height is the tiles' own, so it is not
  // a limit at all.
  // The viewport's 16 px top padding is the seat flag's headroom, not room
  // for tiles.
  const FLAG_ROOM = 16;
  // The viewport's side padding: room for the chosen tile's outline, drawn
  // just outside the tile, which its hidden overflow would otherwise clip.
  const OUTLINE_ROOM = 4;
  /** The ? chip's own line above the pages, headroom for its seat flag included. */
  const RANDOM_ROW = FLAG_HEADROOM + MIN_TILE + GAP;
  /**
   * Whether side arrows will stand in the row: the groups page even at the
   * grid's largest shape, so they page at any smaller one too. Read from
   * `most`, never the fitted shape, which this feeds.
   */
  const mayPage = $derived(paginate(groups, most.columns * most.rows).length > 1);
  const box = $derived({
    // What the pages have, the arrows at their width; only the page shape reads this, so it never
    // depends on the size it leads to.
    width: Math.max(0, rowWidth - 2 * OUTLINE_ROOM - (mayPage ? 2 * (ARROW + GAP) : 0)),
    height: fitHeight ? boxHeight - FLAG_ROOM : Infinity,
  });
  const shape = $derived(
    fitColumns(trimRows(rowWidth === 0 ? most : fitShape(most, box, MIN_TILE, GAP), groups), groups),
  );
  const pages = $derived(paginate(groups, shape.columns * shape.rows));
  /** The side arrows, when the pages need them. */
  const arrowRoom = $derived(pages.length > 1 ? 2 * (ARROW + GAP) : 0);
  const size = $derived(
    rowWidth === 0
      ? MIN_TILE
      : tileSide(
          { columns: shape.columns, rows: shape.rows },
          { width: Math.max(0, rowWidth - 2 * OUTLINE_ROOM - arrowRoom), height: box.height },
          GAP,
          { peek: 0, min: MIN_TILE, max: MAX_TILE },
        ),
  );

  // Stacked: measured on the root, which fills a page's row, so the height is
  // the space given and never the chips'.
  let rootWidth = $state(0);
  let rootHeight = $state(0);
  const stackSide = $derived(
    stack && fitHeight && rootWidth > 0
      ? stackedSide(groups, 0, most.columns, { width: rootWidth, height: rootHeight - (random === undefined ? 0 : RANDOM_ROW) }, GAP, {
          titleRow: FLAG_HEADROOM,
          min: MIN_TILE,
          max: MAX_TILE,
        })
      : undefined,
  );
  const stacked = $derived(stackSide !== undefined);

  let page = $state(0);
  let dragX = $state(0);
  let dragging = $state(false);
  const count = $derived(pages.length);
  const current = $derived(Math.min(page, Math.max(0, count - 1)));

  // Moving the focus onto an item brings its page into view; paging by hand
  // does not move the focus, so this reacts to focus changes only.
  let lastFocus: string | undefined;
  $effect(() => {
    const id = focusedId;
    const at = id === undefined ? -1 : pageOf(pages, id);
    untrack(() => {
      if (id !== lastFocus && at >= 0) page = at;
      lastFocus = id;
    });
  });

  // Viewing a chip can change the panel above the roster (a locked chip shows
  // its progress), and the roster's new height can switch it between stacked
  // sections and pages. That draws the chips anew, and the chip under the
  // player's focus goes with it, leaving focus on the page; so do the page
  // arrows, which only pages have. The new chip of the same item takes the
  // focus back (from an arrow, the chip in view), so Tab and the pad go on
  // from it.
  let root: HTMLElement | undefined = $state();
  /** The focused chip's item, "" for another control of the roster (an arrow), undefined for none. */
  let heldChip: string | undefined;
  function holdChip(event: FocusEvent): void {
    if (!(event.target instanceof HTMLElement)) return;
    heldChip = event.target.dataset["testid"] === "tile" ? (event.target.dataset["id"] ?? "") : "";
  }
  function letChipGo(event: FocusEvent): void {
    // Focus moving on to anything else, or off a chip that stays (a click on
    // empty page), lets go; a chip taken from under it keeps it.
    if (event.relatedTarget !== null) {
      heldChip = undefined;
      return;
    }
    const left = event.target;
    queueMicrotask(() => {
      if (left instanceof Element && left.isConnected) heldChip = undefined;
    });
  }
  $effect(() => {
    void stacked;
    untrack(() => {
      const active = document.activeElement;
      if (heldChip === undefined || root === undefined || (active !== null && active !== document.body)) return;
      const chips = [...root.querySelectorAll<HTMLElement>("[data-testid=tile]")].filter((chip) => chip.closest("[inert]") === null);
      const again =
        (heldChip === "" ? undefined : chips.find((chip) => chip.dataset["id"] === heldChip)) ??
        chips.find((chip) => chip.getAttribute("aria-pressed") === "true") ??
        chips[0];
      if (again !== undefined) focusControl(again, { within: false });
    });
  });

  function turn(step: number): void {
    if (count <= 1) return;
    page = wrapPage(current + step, count);
    announce?.(m.ready_tile_page({ title: pages[page]!.title, page: page + 1, count }));
  }

  const seatFlag = (seat: number) => m.ready_seat_short({ seat: seat + 1 });
  const cursorsOn = (id: string) => cursors.filter((cursor) => cursor.itemId === id);
  /** A cursor's colour class: the player's colour. */
  const cursorClass = (cursor: Cursor) => `ff-colour-${cursor.colour}`;
  /** The first seat on a tile colours its frame, as its flag is coloured. */
  const seatClass = (id: string) => {
    const first = cursorsOn(id)[0];
    return first === undefined ? "" : cursorClass(first);
  };

  function accessibleName(item: TileItem): string {
    if (item.state === "dlc") return m.ready_tile_dlc({ label: item.label });
    if (item.state === "locked")
      return m.ready_tile_locked({ label: item.label, details: [item.hint, item.progress].filter((part) => part !== undefined).join(", ") });
    return item.isNew === true ? m.ready_tile_new({ label: item.label }) : item.label;
  }

  // A press that moved is a swipe, and the click the browser sends after it
  // must not pick.
  let swallowClick = false;
  function press(id: string): void {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    onPress(id);
  }

  let start: { x: number; y: number; t: number; id: number } | undefined;
  function down(event: PointerEvent): void {
    if (count <= 1) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
    swallowClick = false;
  }
  function move(event: PointerEvent): void {
    if (start === undefined || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragging && isTap(dx, dy)) return;
    if (!dragging) {
      dragging = true;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    }
    dragX = dx;
  }
  function up(event: PointerEvent): void {
    if (start === undefined || event.pointerId !== start.id) return;
    if (dragging) {
      swallowClick = true;
      turn(releaseStep(event.clientX - start.x, event.timeStamp - start.t, boxWidth));
    }
    dragging = false;
    dragX = 0;
    start = undefined;
  }
  function cancel(): void {
    dragging = false;
    dragX = 0;
    start = undefined;
  }
  /**
   * Only the track's own capture ending cancels. A touch is captured to the
   * tile it lands on, and the track taking the capture for the drag sends that
   * tile a lostpointercapture which bubbles here: cancelling on it dropped
   * every touch swipe before its release.
   */
  function lost(event: PointerEvent): void {
    if (event.target === event.currentTarget) cancel();
  }

  const wheel = new WheelPager();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  function onWheel(event: WheelEvent): void {
    const step = wheel.push(event.deltaX, event.deltaY);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
    clearTimeout(quiet);
    quiet = setTimeout(() => wheel.reset(), 180);
    if (step !== 0) turn(step);
  }
  $effect(() => () => clearTimeout(quiet));

  let track: HTMLElement | undefined = $state();
  function focusSlot(pageIndex: number, slot: number): void {
    requestAnimationFrame(() => {
      const tiles = track?.querySelectorAll<HTMLElement>(`[data-page="${pageIndex}"] [data-slot]`);
      const target = tiles?.[Math.min(slot, (tiles?.length ?? 1) - 1)];
      focusControl(target, { within: false });
    });
  }

  function steer(event: Event, slot: number): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    const column = slot % shape.columns;
    const row = Math.floor(slot / shape.columns);
    const filled = pages[current]!.slots.filter((item) => item !== undefined).length;
    if (direction === "right") {
      if (column < shape.columns - 1 && slot + 1 < filled) return; // the walk reaches the neighbour
      if (count <= 1) return;
      event.preventDefault();
      turn(1);
      focusSlot(page, row * shape.columns);
    } else if (direction === "left") {
      if (column > 0) return;
      if (count <= 1) return;
      event.preventDefault();
      turn(-1);
      focusSlot(page, row * shape.columns + shape.columns - 1);
    }
  }

  function pageEvent(event: Event): void {
    const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
    if (stacked || count <= 1) return;
    event.preventDefault();
    turn(direction === "next" ? 1 : -1);
  }

  function keys(event: KeyboardEvent): void {
    if (stacked) return;
    if (event.key === "PageDown" || event.key === "e" || event.key === "E") turn(1);
    else if (event.key === "PageUp" || event.key === "q" || event.key === "Q") turn(-1);
    else return;
    event.preventDefault();
  }

  const animate = $derived(!dragging && !reducedMotion());
</script>

{#snippet flags(id: string)}
  {#each cursorsOn(id) as cursor, index (cursor.seat)}
    <span data-testid="cursor-flag" class="ff-tile__flag {cursorClass(cursor)}" style:--ff-flag-index={index}>{seatFlag(cursor.seat)}</span>
  {/each}
{/snippet}

{#snippet randomCard()}
  {#if random !== undefined}
    <!-- A line of its own, with its word on it: a tile this small has no room for one. -->
    <div class="ff-tiles__random">
      <button
        type="button"
        data-motion="none"
        data-testid="tile-random"
        data-focused={String(focusedId === RANDOM_ID)}
        data-previewed={String(previewId === RANDOM_ID)}
        aria-label={random.label}
        aria-pressed={String(focusedId === RANDOM_ID)}
        class="ff-tile ff-tile--random {seatClass(RANDOM_ID)}"
        onclick={() => press(RANDOM_ID)}
      >
        <span class="ff-tile__glyph" aria-hidden="true">?</span>
        <span class="ff-tile__word">{random.label}</span>
        {@render flags(RANDOM_ID)}
      </button>
    </div>
  {/if}
{/snippet}

<!-- A chip: the face alone. Its name, hint and state are the picker's to
     show (select spec §6.3); the label names it in full, and a locked or DLC
     chip still takes its taps, so the picker can show what it costs. -->
{#snippet card(item: TileItem, slot: number | undefined)}
  <button
    type="button"
    data-motion="none"
    data-testid="tile"
    data-sfx={item.id === opensSheet ? "none" : undefined}
    data-slot={slot}
    data-id={item.id}
    data-state={item.state}
    data-focused={String(item.id === focusedId)}
    data-previewed={String(item.id === previewId)}
    aria-label={accessibleName(item)}
    aria-pressed={String(item.id === focusedId)}
    class="ff-tile ff-tile--{item.state} {seatClass(item.id)}"
    onclick={() => {
      revealIfNew(item);
      press(item.id);
    }}
    onfocus={() => revealIfNew(item)}
    use:revealOnce={item.isNew === true}
    onff-steer={slot === undefined ? undefined : (event: Event) => steer(event, slot)}
  >
    <span class="ff-tile__face">
      {#if item.art !== undefined}<AsyncImage src={item.art} class="ff-tile__art" fit="contain" />{/if}
      {#if item.state === "locked"}<span data-testid="tile-lock" class="ff-tile__lock" aria-hidden="true">🔒</span>{/if}
      {#if item.state === "dlc"}<span data-testid="tile-dlc" class="ff-tile__pill">{m.select_dlc()}</span>{/if}
      {#if item.isNew === true}<span data-testid="tile-new" class="ff-tile__pill ff-tile__pill--new" aria-hidden="true">{m.select_new()}</span>{/if}
    </span>
    {@render flags(item.id)}
  </button>
{/snippet}

{#snippet arrow(direction: "previous" | "next")}
  <IconButton
    icon={direction === "previous" ? "chevron-left" : "chevron-right"}
    label={direction === "previous" ? m.a11y_previous_page() : m.a11y_next_page()}
    data-testid={direction === "previous" ? "page-previous" : "page-next"}
    class="ff-tiles__arrow"
    onclick={() => turn(direction === "previous" ? -1 : 1)}
  />
{/snippet}

<div
  class="ff-tiles"
  class:ff-tiles--fill={fitHeight}
  data-fill={fitHeight ? "" : undefined}
  data-stackable={stack ? "" : undefined}
  role="group"
  aria-label={label}
  data-testid="tile-grid"
  bind:this={root}
  bind:clientWidth={rootWidth}
  bind:clientHeight={rootHeight}
  style:--ff-tile={`${stackSide ?? size}px`}
  style:--ff-tile-gap={`${GAP}px`}
  style:--ff-tile-columns={shape.columns}
  style:--ff-tile-rows={shape.rows}
  onkeydown={keys}
  onfocusin={holdChip}
  onfocusout={letChipGo}
  onff-page={pageEvent}
>
  {@render randomCard()}
  {#if stacked}
    <div data-testid="tile-stack" class="ff-tiles__stack">
      {#each groups.filter((group) => group.items.length > 0) as group, index (group.packId)}
        <section data-testid="tile-section" data-title={group.title} class="ff-tiles__cards" aria-label={group.title}>
          {#each group.items as item (item.id)}{@render card(item, undefined)}{/each}
        </section>
      {/each}
    </div>
  {:else}
    <div class="ff-tiles__row" bind:clientWidth={rowWidth}>
      {#if count > 1}{@render arrow("previous")}{/if}

      <div class="ff-tiles__viewport" bind:clientWidth={boxWidth} bind:clientHeight={boxHeight} onwheel={onWheel}>
        <div
          bind:this={track}
          data-testid="tile-track"
          class="ff-tiles__track"
          class:ff-tiles__track--animate={animate}
          style:transform={`translateX(calc(${-current} * (100% - var(--ff-tile-peek)) + ${dragX}px - ${current} * var(--ff-tile-gap)))`}
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={cancel}
          onlostpointercapture={lost}
        >
          {#each pages as tilePage, pageIndex (tilePage.key)}
            <div
              data-testid="tile-page"
              data-page={pageIndex}
              data-title={tilePage.title}
              role="group"
              aria-label={m.ready_tile_page({ title: tilePage.title, page: pageIndex + 1, count })}
              class="ff-tiles__page"
              inert={pageIndex !== current}
            >
              {#each tilePage.slots as item, slot (item?.id ?? `empty-${slot}`)}
                {#if item === undefined}
                  <span class="ff-tile ff-tile--empty" aria-hidden="true"></span>
                {:else}
                  {@render card(item, slot)}
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>

      {#if count > 1}{@render arrow("next")}{/if}
    </div>
  {/if}
</div>

<style>
  .ff-tiles {
    --ff-tile-peek: 0px;
    display: grid;
    /* One column no wider than the grid: every page of tiles sits in the
       row's min-content, and an automatic minimum would take it all. */
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  /* Filling a page's row: the row takes it all, and the viewport stretches
     to it so its measured height is the space given rather than the tiles'. */
  .ff-tiles--fill {
    height: 100%;
    grid-template-rows: minmax(0, 1fr);
  }
  .ff-tiles--fill:has(> .ff-tiles__random) { grid-template-rows: auto minmax(0, 1fr); }
  /* The ? chip: its own line above the pages, a wide chip with its word. */
  .ff-tiles__random { padding-top: 16px; padding-bottom: var(--ff-tile-gap); }
  .ff-tile.ff-tile--random {
    display: inline-flex;
    justify-content: flex-start;
    gap: 8px;
    width: auto;
    max-width: 100%;
    aspect-ratio: auto;
    height: var(--ff-aq-target);
    padding-inline: 14px;
  }
  .ff-tile__word { font: 600 var(--ff-type-body) / 1.1 var(--ff-font-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ff-tiles--fill .ff-tiles__row {
    align-items: stretch;
  }
  .ff-tiles--fill .ff-tiles__row > :not(.ff-tiles__viewport) {
    align-self: center;
  }
  /* A column flexbox, not a grid: the track stretches to the viewport's
     width, where a grid's auto column would size to the pages it holds. */
  .ff-tiles--fill .ff-tiles__viewport {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* A flex row, so whichever of the ? tile and the arrows are drawn, the
     viewport takes what they leave. */
  .ff-tiles__row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--ff-tile-gap);
    min-height: var(--ff-tile);
  }
  /* The viewport's top padding is the seat flag's headroom, so its tiles sit
     that much below the row's middle. The arrows and ? drop by the same
     amount, so they centre on the tiles rather than on the row. */
  .ff-tiles__row > :not(.ff-tiles__viewport) {
    flex: none;
    margin-top: 16px;
  }
  .ff-tiles__viewport {
    flex: 1 1 0;
    /* The pages beside this one are clipped, and the arrows reach them: a
       carousel's window, so paint containment rather than overflow, which the
       screen contract would read as hidden content; it also keeps the other
       pages out of any scrolling ancestor's overflow. */
    contain: paint;
    min-width: 0;
    height: 100%;
    /* Headroom for the seat flag, which sits above its tile, and side room for
       a tile's outline, which sits just outside it: the viewport's hidden
       overflow would clip both (OUTLINE_ROOM). */
    padding-top: 16px;
    padding-inline: 4px;
    min-height: calc(16px + var(--ff-tile) * var(--ff-tile-rows) + var(--ff-tile-gap) * (var(--ff-tile-rows) - 1));
  }
  .ff-tiles__track {
    display: flex;
    gap: var(--ff-tile-gap);
    touch-action: pan-y;
    user-select: none;
  }
  .ff-tiles__track--animate {
    transition: transform 220ms var(--ff-step-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
  }
  .ff-tiles__page {
    flex: 0 0 calc(100% - var(--ff-tile-peek));
    display: grid;
    grid-template-columns: repeat(var(--ff-tile-columns), var(--ff-tile));
    grid-auto-rows: var(--ff-tile);
    gap: var(--ff-tile-gap);
    justify-content: start;
  }
  .ff-tiles__stack {
    display: grid;
    /* From the top, under what is above: centred, a roster the panel was
       taller than left a blank band over its first row (a phone upright). */
    align-content: start;
    gap: var(--ff-tile-gap);
    height: 100%;
  }
  /* A stacked pack: its chips under the flag's 16 px headroom (FLAG_HEADROOM). */
  .ff-tiles__cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--ff-tile));
    gap: var(--ff-tile-gap);
    padding-top: 16px;
  }
  /* A chip: the square face alone. */
  .ff-tile {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    width: var(--ff-tile);
    height: var(--ff-tile);
    min-width: var(--ff-aq-target);
    min-height: var(--ff-aq-target);
    padding: 0;
    border-radius: var(--ff-control-radius);
    border: 1px solid var(--ff-panel-border, rgb(255 255 255 / 0.7));
    background: transparent;
    color: var(--ff-text);
    font: 600 var(--ff-type-tag) / 1.1 var(--ff-font-ui);
  }
  .ff-tile--empty {
    border-style: dashed;
    background: transparent;
    opacity: 0.5;
  }
  .ff-tile__glyph {
    font: 600 var(--ff-type-title) / 1 var(--ff-font-ui);
  }
  /* The bust fills the chip's width, standing on its bottom edge and pushed a
     little past it, so the portrait's cut-off base is hidden under the face's
     rounded clip. The clip is the face's, not the tile's, so the seat flag
     above the tile still shows. */
  .ff-tile__face {
    position: relative;
    display: grid;
    place-items: end center;
    width: 100%;
    height: 100%;
    min-height: 0;
    /* The face crops its portrait: art, not content, so a clip-path rather
       than overflow, which the screen contract would read as hidden. */
    clip-path: inset(0 round calc(var(--ff-control-radius) - 1px));
    border-radius: calc(var(--ff-control-radius) - 1px);
  }
  /* The art's frame and image are `AsyncImage`'s, outside this scope. */
  .ff-tile :global(.ff-tile__art) {
    display: block;
    width: 100%;
    max-width: none;
    height: auto;
    min-height: 0;
    margin-bottom: -10%;
    image-rendering: pixelated;
  }
  /* No size of its own until it arrives, so a square holds its place. */
  .ff-tile :global(.ff-tile__art:not([data-load="loaded"])) {
    aspect-ratio: 1;
  }
  .ff-tile :global(.ff-tile__art img) {
    height: auto;
  }
  /* Locked art keeps its colour, dimmed, so a player sees what they can earn. */
  .ff-tile--locked :global(.ff-tile__art) {
    filter: saturate(0.45) brightness(0.8) opacity(0.65);
  }
  .ff-tile--dlc :global(.ff-tile__art) {
    filter: grayscale(1) opacity(0.7);
  }
  .ff-tile__pill {
    position: absolute;
    top: 4px;
    left: 4px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--ff-text-2);
    color: var(--ff-panel-fill);
    font-size: var(--ff-type-tag);
    text-align: center;
  }
  /* Earned and not yet focused (unlockables spec §7.2): said in words, so the
     action colour is never the only signal. */
  .ff-tile__pill--new {
    background: var(--ff-plain);
    color: var(--ff-aq-white);
  }
  /* The first sight of an earned tile: a flip, or a fade under reduced
     motion. A transform keyframe, which the motion rules allow. */
  .ff-tile:global([data-reveal="flip"]) .ff-tile__face {
    animation: ff-reveal-flip 400ms steps(8) both;
  }
  .ff-tile:global([data-reveal="fade"]) .ff-tile__face {
    animation: ff-reveal-fade 200ms linear both;
  }
  @keyframes ff-reveal-flip {
    from {
      transform: perspective(400px) rotateY(180deg);
    }
    to {
      transform: none;
    }
  }
  @keyframes ff-reveal-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .ff-tile__lock {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: var(--ff-type-title);
  }
  .ff-tile[data-focused="true"] {
    outline: 3px solid var(--ff-seat-colour, var(--ff-plain));
    outline-offset: 1px;
  }
  /* Looking, not picking: lighter, and never over the chosen frame. */
  .ff-tile[data-previewed="true"]:not([data-focused="true"]) {
    outline: 3px solid color-mix(in srgb, var(--ff-plain) 55%, white);
    outline-offset: 1px;
  }
  .ff-tile__flag {
    position: absolute;
    top: calc(-14px - var(--ff-flag-index, 0) * 16px);
    left: 6px;
    padding: 0 6px;
    border-radius: 6px 6px 0 0;
    font: 600 var(--ff-type-tag) / 16px var(--ff-font-ui);
    color: white;
    background: var(--ff-seat-colour);
  }
  /* Sized here; the face is the kit's. */
  :global(.ff-tiles__arrow) {
    width: var(--ff-aq-target);
    height: var(--ff-aq-target);
    border-radius: 999px;
  }
</style>
