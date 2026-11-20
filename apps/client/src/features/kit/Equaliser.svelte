<script lang="ts">
  /**
   * A small pixel equaliser drawn from the music analyser (select spec §6.2):
   * the preview's own spectrum, before the mix, so it moves even while muted.
   * The slide shows what is previewing, not what is audible. Still under
   * reduced motion. Each frame writes the bars' levels straight onto their
   * style, so sixty frames a second never re-render the component.
   */
  import type { MusicSpectrum } from "../audio";

  let { spectrum, still, bars = 12 }: { spectrum: () => MusicSpectrum | undefined; still: boolean; bars?: number } = $props();

  /** The resting shape: reduced motion, and the frames before the analyser answers. */
  const RESTING = [0.35, 0.6, 0.8, 0.5, 0.9, 0.7, 0.45, 0.65, 0.85, 0.55, 0.4, 0.75];
  let row: HTMLElement | undefined = $state();

  $effect(() => {
    if (still || row === undefined) return;
    const lit = row.children;
    let frame = 0;
    const draw = (): void => {
      const reading = spectrum();
      if (reading !== undefined) {
        // Log-spaced bands from 40 Hz to 12 kHz, so the bass does not take every bar.
        for (let index = 0; index < lit.length; index += 1) {
          const from = 40 * 300 ** (index / lit.length);
          const to = 40 * 300 ** ((index + 1) / lit.length);
          let peak = 0;
          for (let bin = Math.floor(from / reading.binHz); bin <= Math.ceil(to / reading.binHz) && bin < reading.bins.length; bin += 1) {
            peak = Math.max(peak, reading.bins[bin]!);
          }
          (lit[index] as HTMLElement).style.setProperty("--ff-eq-level", String(Math.max(0.08, peak / 255)));
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="ff-eq" bind:this={row} data-testid="equaliser" data-static={String(still)} aria-hidden="true">
  {#each Array.from({ length: bars }, (_unused, index) => RESTING[index % RESTING.length]!) as level, index (index)}
    <span class="ff-eq__bar" style:--ff-eq-level={level}></span>
  {/each}
</div>

<style>
  .ff-eq {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 24px;
  }
  .ff-eq__bar {
    width: 5px;
    height: 100%;
    background: linear-gradient(to top, var(--ff-plain) calc(var(--ff-eq-level) * 100%), color-mix(in srgb, var(--ff-plain) 18%, transparent) 0);
    /* Pixel steps, not a smooth fill: the bar reads as lit segments. */
    mask: repeating-linear-gradient(to top, black 0 4px, transparent 4px 6px);
  }
</style>
