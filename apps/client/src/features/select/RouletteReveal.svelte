<script lang="ts">
  /**
   * The roulette reveal (select spec §5.3, §6.2, amended 2026-09-30): in the
   * picker's own frame, so the screen keeps its shape. The server has
   * already chosen; a highlight steps down the players' rows, slowing, the
   * scene showing each row's pick as it passes, and lands on the winner;
   * then the headline names the result and whose pick it was. Alone, or
   * under reduced motion, the result shows at once. It stays mounted until
   * the Lobby hands over as the countdown begins; the count itself is the
   * race's, over the stage (race-flow spec §3).
   */
  import { untrack, type Snippet } from "svelte";
  import { GROW, growFrom, reducedMotion } from "../kit/motion";
  import type { PlayerRow } from "./select-model";
  import PlayerRows from "./PlayerRows.svelte";
  import Panel from "../kit/Panel.svelte";
  import SelectFrame from "./SelectFrame.svelte";

  let {
    heading,
    rows,
    winnerSeat,
    resultId = undefined,
    resultLabel,
    resultByline,
    solo,
    onSettled = undefined,
    art = undefined,
    artBehind = undefined,
    scene,
  }: {
    heading: string;
    rows: readonly PlayerRow[];
    winnerSeat: number;
    /** What the roulette landed on; for a winning "?", the stage it resolved to. */
    resultId?: string | undefined;
    resultLabel: string;
    resultByline: string;
    solo: boolean;
    /** Once, when the highlight lands: the song's reveal plays its opening then. */
    onSettled?: () => void;
    /**
     * An item's image by ID. Once the highlight lands, the result's image
     * fills the whole frame, panel and all, for the seconds the room holds
     * its choice; without one the frame stays as it was.
     */
    art?: ((id: string) => string | undefined) | undefined;
    /** A smaller copy of the same art, already loaded, drawn under it until it arrives. */
    artBehind?: ((id: string) => string | undefined) | undefined;
    scene: Snippet<[string]>;
  } = $props();

  const SPIN_MS = 2200;
  /**
   * The room as it stood when the reveal began, held for the rest of it: a
   * player who leaves mid-reveal is dropped from the room's list and the
   * seats after them move up, which would move the highlight off the winner
   * and credit the pick to someone else (review 1).
   */
  const shownRows = untrack(() => [...rows]);
  const shownWinner = untrack(() => winnerSeat);
  const shownResultId = untrack(() => resultId);
  const shownLabel = untrack(() => resultLabel);
  const shownByline = untrack(() => resultByline);
  const winnerPresent = shownRows.some((row) => row.seat === shownWinner);
  // Decided once, on mount: the reveal stays mounted through loading and the
  // countdown, and a spin that restarted would replay a result already known.
  // A winner no longer in the room has no row to land on: no spin.
  const skip = untrack(() => solo || reducedMotion() || shownRows.length <= 1) || !winnerPresent;
  let lit = $state(skip ? shownWinner : (shownRows[0]?.seat ?? shownWinner));
  let settled = $state(skip);

  $effect(() => {
    if (skip) return;
    const order = shownRows.map((row) => row.seat);
    const target = order.indexOf(shownWinner);
    // Two full passes, then on to the winner, each step a little slower.
    const hops = order.length * 2 + Math.max(0, target);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    for (let hop = 0; hop <= hops; hop += 1) {
      at = SPIN_MS * (hop / hops) ** 2;
      timers.push(setTimeout(() => (lit = order[hop % order.length]!), at));
    }
    timers.push(setTimeout(() => (settled = true), at + 250));
    return () => timers.forEach(clearTimeout);
  });

  // `settled` only ever goes from false to true, so this runs once: on mount
  // when there is no spin, else when the spin lands.
  $effect(() => {
    if (settled) untrack(() => onSettled?.());
  });

  const litItem = $derived(shownRows.find((row) => row.seat === lit)?.itemId ?? "?");
  const winnerItem = shownRows.find((row) => row.seat === shownWinner)?.itemId ?? "?";
  /** The scene shows the row the highlight is on, then the stage the room landed on. */
  const shown = $derived(settled ? (shownResultId ?? winnerItem) : litItem);
  const fill = $derived(settled ? art?.(shown) : undefined);
  const fillBehind = $derived(settled ? artBehind?.(shown) : undefined);
  // The result is known on mount: fetch its art while the spin runs, so it is
  // there when the highlight lands.
  untrack(() => {
    const result = art?.(shownResultId ?? winnerItem);
    if (result !== undefined && typeof Image !== "undefined") new Image().src = result;
  });
  const still = reducedMotion();
  /** The name waits for the image to open out. */
  const nameStyle = `animation-delay: ${GROW}s`;
  /**
   * Where the art stood, found from the fill: a song's cover, else the
   * stage's still, else the scene. From the fill rather than a bound handle
   * on the reveal, which a fill there from the start (no spin) arrives before.
   */
  const artBox = (fill: HTMLElement): Element | null | undefined => {
    const reveal = fill.closest(".ff-roulette");
    return [".ff-song-slide__cover", ".ff-slide__still", ""].map((inner) => reveal?.querySelector(`.ff-roulette__scene ${inner}`.trim())).find((found) => found != null);
  };
