<script lang="ts">
  /**
   * The menu's hero: the wordmark, the racers on their ledge, the on-screen
   * help and the tagline (responsive parity spec §3.4, §5.2).
   *
   * Split out of `ConnectPanel` so the form can move into `MenuSheet` without
   * taking the hero with it. The hero sits in the open sky above the sheet on
   * a phone held upright, beside the form column held sideways and on
   * desktop, and centred over the card on a tablet held upright.
   *
   * The ensemble is the four racer portraits the seats also use, so the menu
   * shows the actual cast rather than an invented illustration of it.
   */
  import * as m from "../../paraglide/messages.js";
  import { SEAT_SCARVES } from "../../lib/constants";
  import { lineupSheet, type LineupRacer } from "../select/menu-lineup";
  import { reducedMotion } from "../kit/motion";
  import Panel from "../kit/Panel.svelte";
  import Rise from "../kit/Rise.svelte";
  import { onRacerHopRequest } from "./racer-hops";
  import { facadeWindows } from "./facade-windows";
  import { productionArt } from "../../lib/image-retry";
  import { reachFloor } from "../race/reach-floor";
  import { slideFrom, type WordmarkPlaces } from "../boot/wordmark-handoff";
  import { wordmarkHeat } from "../boot/wordmark-heat";
  import AsyncImage from "../kit/AsyncImage.svelte";

  /**
   * Whether the hero rises in. Off when the player moves between the title
   * and the lobby: both draw this same hero in the same place, so replaying
   * its entrance reads as the page reloading when only the panel changed.
   *
   * `drop`: the racers fall a short way onto the ledge, one after another, as
   * the hero arrives. On only coming in from the splash, the game's first
   * look at the cast.
   *
   * `wordmarkFrom`: where the splash left its wordmark. The wordmark then
   * slides over from there instead of rising in, so the splash's and the
   * title's read as the one wordmark moving (`wordmark-handoff`). It
   * arrives in the splash's heat and cools as it slides (`wordmark-heat`).
   */
  /**
   * `racers`: who stands on the ledge, left to right -- you in front, then
   * the last players you saw (`menu-lineup`). Without it, the four ninjas.
   */
  let {
    rise = true,
    drop = false,
    wordmarkFrom,
    racers = SEAT_SCARVES.map((colour) => ({ characterId: "ninja", colour })),
    centred = false,
    tagline = true,
  }: {
    rise?: boolean;
    drop?: boolean;
    wordmarkFrom?: WordmarkPlaces | undefined;
    racers?: readonly LineupRacer[];
    /** Centred over a stacked form (a tablet held upright), the ledge a plinth. */
    centred?: boolean;
    /** False where the screen has no room for the line (a phone held upright). */
    tagline?: boolean;
  } = $props();

  /**
   * What each racer is doing: dropping in, mid-hop, or standing (absent).
   *
   * A pointer landing on a racer starts one hop, and the hop always finishes:
   * it ends on its own `animationend` rather than on the pointer leaving, so a
   * racer brushed in passing still lands instead of snapping back to the
   * ledge mid-air. A mouse or a pen starts one by hovering; a touch never
   * hovers, so a tap starts it instead (responsive parity spec §5.8). A touch
   * fires `pointerenter` on the racer it lands on, just before
   * `pointerdown`, so the one handler serves both. A controller's
   * shoulder buttons start one each (`racer-hops`). A racer still dropping in does not
   * hop until it has landed.
   */
  // At the site's base: a staging build is served from a sub-path.
  const FACADE = productionArt("menu-facade.png");
  const LEDGE = productionArt("menu-ledge.png");
  const LEDGE_SLAB = productionArt("menu-ledge-slab.png");

  let moving = $state<Record<string, "drop" | "hop">>(
    // Read once: the entrance is decided on arrival and never replayed.
    // svelte-ignore state_referenced_locally
    drop && !reducedMotion() ? Object.fromEntries(SEAT_SCARVES.map((_colour, place) => [String(place), "drop" as const])) : {},
  );

  // By place on the ledge, not by colour: two racers may share one.
  function hop(place: number): void {
    const key = String(place);
    if (moving[key] !== undefined || reducedMotion()) return;
    moving[key] = "hop";
  }

  function landed(place: number, event: AnimationEvent): void {
    // The sheet's own row steps finish on the same beat; only the arc ends it.
    if (event.target !== event.currentTarget) return;
    delete moving[String(place)];
  }

  // The building's dark return is drawn by the facade's border, so without its
  // art (the network gone when the menu comes back) it would stand alone as two
  // thin lines: it shows only once the art has arrived.
  let facadeArt = $state(false);
  $effect(() => {
    const probe = new Image();
    probe.onload = () => (facadeArt = true);
    probe.src = FACADE;
    return () => (probe.onload = null);
  });

  $effect(() =>
    onRacerHopRequest((seat) => {
      if (seat >= 0 && seat < racers.length) hop(seat);
    }),
  );
