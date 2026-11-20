<script lang="ts">
  /**
   * A language's flag in the Settings picker: the country whose player the
   * language is drafted for (English the United States, Latin-American
   * Spanish Mexico). Drawn here, at one 3:2 shape for all six so the grid is
   * even, and simplified to read at 48 px. Decoration: the radio's label
   * carries the endonym for a screen reader.
   */
  import type { FlagCountry } from "../i18n/locales";

  /** corner: the title's button beside Mute; medium: the Settings list; large: the title's modal. */
  let { country, size = "medium" }: { country: FlagCountry; size?: "corner" | "medium" | "large" } = $props();

  /** A five-pointed star's outline, one point turned `turn` degrees from straight up. */
  function star(cx: number, cy: number, r: number, turn = 0): string {
    const points: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? r : r * 0.382;
      const angle = ((turn - 90 + i * 36) * Math.PI) / 180;
      points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(" ");
  }

  /** Turns a small star of China's flag so one point faces the large star. */
  const facing = (x: number, y: number): number => (Math.atan2(5 - y, 5 - x) * 180) / Math.PI + 90;

  const STRIPE = 20 / 13;
  const CANTON_H = STRIPE * 7;
  /** The fifty stars as nine rows of six and five. */
  const US_STARS = Array.from({ length: 9 }, (_, row) =>
    Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, i) => ({ x: row % 2 === 0 ? 1 + i * 2 : 2 + i * 2, y: (CANTON_H / 10) * (row + 1) })),
  ).flat();

  /** Korea's trigrams: solid (true) or broken (false) bars, at each corner, across the diagonal. */
  const TRIGRAMS: { x: number; y: number; turn: number; bars: boolean[] }[] = [
    { x: 7.37, y: 4.91, turn: 33.69, bars: [true, true, true] },
    { x: 22.63, y: 4.91, turn: -33.69, bars: [false, true, false] },
    { x: 7.37, y: 15.09, turn: -33.69, bars: [true, false, true] },
    { x: 22.63, y: 15.09, turn: 33.69, bars: [false, false, false] },
  ];
  const CN_SMALL = [
    [10, 2],
    [12, 4],
    [12, 7],
    [10, 9],
  ] as const;
</script>

<svg class="ff-flag" data-size={size} viewBox="0 0 30 20" data-flag={country} aria-hidden="true" focusable="false">
  {#if country === "us"}
    <rect width="30" height="20" fill="#b33831" />
    {#each [1, 3, 5, 7, 9, 11] as stripe (stripe)}
      <rect y={stripe * STRIPE} width="30" height={STRIPE} fill="#FFFFFF" />
    {/each}
    <rect width="12" height={CANTON_H} fill="#323353" />
    {#each US_STARS as dot (`${dot.x},${dot.y}`)}
      <circle cx={dot.x} cy={dot.y} r="0.36" fill="#FFFFFF" />
    {/each}
  {:else if country === "jp"}
    <rect width="30" height="20" fill="#FFFFFF" />
    <circle cx="15" cy="10" r="6" fill="#ae2334" />
  {:else if country === "kr"}
    <rect width="30" height="20" fill="#FFFFFF" />
    <g transform="rotate(33.69 15 10)">
      <circle cx="15" cy="10" r="5" fill="#4d65b4" />
      <path d="M10 10 A5 5 0 0 1 20 10 A2.5 2.5 0 0 0 15 10 A2.5 2.5 0 0 1 10 10 Z" fill="#e83b3b" />
    </g>
    {#each TRIGRAMS as trigram (`${trigram.x},${trigram.y}`)}
      <g transform={`translate(${trigram.x} ${trigram.y}) rotate(${trigram.turn})`} fill="#2e222f">
        {#each trigram.bars as solid, i (i)}
          {#if solid}
            <rect x={-1.67 + i * 1.25} y="-2.5" width="0.83" height="5" />
          {:else}
            <rect x={-1.67 + i * 1.25} y="-2.5" width="0.83" height="2.25" />
            <rect x={-1.67 + i * 1.25} y="0.25" width="0.83" height="2.25" />
          {/if}
        {/each}
      </g>
    {/each}
  {:else if country === "cn"}
    <rect width="30" height="20" fill="#ea4f36" />
    <polygon points={star(5, 5, 3)} fill="#fbff86" />
    {#each CN_SMALL as [x, y] (`${x},${y}`)}
      <polygon points={star(x, y, 1, facing(x, y))} fill="#fbff86" />
    {/each}
  {:else if country === "mx"}
    <rect width="10" height="20" fill="#239063" />
    <rect x="10" width="10" height="20" fill="#FFFFFF" />
    <rect x="20" width="10" height="20" fill="#ae2334" />
    <!-- The eagle on its cactus, reduced to the emblem's shape and colours. -->
    <path d="M12.3 11.4 A2.8 2.8 0 0 0 17.7 11.4" fill="none" stroke="#239063" stroke-width="0.7" />
    <ellipse cx="15" cy="9.4" rx="1.9" ry="2.2" fill="#966c6c" />
    <circle cx="15.6" cy="7.6" r="0.7" fill="#4c3e24" />
  {:else if country === "br"}
    <rect width="30" height="20" fill="#1ebc73" />
    <polygon points="1.7,10 15,1.7 28.3,10 15,18.3" fill="#f9c22b" />
    <circle cx="15" cy="10" r="5" fill="#323353" />
    <path d="M10.1 9.2 Q15 7.4 19.9 10.6" fill="none" stroke="#FFFFFF" stroke-width="0.9" />
  {/if}
  <!-- An edge, so the white of Japan's and Korea's flags meets the panel. -->
  <rect x="0.25" y="0.25" width="29.5" height="19.5" rx="0.8" fill="none" class="ff-flag__edge" />
</svg>

<style>
  .ff-flag {
    display: block;
    flex: none;
    inline-size: 48px;
    block-size: 32px;
    border-radius: 3px;
  }
  .ff-flag[data-size="corner"] {
    inline-size: 36px;
    block-size: 24px;
    border-radius: 2px;
  }
  /* The modal's: a little larger than the Settings list's, beside the
     language's name, two tiles to a line. */
  .ff-flag[data-size="large"] {
    inline-size: 56px;
    block-size: auto;
    aspect-ratio: 3 / 2;
    border-radius: 4px;
  }
  .ff-flag__edge {
    stroke: color-mix(in srgb, var(--ff-panel-border) 25%, transparent);
    stroke-width: 0.5;
  }
</style>
