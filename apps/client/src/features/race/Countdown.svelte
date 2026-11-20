<script lang="ts">
  /**
   * 3 · 2 · 1 · GO over the stage (race-flow spec §3.4). Each number pops in
   * and GO bursts and clears; the label itself comes from CountdownClock, so
   * GO leaves within 600 ms whatever the animation does. Hidden from assistive
   * tech: the race's live region says "Go" once instead.
   */
  import type { CountLabel } from "./countdown-clock";

  /** The local racer and its nameplate, in the overlay's pixels, with the overlay's height. */
  type Clear = { top: number; bottom: number; height: number; frameTop: number };

  let { label, racer }: { label: CountLabel | undefined; racer?: Clear | undefined } = $props();

  /**
   * The free band the digit sits in: above the racer under the HUD's block, or
   * below it, whichever is taller. Without a racer it takes the whole stage.
   */
  // The HUD's block bottom in window pixels (`--ff-hud-under-y`), taken into the overlay's own.
  const readUnderY = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ff-hud-under-y")) || 0;
  let underY = $state(readUnderY());
  const under = $derived(racer === undefined ? 0 : Math.max(0, underY - racer.frameTop));
  // The HUD publishes `--ff-hud-under` once its coach is measured, which can be after the first digit.
  $effect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      underY = readUnderY();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    underY = readUnderY();
    return () => observer.disconnect();
  });

  const room = $derived.by((): { top: number; height: number } | undefined => {
    if (racer === undefined) return undefined;
    const above = racer.top - 8 - under;
    // The coach can hang under the racer: its bottom is already in `under`.
    const belowTop = Math.max(racer.bottom, under) + 8;
    const below = racer.height - belowTop;
    return above >= below ? { top: under, height: Math.max(0, above) } : { top: belowTop, height: Math.max(0, below) };
  });
</script>

{#if label !== undefined}
  {#key label}
    <p
      class="ff-count"
      class:ff-count--go={label === "GO"}
      data-testid="race-count"
      data-count={label}
      aria-hidden="true"
      style:top={room === undefined ? undefined : `${room.top}px`}
      style:height={room === undefined ? undefined : `${room.height}px`}
      style:--ff-count-room={room === undefined ? undefined : `${room.height}px`}
    >
      {label}
    </p>
  {/key}
{/if}

<style>
  .ff-count {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    pointer-events: none;
    /* The digit never outgrows the band it was given (the face's box is about 1.4 times its size), and stays on the pixel grid. */
    font: 600 round(down, min(clamp(96px, 26vmin, 220px), calc(var(--ff-count-room, 308px) / 1.4)), var(--ff-type-hint)) / 1 var(--ff-font-ui);
    color: var(--ff-text);
    text-shadow: 0 4px 0 var(--ff-panel-border);
    animation: ff-count-pop 240ms steps(8) both;
  }

  /* 600 ms: GO_SHOWS_MS in countdown-clock.ts clears the label as the burst ends. */
  .ff-count--go {
    animation: ff-count-burst 600ms steps(8) both;
  }

  /* A scale on display type, stepped: DOM text, so a fractional edge is the
     browser's to anti-alias, not a pixel sprite's. */
  @keyframes ff-count-pop {
    from { opacity: 0; transform: scale(1.6); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes ff-count-burst {
    0% { opacity: 0; transform: scale(0.8); }
    25% { opacity: 1; transform: scale(1.15); }
    100% { opacity: 0; transform: scale(1.5); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-count,
    .ff-count--go {
      animation: none;
    }
  }
</style>