</script>

{#snippet frameScene()}
  <div class="ff-roulette__scene">{#key shown}{@render scene(shown)}{/key}</div>
{/snippet}
{#snippet frameHeadline()}<span data-testid="roulette-result">{settled ? shownLabel : ""}</span>{/snippet}
{#snippet frameAction()}
  <!-- Whose pick won lives in the winner's row; a winner who left has no row,
       so the line stays here, empty, as the reveal has always drawn it. -->
  {#if settled && !winnerPresent}<span class="ff-roulette__byline" data-testid="roulette-byline">{shownByline}</span>{/if}
{/snippet}
{#snippet framePlayers()}<PlayerRows
    rows={shownRows}
    highlightSeat={winnerPresent || !settled ? lit : undefined}
    winnerSeat={settled && winnerPresent ? shownWinner : undefined}
    winnerBadge={settled && winnerPresent ? shownByline : undefined}
  />{/snippet}

<!-- The frame's snippets are named apart from the `scene` prop, which draws an item by ID. -->
<div class="ff-roulette" data-testid="roulette" data-settled={String(settled)} data-filled={fill !== undefined ? "" : undefined}>
  <SelectFrame {heading} live testId="roulette-frame" scene={frameScene} headline={frameHeadline} action={frameAction} players={framePlayers} />
  <!-- The result, full bleed, over the frame. The frame fades out as it
       grows, so only the art is left, but stays in the page: its headline
       still announces the result. -->
  {#if fill !== undefined}
    <div class="ff-roulette__fill" data-testid="roulette-fill" data-motion={still ? "still" : "grow"} aria-hidden="true" use:growFrom={artBox}>
      <img src={fill} alt="" draggable="false" style:background-image={fillBehind === undefined || fillBehind === fill ? undefined : `url("${fillBehind}")`} />
      <!-- The name arrives once the image has opened out. -->
      <Panel class="ff-roulette__fill-name" arrive="none" leave="none" style={nameStyle}>{shownLabel}</Panel>
    </div>
  {/if}
</div>

<style>
  .ff-roulette { position: relative; height: 100%; min-height: 0; }
  /* Under the growing art, the picker's frame goes, quicker than the art
     opens out, so nothing is left peeking round its edges. */
  .ff-roulette > :global(*:not(.ff-roulette__fill)) { transition: opacity 240ms linear; }
  .ff-roulette[data-filled] > :global(*:not(.ff-roulette__fill)) { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    .ff-roulette > :global(*:not(.ff-roulette__fill)) { transition: none; }
  }
  .ff-roulette__fill {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: hidden;
    border-radius: var(--ff-panel-radius);
    box-shadow: none;
    background: var(--ff-panel-border);
  }
  .ff-roulette__fill[data-motion="grow"] :global(.ff-roulette__fill-name) { animation: ff-roulette-name 160ms linear both; }
  @keyframes ff-roulette-name {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .ff-roulette__fill img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* The stand-in under it, cropped the way the image is. */
    background-size: cover;
    background-position: center;
    image-rendering: pixelated;
  }
  /* The name on a glass pill at the foot, so the image is never unlabelled. */
  .ff-roulette__fill :global(.ff-roulette__fill-name) {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    padding: 8px 20px;
    border-radius: var(--ff-control-radius);
    font: 600 round(down, clamp(20px, 5vmin, 40px), var(--ff-type-hint)) / 1.1 var(--ff-font-ui);
    color: var(--ff-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The seed under the name, smaller, so the pill still reads as the stage first. */
  .ff-roulette__scene { position: absolute; inset: 0; border-radius: var(--ff-panel-radius); overflow: hidden; }
  .ff-roulette__byline { font: 600 var(--ff-type-hint) / 1.2 var(--ff-font-ui); color: var(--ff-text); }
</style>
