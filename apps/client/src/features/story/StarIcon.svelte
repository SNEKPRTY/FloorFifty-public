<script lang="ts">
  /**
   * A story star in pixels, beside the glim (`GlimIcon`): gold when earned,
   * a pale shape when not yet. The hub's cards and the results draw it.
   */
  let { earned, class: className = "" }: { earned: boolean; class?: string } = $props();

  /** The star, row by row: `#` is a pixel. Its top half is the light. */
  const ROWS = ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", "..#####..", ".##...##.", "##.....##"];
  const PIXELS = ROWS.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [{ x, y }] : [])));
</script>

<svg class={className} viewBox="0 0 9 9" aria-hidden="true" shape-rendering="crispEdges" data-earned={earned}>
  {#each PIXELS as pixel (`${pixel.x}:${pixel.y}`)}
    <rect x={pixel.x} y={pixel.y} width="1" height="1" fill={earned ? (pixel.y < 4 ? "#fbff86" : "#f9c22b") : "#c7dcd0"} fill-opacity={earned ? 1 : 0.3} />
  {/each}
</svg>
