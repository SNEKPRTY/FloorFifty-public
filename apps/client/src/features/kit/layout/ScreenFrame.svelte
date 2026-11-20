<script lang="ts">
  /**
   * Every shell screen's frame (UI layout system spec §5).
   *
   * It fills the visible band -- between the letterbox bars, above whatever
   * the browser lays over the page's foot -- less the safe areas and the
   * gutter. Its first row is Back, any header and Mute, in flow, so they
   * never sit over the content. Below that it arranges a hero and a body:
   *   stack: the rows `--ff-stack-rows` gives (by default the hero takes what
   *          the body leaves, so on a short screen the hero shrinks first and
   *          never pushes the body off the screen);
   *   split: the hero and the body side by side;
   *   rail:  the body against the right edge, the hero behind the whole area.
   * The screen root picks the arrangement from the form factor and the
   * height tier; nothing inside the frame branches on either. The body is the
   * `ff-screen` size container its contents query.
   */
  import type { Snippet } from "svelte";
  import type { SettingsStore } from "../../profile/store/settings.svelte";
  import CornerControls from "./CornerControls.svelte";

  let {
    arrangement,
    settings,
    header,
    hero,
    body,
    actions,
    back,
    backTestId,
    mute = true,
    language,
    headerAt,
    testId,
  }: {
    arrangement: "stack" | "split" | "rail";
    settings: SettingsStore;
    header?: Snippet;
    hero?: Snippet;
    body: Snippet;
    actions?: Snippet;
    back?: () => void;
    backTestId?: string;
    mute?: boolean;
    /** Opens the language picker from a flag beside Mute (the title). */
    language?: () => void;
    /** Where the header sits in the corner row; by default the arrangement decides. */
    headerAt?: "centre" | "start";
    testId?: string;
  } = $props();

  let content: HTMLElement | undefined = $state();
  let heroCell: HTMLElement | undefined = $state();

  /**
   * Under a notice at the top (`Notice` says where it ends): the hero gives up
   * only what the notice reaches below the top of this cell, since the corner
   * row above already holds the top of the window. The whole height of the
   * notice, as this once took, pushed a small phone's wordmark under the menu.
   */
  $effect(() => {
    if (content === undefined || heroCell === undefined || heroCell === null) return;
    const cell: HTMLElement = heroCell;
    const frame: HTMLElement = content;
    const root = document.documentElement;
    const place = (): void => {
      if (!cell.isConnected) return;
      const ends = Number.parseFloat(root.style.getPropertyValue("--ff-notice-bottom"));
      const room = Number.isFinite(ends) ? Math.max(0, ends - frame.getBoundingClientRect().top) : 0;
      cell.style.paddingTop = room > 0 ? `${Math.ceil(room)}px` : "";
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(frame);
    const changed = new MutationObserver(place);
    changed.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      resized.disconnect();
      changed.disconnect();
      if (cell.isConnected) cell.style.paddingTop = "";
    };
  });
</script>

