<script lang="ts">
  /**
   * The splash (launch polish §3.1.5): the wordmark over the splash art (on
   * the canvas, `SplashArt`), shimmering in the sun's heat
   * (`wordmark-heat`), and a bar that is the menu bundle's
   * real progress. Once the bundle is in, a line asks the player to go on,
   * and the screen waits for them (`SplashScreen`). The bar is the menu
   * bundle's and the menu song's bytes together; if they take more than
   * eight seconds a quiet line says it is slow.
   */
  import * as m from "../../paraglide/messages.js";
  import type { MonotonicProgress, Readiness } from "../profile/progress.svelte";
  import Panel from "../kit/Panel.svelte";
  import ProgressBar from "../kit/ProgressBar.svelte";
  import { wordmarkHeat } from "./wordmark-heat";

  let {
    progress,
    readiness,
    art,
    shown,
    slow,
    still = false,
  }: {
    progress: MonotonicProgress;
    readiness: Readiness;
    art: Readiness;
    shown: Readiness;
    /** Eight seconds in and still loading: a quiet line says so (it is slow, not failing). */
    slow: Readiness;
    /** The stage effects are off: the wordmark does not burn. */
    still?: boolean;
  } = $props();

  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
</script>

<section
  data-testid="splash"
  class:ff-splash--art={art.ready}
  class:ff-splash--shown={shown.ready}
  class="ff-splash ff-screen grid place-content-center justify-items-center gap-20 font-ui">
  <h1 class="ff-wordmark ff-wordmark--light ff-menu-wordmark m-0 text-center" data-testid="splash-wordmark" use:wordmarkHeat={still ? "off" : "burn"}>
    <span>Floor</span>
    <span>Fifty</span>
  </h1>
  <ProgressBar {progress} testId="splash-progress" />
  <!-- A start: the splash waits for it, because the tap is what starts the music. The slot holds the
       live region and its tokens from the first frame; the glass panel rises into it once ready. -->
  <div class="ff-splash__ready m-0" aria-live="polite" data-testid="splash-ready" data-ready={String(readiness.ready)}>
    {#if readiness.ready}<Panel class="ff-splash__start">{coarse ? m.shell_tap_to_start() : m.shell_press_to_start()}</Panel>{/if}
  </div>
  <p class="ff-aq-secondary ff-splash__slow m-0" aria-live="polite" data-testid="splash-slow">
    {#if slow.ready && !readiness.ready}{m.shell_loading_slow()}{/if}
  </p>
</section>

<style>
  /* The sky the menus sit under, as a page colour, until the splash art is
     on the canvas beneath; then only an ink wash, so the
     art shows through and the light wordmark and pearl text keep AA contrast
     over it: an ink wash pooled behind the centred text. It covers the whole
     screen, bars and all. */
  .ff-splash {
    inset: 0;
    z-index: 50;
    background: linear-gradient(180deg, var(--ff-glow), var(--ff-plain));
  }

  .ff-splash--art {
    background: color-mix(in srgb, var(--ff-panel-border) 62%, transparent);
  }

  /* The palette's black over everything, art and text alike, until the splash has every
     piece it draws (`SplashScreen`), then lifted in one short fade. It sits
     over the canvas as well, so the art is not seen arriving either. */
  .ff-splash::after {
    content: "";
    position: absolute;
    inset: 0;
    /* Resurrect 64's black, the same the page boots on. */
    background: var(--ff-panel-border);
    pointer-events: none;
    transition: opacity 320ms ease-out;
  }

  .ff-splash--shown::after {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-splash::after {
      transition: none;
    }
  }

  /* The wordmark as the menus set it -- the form factor's size, stacked --
     so the splash hands over to the title without a jump (`MenuHero`
     scopes its own copy of these). */
  .ff-splash :global(.ff-menu-wordmark) {
    font-size: round(down, var(--ff-type-wordmark), var(--ff-wordmark-step, 1px));
  }

  .ff-splash :global(.ff-menu-wordmark span) {
    display: block;
  }

  /* The start words sit on a solid strip, so they read over any art: white,
     18 px and bold. Empty (still loading) it draws no strip. */
  .ff-splash__ready,
  .ff-splash__slow {
    min-height: 1.4em;
    color: var(--ff-text);
    font: 600 var(--ff-step-title) / 1.3 var(--ff-font-ui);
    text-align: center;
    text-wrap: balance;
    max-width: min(92vw, 640px);
  }

  /* Ready, the line sits on the glass panel, a lighter one than the menus'
     (Owner, 2026-11-19: over the dark city the shared glass read as a solid
     plate). The same one rule, with its own tokens: less fill, less dimming
     and a lighter blur, so the city's lit windows show through, and the white
     words still read at 9:1 over the brightest sky under the splash's wash
     (`contrast.test.ts`). */
  .ff-splash__ready[data-ready="true"] {
    --ff-panel-opacity: 15%;
    --ff-panel-dim: 0.65;
    --ff-panel-blur: 4px;
  }

  /* On the kit panel's own root, so `:global`. */
  .ff-splash__ready :global(.ff-splash__start) {
    padding: 12px 16px;
  }

  .ff-splash__slow {
    text-shadow: 0 1px 2px var(--ff-panel-border);
  }
</style>
