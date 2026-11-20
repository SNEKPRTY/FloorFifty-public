<script lang="ts">
  /**
   * The players in the select panel (select spec §6.8): one row each, never a
   * slot nobody holds. Bust in the player's colour, name, the item they are
   * on, and Locked: words, so colour is never the only signal. The reveal
   * marks the row its highlight is on, and the winner's.
   */
  import * as m from "../../paraglide/messages.js";
  import type { PlayerRow } from "./select-model";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import Panel from "../kit/Panel.svelte";
  let {
    rows,
    highlightSeat = undefined,
    winnerSeat = undefined,
    winnerBadge = undefined,
  }: {
    rows: readonly PlayerRow[];
    highlightSeat?: number | undefined;
    winnerSeat?: number | undefined;
    /** Whose pick won, said inside the winner's row (spec §6.5). */
    winnerBadge?: string | undefined;
  } = $props();
</script>

<div class="ff-rows" role="list" aria-label={m.ready_players()}>
  {#each rows as row (row.seat)}
    <!-- The item, then a seed that is not the default (stage seeds spec §4.3): "Rooftops · #048213". -->
    {@const item = [row.itemLabel, row.seedLabel].filter((part) => part !== undefined).join(" · ")}
    <!-- The row is a glass panel like any other; it is already on screen with its list, so it neither rises nor falls. -->
    <Panel
      arrive="none"
      leave="none"
      role="listitem"
      class="ff-rows__row ff-colour-{row.colour}"
      data-testid="player-row"
      data-seat={row.seat}
      data-locked={String(row.locked)}
      data-highlight={String(row.seat === highlightSeat)}
      data-winner={String(row.seat === winnerSeat)}
      data-row=""
    >
      <!-- The bust's cell is always there, empty while its art is not, so every row lines up. -->
      {#if row.art !== undefined}<AsyncImage src={row.art} class="ff-rows__art ff-portrait" width={36} height={36} ring={false} />{:else}<span class="ff-rows__art" aria-hidden="true"></span>{/if}
      <span class="ff-rows__name" data-truncatable title={row.name}>{row.name}</span>
      <span class="ff-rows__item" data-truncatable title={item}>{item}</span>
      {#if row.seat === winnerSeat && winnerBadge !== undefined}<span class="ff-rows__badge" data-testid="roulette-byline">{winnerBadge}</span>{/if}
      {#if row.locked}<span class="ff-rows__lock">{m.select_locked()}</span>{/if}
    </Panel>
  {/each}
</div>

<style>
  .ff-rows {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    min-height: 0;
  }
  :global(.ff-rows__row) {
    position: relative;
    display: grid;
    /* The name, then the pick at the row's end, then the winner's badge and
       the lock. Room left over goes to the spacer between name and pick; when
       there is too little, the name and the pick share what there is and each
       gives way to "…", so neither is drawn over the other. */
    grid-template-columns: [art] auto [name] minmax(0, max-content) [spacer] 1fr [item] minmax(0, max-content) [badge] auto [lock] auto;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 4px 12px 4px 14px;
    /* No transition: the highlight is a swap, never a fade (polish spec §3). */
  }
  /* The player's colour, as the ready room's seats carry it. */
  :global(.ff-rows__row::before) {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    border-radius: 12px 0 0 12px;
    background: var(--ff-seat-colour);
  }
  :global(.ff-rows__row[data-highlight="true"]) {
    box-shadow: 0 0 0 2px var(--ff-seat-colour), 0 6px 18px rgb(46 34 47 / 0.18);
  }
  /* A bust's frame is `AsyncImage`'s, outside this scope; the empty one is ours. */
  :global(.ff-rows__row .ff-rows__art) { grid-column: art; width: 36px; height: 36px; }
  .ff-rows__name { grid-column: name; font: 600 var(--ff-type-hint) / 1.2 var(--ff-font-ui); color: var(--ff-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ff-rows__item { grid-column: item; text-align: end; font: 400 var(--ff-type-hint) / 1.2 var(--ff-font-ui); color: var(--ff-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ff-rows__lock { grid-column: lock; font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui); letter-spacing: 0.06em; color: var(--ff-text); text-transform: uppercase; }
  /* The winner's row, filled with its player's colour, opaque (spec §6.5; the
     palette lock allows no mix of two swatches), and ringed in ink. */
  :global(.ff-rows__row.ff-aquarian-panel[data-winner="true"]) {
    background: var(--ff-seat-colour);
    box-shadow: 0 0 0 3px var(--ff-text);
  }
  :global(.ff-rows__row[data-winner="true"]) .ff-rows__item {
    color: var(--ff-text);
  }
  .ff-rows__badge {
    grid-column: badge;
    padding: 2px 8px;
    border-radius: 6px;
    font: 600 var(--ff-type-hint) / 1.2 var(--ff-font-ui);
    color: var(--ff-aq-white);
    background: var(--ff-panel-border);
    white-space: nowrap;
  }
  /* Sideways, the 780 x 270 budget: no busts, tighter rows. */
  :global(.ff-select[data-layout="sideways"]) .ff-rows { gap: 4px; }
  :global(.ff-select[data-layout="sideways"] .ff-rows__row .ff-rows__art) { display: none; }
  :global(.ff-select[data-layout="sideways"] .ff-rows__row) { grid-template-columns: [name] minmax(0, max-content) [spacer] 1fr [item] minmax(0, max-content) [badge] auto [lock] auto; min-height: 30px; padding: 2px 10px 2px 12px; }
  :global(.ff-select[data-layout="sideways"]) .ff-rows__name,
  :global(.ff-select[data-layout="sideways"]) .ff-rows__item { font-size: var(--ff-type-hint); }
</style>
