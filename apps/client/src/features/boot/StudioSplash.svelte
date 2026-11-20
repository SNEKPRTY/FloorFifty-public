<script lang="ts">
  /**
   * The studio's own screen, first thing at launch: the SNEKPRTY logo on white,
   * fading in, holding and fading out (`features/boot/studio-splash.ts` times it and
   * takes it away). Over the boot loader too, so nothing of the game shows yet.
   * The white stays solid from the first frame to the last; only the logo fades,
   * and not until it has arrived (the gate sets `data-loaded`). Still, with no
   * fade, where the player asked for less movement.
   */
  import { LOGO_SIZE, LOGO_URL } from "../kit/brand";

  let { still, ms }: { still: boolean; ms: number } = $props();
</script>

<div class="ff-studio" data-testid="studio-splash" data-still={String(still)} style:--ff-studio-ms="{ms}ms">
  <img class="ff-studio__logo" src={LOGO_URL} alt="SNEKPRTY" width={LOGO_SIZE.width} height={LOGO_SIZE.height} decoding="async" />
</div>

<style>
  /* Above the boot loader (z-index 55) and every screen. White is the palette's own. */
  .ff-studio {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: var(--ff-aq-white);
  }

  /* In over the first fifth, held, out over the last fifth: with 3 s, 0.6 s each way. */
  @keyframes ff-studio-fade {
    0% {
      opacity: 0;
    }
    20%,
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  /* A comfortable mark in the middle (Owner, 2026-11-19): at most 220 px, and never more than 55%
     of the width or 40% of the height. */
  .ff-studio__logo {
    display: block;
    width: min(220px, 55vw, 40vh);
    height: auto;
    opacity: 0;
  }

  /* `data-loaded` is set from outside (the gate), so the selector is global. */
  :global(.ff-studio[data-loaded="true"]) .ff-studio__logo {
    animation: ff-studio-fade var(--ff-studio-ms) linear both;
  }

  :global(.ff-studio[data-loaded="true"][data-still="true"]) .ff-studio__logo {
    animation: none;
    opacity: 1;
  }
</style>