<div class="ff-screen-frame" data-screen-frame data-arrangement={arrangement} data-testid={testId}>
  <CornerControls {settings} {back} {backTestId} {mute} {language} {header} headerAt={headerAt ?? (arrangement === "stack" ? "start" : "centre")} />
  <div class="ff-screen-frame__content" bind:this={content}>
    {#if hero}
      <div class="ff-screen-frame__hero" bind:this={heroCell}>{@render hero()}</div>
    {/if}
    <div class="ff-screen-frame__body">
      {@render body()}
      {#if actions}
        <div class="ff-screen-frame__actions">{@render actions()}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .ff-screen-frame {
    position: fixed;
    inset-inline: 0;
    top: var(--ff-band-top);
    height: min(var(--ff-band-height), calc(100dvh - var(--ff-band-top) - var(--ff-visual-inset-bottom, 0px)));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--ff-gutter);
    padding: max(var(--ff-gutter), env(safe-area-inset-top)) max(var(--ff-gutter), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px))
      max(var(--ff-gutter), env(safe-area-inset-bottom)) max(var(--ff-gutter), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
  }

  /* At rest everything fits. While a bar the browser lays over the page's
     foot covers it (`data-visual-inset`, from the viewport tracker) the frame
     is shorter than what it holds, and it scrolls what does not fit into
     view rather than leaving an action under the bar (responsive parity
     gate round 3). */
  :global([data-visual-inset]) .ff-screen-frame {
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .ff-screen-frame__content {
    display: grid;
    gap: var(--ff-gutter);
    min-height: 0;
    min-width: 0;
  }

  /* Not clipped: the hero's art (the menu's building, run down to the
     screen's foot) may reach past its cell, and the body paints over it. */
  .ff-screen-frame__hero {
    /* Under a notice at the top: the padding is set from the notice (script above). */
    min-height: 0;
    min-width: 0;
    display: grid;
    place-items: center;
  }

  /* A named size container (Task 0's contract, binding): a composition in the
     body sizes itself with `@container ff-screen (…)` against the room the
     frame gives it, never against the viewport. */
  /* `--ff-ui-zoom` scales the body and the corner row on a tablet
     (aquarian-tokens); the hero keeps its own size. */
  .ff-screen-frame__body,
  .ff-screen-frame > :global([data-corner-controls]) {
    zoom: var(--ff-ui-zoom, 1);
  }

  /* The body paints over the hero's art: the ledge and its racers carry their
     own z-index, which on a short window put them over the body's first row. */
  .ff-screen-frame__body {
    position: relative;
    z-index: 2;
  }

  .ff-screen-frame__body {
    /* A dialog opened from inside the body is drawn inside this zoom, so the
       band it is fixed to is scaled by it too; the Modal divides that back out. */
    --ff-ancestor-zoom: var(--ff-ui-zoom, 1);
    container: ff-screen / size;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: var(--ff-gutter);
    min-height: 0;
    min-width: 0;
  }

  .ff-screen-frame__body:not(:has(> .ff-screen-frame__actions)) {
    grid-template-rows: minmax(0, 1fr);
  }

  /* Stack: the token says how hero and body share the height; a phone puts
     the body on the bottom edge, a tablet the body under the hero. */
  .ff-screen-frame[data-arrangement="stack"] .ff-screen-frame__content {
    grid-template-rows: var(--ff-stack-rows, minmax(0, 1fr) auto);
  }

  .ff-screen-frame[data-arrangement="stack"] .ff-screen-frame__content:not(:has(> .ff-screen-frame__hero)) {
    grid-template-rows: minmax(0, 1fr);
  }

  /* A stack with a hero sizes its body to the body's content (the menu sheet
     on a phone's foot), and a size container has no content size: it would
     collapse to nothing. There the body measures its width only. Everywhere
     else the body's row is allotted (`1fr`), and it stays a size container. */
  .ff-screen-frame[data-arrangement="stack"] .ff-screen-frame__content:has(> .ff-screen-frame__hero) > .ff-screen-frame__body {
    container-type: inline-size;
  }

  /* Split: hero and body side by side. The body's column is allotted, up to
     `--ff-split-body` (the menu sheet's width by default), because a size
     container has no content width of its own: in an `auto` column it would
     collapse to nothing. It stretches to the row for the same reason. The
     body is zoomed (`--ff-ui-zoom`), so a sheet `--ff-sheet-width` wide in
     its own units is drawn zoom times wider: the default column reserves
     that drawn width, or the sheet runs off the right edge on a desktop. A
     screen that sets `--ff-split-body` gives the drawn width itself. */
  .ff-screen-frame[data-arrangement="split"] .ff-screen-frame__content {
    grid-template-columns: minmax(0, 1fr) minmax(0, var(--ff-split-body, calc(var(--ff-sheet-width) * var(--ff-ui-zoom, 1))));
    align-items: center;
  }

  .ff-screen-frame[data-arrangement="split"] .ff-screen-frame__body {
    align-self: stretch;
  }

  .ff-screen-frame[data-arrangement="split"] .ff-screen-frame__content:not(:has(> .ff-screen-frame__hero)) {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Rail: the hero fills the area behind, the body sits on the right. */
  .ff-screen-frame[data-arrangement="rail"] .ff-screen-frame__content {
    grid-template-columns: minmax(0, 1fr) minmax(var(--ff-panel-min), var(--ff-panel-max));
  }

  .ff-screen-frame[data-arrangement="rail"] .ff-screen-frame__hero {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  .ff-screen-frame[data-arrangement="rail"] .ff-screen-frame__body {
    grid-column: 2;
    grid-row: 1;
    z-index: 1;
  }
</style>