</script>

<!-- The hero starts at the top of its cell, in the open sky; beside the form
     (a split) it centres in its column. Its gap, its inset and its ledge's
     scale are tokens per form factor (aquarian-tokens.css); whether it is
     centred is its root's call (`centred`). The on-screen help is not here:
     the phone boards set it at the sheet's foot, so it lives in `ConnectPanel`. -->
<div class="ff-hero grid content-start" data-centred={centred ? "" : undefined}>
  <!-- The wordmark sits directly on the sky, large and inset from the gutter as
       the Aquarian board sets it: a pearl-to-ice fill with a soft drop, which
       keeps its edge on the palest part of the sky without the hard outline
       (spec §2.8 item 3). -->
  <Rise class="ff-menu-wordmark-frame" delay={0} still={!rise || wordmarkFrom !== undefined}>
    <h1
      class="ff-wordmark ff-wordmark--light ff-menu-wordmark m-0"
      data-testid="menu-wordmark"
      use:slideFrom={wordmarkFrom}
      use:wordmarkHeat={wordmarkFrom !== undefined ? "cool" : "off"}
    >
      <span>Floor</span>
      <span>Fifty</span>
    </h1>
  </Rise>

  <!-- The tagline stays in the hero, under the wordmark and centred under it,
       on every view. The lobby turns it off on a phone held upright, where
       its sheet reaches up over it. -->
  <div class="ff-tagline-frame" class:ff-tagline-frame--off={!tagline}>
    <Panel order={3} arrive={rise ? "rise" : "none"} leave="none" class="ff-tagline" data-testid="menu-tagline">
      {m.title_tagline()}
    </Panel>
  </div>

  <!-- The four racers stand on a rooftop ledge that runs off the left edge of
       the screen, as the board draws it. The ledge is three pieces of the one
       piece of art: the pipe and the planters keep their shape at either end
       and the slab between them repeats, so the planters land past the last
       racer instead of between two of them. Three backgrounds rather than a
       nine-slice `border-image`, which iPadOS Safari stops painting a few
       seconds after the menu appears.

       Under it is the building it is the parapet of, run down to the bottom
       of the picture, so the ledge is a roof rather than a slab floating in
       the sky. First, so the ledge draws over its top edge. Its lit windows
       breathe on the menu's clock and kick (`facade-windows`), as the race's
       city windows do. -->
  <Rise delay={2} still={!rise} class="ff-ensemble-frame">
    <div
      class="ff-menu-facade"
      aria-hidden="true"
      data-testid="menu-facade"
      data-art={facadeArt ? "ready" : "loading"}
      style:background-image={`url(${FACADE})`}
      use:reachFloor
      use:facadeWindows={FACADE}
    ></div>
    <ul class="ff-ensemble m-0 flex list-none items-end p-0" aria-hidden="true">
      {#each racers as racer, place (place)}
        <li
          class="ff-menu-racer-frame"
          data-testid="menu-racer-frame"
          class:ff-menu-racer-frame--hop={moving[String(place)] === "hop"}
          class:ff-menu-racer-frame--drop={moving[String(place)] === "drop"}
          style:--ff-racer-drop-order={racers.length - 1 - place}
          onpointerenter={() => hop(place)}
          onanimationend={(event) => landed(place, event)}
        >
          <AsyncImage src={lineupSheet(racer)} width={256} height={448} class="ff-menu-racer" testId="menu-racer" tone="none" ring={false} />
        </li>
      {/each}
    </ul>
    <div class="ff-menu-ledge" aria-hidden="true" data-testid="menu-ledge">
      <span
        class="ff-menu-ledge__end ff-menu-ledge__end--pipe"
        style:background-image={`url(${LEDGE})`}
      ></span>
      <span
        class="ff-menu-ledge__slab"
        style:background-image={`url(${LEDGE_SLAB})`}
      ></span>
      <span
        class="ff-menu-ledge__end ff-menu-ledge__end--planters"
        style:background-image={`url(${LEDGE})`}
      ></span>
    </div>
  </Rise>

</div>

<style>
  /* The hero's custom properties, set once on its root so the title's hero
     and the lobby's cannot drift apart. Scale and inset are tokens. */
  .ff-hero {
    --ff-menu-gutter: var(--ff-gutter);
    --ff-intro-inset: var(--ff-hero-inset);
    gap: var(--ff-hero-gap);
    padding-left: var(--ff-hero-inset);
    /* One column, as wide as the racers: the wordmark centres over them
       (below), so it takes no width of its own. */
    grid-template-columns: max-content;
  }

  /* Beside the form, the hero centres in its column. */
  :global([data-arrangement="split"]) .ff-hero {
    align-content: center;
  }

  /* Centred over a stacked form: the whole hero, a little below the top. */
  .ff-hero[data-centred] {
    justify-content: center;
    justify-items: center;
    padding-top: 6vh;
  }

  /* The wordmark stands centred over the racers, its two lines centred on
     each other. Its frame is a zero-width point at the middle of the racers'
     column, and the wordmark spills out of it evenly on both sides, so a
     wordmark wider than the racers stays centred over them rather than
     widening the column and pushing them off its middle. */
  :global(.ff-menu-wordmark-frame) {
    justify-self: center;
    width: 0;
    display: flex;
    justify-content: center;
  }

  /* Large, as the board sets it, at the form factor's wordmark size. The
     padding clears the ink of the "y" that hangs below "Fifty", so the racers
     beneath it never run into it. 0.25em is the last line's own ink padding
     (`.ff-wordmark--light > span`), which would otherwise hang out of this
     box and lie over the tagline. */
  .ff-menu-wordmark {
    flex: none;
    font-size: round(down, var(--ff-type-wordmark), var(--ff-wordmark-step, 1px));
    padding-bottom: 0.25em;
    text-align: center;
  }

  .ff-menu-wordmark span {
    display: block;
  }

  /* A short hero (a small phone held upright, with a note over
     the form): "Floor Fifty" on one line and no inset from the top, so the
     wordmark and the racers fit the cell instead of running under the offer
     (visual audit, 2026-10-05). The cell is a container only where its
     screen root makes it one (LobbyRoot). */
  @container ff-hero (max-height: 220px) {
    .ff-hero[data-centred] {
      padding-top: 0;
    }
    .ff-menu-wordmark {
      font-size: round(down, min(var(--ff-type-wordmark), 44px), var(--ff-wordmark-step, 1px));
      white-space: nowrap;
    }
    .ff-menu-wordmark span {
      display: inline;
    }
  }

  /* The tagline is on the open sky under the wordmark on every view, never in
     a bar: it keeps to the racers' column and wraps inside it, balanced,
     rather than spilling from a zero-width point (a translation wider than
     the racers ran off the screen's left edge or under the panel, visual
     audit 2026-10-05). The frame is zero wide so it never widens the column,
     and the column's width at least so the line wraps in it. */
  .ff-tagline-frame {
    /* Over the ledge's box, which reaches up past the racers' heads on a
       short screen (zh-Hans, SE sideways: the planters' box lay over the
       line's foot). */
    position: relative;
    z-index: 1;
    grid-column: 1 / -1;
    justify-self: center;
    width: 0;
    min-width: 100%;
    display: flex;
    justify-content: center;
  }

  :global(.ff-tagline) {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    margin: 0;
    font: 600 var(--ff-type-hint) / 1.25 var(--ff-font-ui);
    text-wrap: balance;
    color: var(--ff-text);
    text-align: center;
    /* On the one glass panel, so the white words read over the palest sky as
       well as the dark city (review R36: never a plate of its own). */
    border-radius: 6px;
    padding: 4px 12px;
  }

  /* Centred over a stacked form: the line may be wider than the racers, up to
     the screen, so a short screen keeps it to one line instead of two. */
  .ff-hero[data-centred] :global(.ff-tagline) {
    flex: none;
    width: max-content;
    font-size: var(--ff-type-hint);
    max-width: calc(100vw - 2 * var(--ff-gutter));
  }

  /* No room for the line (a phone held upright: in the lobby the connect
     sheet reaches up over it, and the title keeps the hero the same). Last,
     so the frame takes no row and the line no bar. */
  .ff-tagline-frame.ff-tagline-frame--off {
    display: none;
  }

  :global(.ff-ensemble-frame) {
    position: relative;
    /* The racers' z-index orders them over the ledge and stops here, so it
       never lifts them over the sheet. */
    isolation: isolate;
    justify-self: start;
    /* Room under the racers' feet for the ledge's slab. */
    padding-bottom: calc(38px * var(--ff-ledge-scale));
  }

  :global(.ff-ensemble-frame) .ff-ensemble {
    position: relative;
    z-index: 1;
    gap: var(--ff-ensemble-gap);
  }

  /* The 480 x 96 ledge in three: the 60px pipe end, the 110px planter end,
     and the 310px slab between them (its own tile) repeated. Left runs to the
     screen's edge, right stops just past the last racer. */
  .ff-menu-ledge {
    position: absolute;
    bottom: 0;
    left: calc(-1 * (var(--ff-menu-gutter) + var(--ff-intro-inset)) - 2px);
    right: calc(-110px * var(--ff-ledge-scale) - 4px);
    height: calc(96px * var(--ff-ledge-scale));
    display: flex;
  }

  /* Each end is a window onto the whole plate, pinned to its own side, so the
     box's width crops the plate to that end. */
  .ff-menu-ledge__end {
    flex: none;
    background-size: calc(480px * var(--ff-ledge-scale)) 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
  }

  .ff-menu-ledge__end--pipe {
    width: calc(60px * var(--ff-ledge-scale));
    background-position: left top;
  }

  .ff-menu-ledge__end--planters {
    width: calc(110px * var(--ff-ledge-scale));
    background-position: right top;
  }

  /* `round` fits a whole number of slabs, scaling them to close the gap, as
     the nine-slice's `round` did. */
  .ff-menu-ledge__slab {
    flex: 1;
    background-size: calc(310px * var(--ff-ledge-scale)) 100%;
    background-repeat: round no-repeat;
    image-rendering: pixelated;
  }

  /* The building under the ledge: the 140 x 144 facade tile, at the ledge's
     scale, repeated. It starts a row above the ledge's foot so no sky shows
     between them, is set in from the ledge's ends by the cornice's overhang,
     and runs down as far as `reachFloor` measures (the letterbox bar, or the
     screen's foot where there is none). The tile repeats from the building's
     right-hand corner, which the tile's crop keeps in plain wall; the left
     runs off the screen with the ledge. A dark return down that corner, as
     the near skyline shades its own edges. */
  .ff-menu-facade {
    position: absolute;
    top: calc(100% - 2px * var(--ff-ledge-scale));
    left: calc(-1 * (var(--ff-menu-gutter) + var(--ff-intro-inset)) - 2px);
    right: calc(-110px * var(--ff-ledge-scale) + 8px * var(--ff-ledge-scale));
    height: var(--ff-facade-height, 0px);
    background-repeat: repeat;
    background-position: right top;
    background-size: calc(140px * var(--ff-ledge-scale)) calc(144px * var(--ff-ledge-scale));
    border-right: calc(4px * var(--ff-ledge-scale)) solid #2e222f;
    image-rendering: pixelated;
    pointer-events: none;
    /* The window overlay is whole texels, so it can overhang by one. */
    overflow: hidden;
  }

  /* Until the art has arrived the building's dark edges would stand alone. */
  .ff-hero .ff-menu-facade[data-art="loading"][data-testid] {
    border-left-color: transparent;
    border-right-color: transparent;
  }

  /* The windows' overlay, texel for texel over the tile and pinned to the
     corner the tile repeats from. Sized by `facade-windows`. */
  .ff-menu-facade :global(.ff-menu-facade__windows) {
    position: absolute;
    top: 0;
    right: 0;
    image-rendering: pixelated;
  }

  .ff-menu-racer-frame {
    /* One cell of the racer sheet, drawn at 2x; the sheet is 4 x 7 cells.
       `--ff-racer-cell` is the form factor's token, inherited from the root. */
    display: block;
    width: var(--ff-racer-cell);
    height: var(--ff-racer-cell);
    overflow: hidden;
  }

  .ff-menu-racer-frame :global(.ff-menu-racer) {
    display: block;
    width: calc(var(--ff-racer-cell) * 4);
    height: calc(var(--ff-racer-cell) * 7);
    max-width: none;
    image-rendering: pixelated;
  }

  /* A hover hop: the frame rises and falls, and the sheet behind it steps
     through the poses the race uses for the same arc -- jump on the way up,
     fall on the way down, the landing crouch for a beat, then idle. The frame
     moves rather than the image, so its clip travels with the racer. */
  .ff-menu-racer-frame--hop {
    animation: ff-racer-hop 560ms linear;
  }

  .ff-menu-racer-frame--hop :global(.ff-menu-racer) {
    animation: ff-racer-hop-pose 560ms step-end;
  }

  @keyframes ff-racer-hop {
    0% {
      transform: translateY(0);
      animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
    }
    42% {
      transform: translateY(calc(var(--ff-racer-cell) * -0.45));
      animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.3);
    }
    84%,
    100% {
      transform: translateY(0);
    }
  }

  @keyframes ff-racer-hop-pose {
    0% {
      transform: translateY(calc(var(--ff-racer-cell) * -2));
    }
    42% {
      transform: translateY(calc(var(--ff-racer-cell) * -3));
    }
    84% {
      transform: translateY(calc(var(--ff-racer-cell) * -4));
    }
    100% {
      transform: translateY(0);
    }
  }

  /* The drop in from the splash: violet first, then each racer a beat after
     the one to its right, scarlet last. Each appears a little above the ledge and falls onto it in the fall
     pose, crouches on landing, then stands. It waits out the hero's own
     rise first; `both` holds it hidden above the ledge until its turn. */
  .ff-menu-racer-frame--drop {
    animation: ff-racer-drop 520ms linear both;
    animation-delay: calc(300ms + var(--ff-racer-drop-order, 0) * 120ms);
  }

  .ff-menu-racer-frame--drop :global(.ff-menu-racer) {
    animation: ff-racer-drop-pose 520ms step-end both;
    animation-delay: calc(300ms + var(--ff-racer-drop-order, 0) * 120ms);
  }

  @keyframes ff-racer-drop {
    0% {
      opacity: 0;
      transform: translateY(calc(var(--ff-racer-cell) * -0.75));
      animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.4);
    }
    12% {
      opacity: 1;
    }
    60%,
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes ff-racer-drop-pose {
    0% {
      transform: translateY(calc(var(--ff-racer-cell) * -3));
    }
    60% {
      transform: translateY(calc(var(--ff-racer-cell) * -4));
    }
    100% {
      transform: translateY(0);
    }
  }

  /* A centred hero centres the racers, and the ledge becomes a plinth under
     them rather than a rooftop running off the left edge, which a centred
     ensemble cannot reach. The plinth reaches as far past the first racer as
     the planters do past the last, so it and the building stand centred under
     the wordmark: the pipe end alone stopped short and set them right. */
  .ff-hero[data-centred] :global(.ff-ensemble-frame) {
    justify-self: center;
  }

  .ff-hero[data-centred] .ff-menu-ledge {
    left: calc(-110px * var(--ff-ledge-scale) - 4px);
  }

  /* Under a plinth the building is a tower, set in from both ends, with a
     return down each corner. */
  .ff-hero[data-centred] .ff-menu-facade {
    left: calc(-110px * var(--ff-ledge-scale) + 8px * var(--ff-ledge-scale));
    border-left: calc(4px * var(--ff-ledge-scale)) solid #2e222f;
  }
</style>
