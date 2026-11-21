<script lang="ts">
  /**
   * The standings the server issued, and the two ways out.
   *
   * Nothing here decides an order. `orderedResults` reads `snapshot.standings`
   * and `winnerName` reads `snapshot.winnerId`; when the server's order
   * disagrees with the finish times, the server wins, because the server is the
   * only thing that knows. `game-end.test.ts` asserts exactly that.
   *
   * The room clock runs in every phase, so a finished room keeps broadcasting
   * at 20 Hz for as long as the results are on screen. The two actions must
   * therefore survive a snapshot: nothing below is keyed on snapshot data, so
   * Svelte patches the rows and leaves the buttons alone.
   *
   * A row keeps four children -- place, portrait, name, time -- in that order.
   * The winner is marked by the row's own border and the heading above it
   * rather than by an extra element, so a name is never the only thing saying
   * who won. The portrait is decorative (the name beside it says who it is):
   * the winner's shows its win mood and everyone else's the lose mood (spec
   * §2.8). Its colour comes from the seat, which is the player's place in the
   * room, not from the standings.
   *
   * Built on the layout system (ui layout spec §6.8): a `ScreenFrame` whose
   * arrangement is the one form-factor decision here, the standings in a
   * `ScrollList` that keeps four rows before the actions take any height, and
   * one `ActionBar` that never wraps on a reference size. Mute is the frame's
   * corner control, as on every shell screen.
   */
  import * as m from "../../paraglide/messages.js";
  import type { RoomStore } from "../net/store/room-store.svelte";
  import Rise from "../kit/Rise.svelte";
  import { landDelay, revealRow, rollUp } from "./results-motion";
  import { didNotStart, endedOnClock, resultParts, modeName, orderedResults, resultLine, tiedResults, wasPlaced, winnerName } from "../race/results";
  import type { PlayerSnapshot } from "@floor-fifty/shared/common/protocol";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import { portraitAliasFor } from "../profile/character-art";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import Chip from "../kit/Chip.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import { grantAnnouncement, type UnlockGrant } from "../net/unlock-grant";
  import UnlockBanner from "../select/UnlockBanner.svelte";
  import { untrack } from "svelte";
  import { formFactor } from "../platform/viewport-tracking.svelte";
  import ScreenFrame from "../kit/layout/ScreenFrame.svelte";
  import ScrollList from "../kit/layout/ScrollList.svelte";
  import ActionBar from "../kit/layout/ActionBar.svelte";
  import NamePill from "../kit/layout/NamePill.svelte";
  import type { BarAction } from "../kit/layout/action-bar";

  let {
    store,
    settings,
    artSrc,
    content,
    onRaceAgain,
    onReturnToMenu,
    unlock = { current: undefined },
    onUnlockShown,
    onUnlockDone,
    replay = { available: false },
    refusal = { message: undefined },
    onWatchReplay = () => {},
  }: {
    store: RoomStore;
    settings: SettingsStore;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc: (alias: string) => string | undefined;
    /** A getter, because the artifact can be replaced while the panel is up. */
    content: () => GameContentPayload | undefined;
    onRaceAgain: () => void;
    onReturnToMenu: () => void;
    /** The round's grant (unlockables spec §5.2), set again by a share on these results. */
    unlock?: { readonly current: UnlockGrant | undefined };
    /** A banner went up: GameEnd starts a song's preview. */
    onUnlockShown?: (grant: UnlockGrant) => void;
    /** The banner went: GameEnd hands the music back. */
    onUnlockDone?: () => void;
    /** Whether the race's replay has arrived (race-options spec §7.1). */
    replay?: { readonly available: boolean };
    /** Why a replay would not open, once said. */
    refusal?: { readonly message: (() => string) | undefined };
    onWatchReplay?: () => void;
  } = $props();

  // The banner shows each grant once, and its line is announced once: the
  // effect keys on the grant object, never on the 20 Hz snapshot.
  let shown = $state<UnlockGrant | undefined>(undefined);
  let announcement = $state("");
  $effect(() => {
    const grant = unlock.current;
    if (grant === undefined) return;
    shown = grant;
    announcement = grantAnnouncement(grant);
    untrack(() => onUnlockShown?.(grant));
  });

  const winner = $derived(winnerName(store.snapshot));
  const raced = $derived(modeName(store.snapshot, content()?.modes ?? []));
  const rows = $derived(orderedResults(store.snapshot));
  const tied = $derived(tiedResults(store.snapshot));

  /** The player's colour (select spec §6.7), not their seat's or their place's. */
  const scarfOf = (id: string) => store.snapshot?.players.find((player) => player.id === id)?.colour ?? "scarlet";

  /** Portrait stacks the heading over the panel; everything wider sets them side by side. */
  const arrangement = $derived(
    formFactor.current === "phone-portrait" || formFactor.current === "tablet-portrait" ? "stack" : "split",
  );

  /**
   * Built once: the buttons survive a snapshot (see above), and only
   * `disabled` follows the replay's arrival.
   */
  const actions = $derived<BarAction[]>([
    { id: "race-again", label: m.results_race_again(), kind: "primary", onSelect: onRaceAgain },
    {
      id: "watch-replay",
      label: m.results_watch_replay(),
      kind: "secondary",
      onSelect: onWatchReplay,
      disabled: !replay.available,
    },
    { id: "return-to-menu", label: m.results_return_to_menu(), kind: "secondary", onSelect: onReturnToMenu },
  ]);
</script>

<!-- NEW SONG or NEW CHALLENGER sits in the corner row, between the corners,
     so it never covers the winner, the standings or Mute (visual audit,
     2026-10-05: laid over the screen's top it hid the headline's last line
     on a phone and the winner's row on a short landscape). -->
{#snippet banner()}
  {#if shown !== undefined}
    {#key shown}
      <UnlockBanner
        grant={shown}
        {artSrc}
        onDone={() => {
          shown = undefined;
          onUnlockDone?.();
        }}
      />
    {/key}
  {/if}
{/snippet}
<p data-testid="unlock-announcer" class="sr-only" role="status" aria-live="polite">{announcement}</p>

<!-- A result's parts stay whole, so only the gap between them may wrap. -->
{#snippet line(player: PlayerSnapshot)}
  {#each resultParts(resultLine(player, store.snapshot)) as part, at}{#if at > 0}{" · "}{/if}<span class="ff-result__part" use:rollUp={part}></span>{/each}
{/snippet}

{#snippet tie(id: string)}
  {#if tied.has(id)}<span class="ff-result__tie" data-testid="result-tie">{m.results_tie()}</span>{/if}
{/snippet}

<!-- The ways out, and why Watch replay waits: under the headline when the
     two columns sit side by side, so the standings keep their column's whole
     height (B1); under the standings when stacked. -->
{#snippet ways()}
  <ActionBar {actions} testId="results-actions" />
  <!-- Disabled with its reason said, never hidden, until it arrives
       (race-options spec §7.1); the refusal is said here too. -->
  {#if !replay.available}
    <span data-testid="replay-unavailable" class="ff-aq-label m-0">{m.results_replay_unavailable()}</span>
  {/if}
  {#if refusal.message !== undefined}
    <p data-testid="replay-refused" role="status" class="ff-aq-label m-0">{refusal.message()}</p>
  {/if}
{/snippet}

<ScreenFrame {arrangement} {settings} header={banner} testId="game-end" mute>
  {#snippet hero()}
    <!-- One calm reveal, longer than a menu step: the race is over, and the
         heading is the thing worth reading first. -->
    <Rise long class="ff-results__column" data-joined={formFactor.current === "tablet-portrait" ? "" : undefined}>
      <Chip frame="title" class="ff-results__headline">
        <h1 data-testid="winner" class="ff-results__winner m-0 text-[clamp(1.375rem,6vw,2rem)] text-aq-ink short:text-[1.25rem]">
          {#if winner === undefined}{m.results_race_over()}{:else}{@const [before = "", after = ""] = m.results_winner({ name: "\u0000" }).split("\u0000")}{before}<span class="ff-results__winner-name">{winner}</span>{after}{/if}
        </h1>
        <!-- The mode raced (race-options spec §5.5), as a plain line under the name. -->
        {#if raced !== undefined}<p data-testid="results-mode" class="ff-results__mode">{raced}</p>{/if}
      </Chip>
      {#if arrangement === "split"}<div class="ff-results__ways">{@render ways()}</div>{/if}
    </Rise>
  {/snippet}

  {#snippet body()}
    <Rise long delay={1} class="ff-results__column ff-results__panel-wrap">
      <Chip class="ff-results__panel">
        <ScrollList minRows={arrangement === "stack" ? 3 : 4} rowCount={rows.length} rowGap="var(--ff-seat-gap)" label={m.results_standings()} testId="results-list">
          <!-- One list on every view: the iPad upright's podium is gone. -->
          <ol class="m-0 grid list-none gap-[var(--ff-seat-gap)] p-0">
            {#each rows as player, index (player.id)}
              {@const placed = wasPlaced(store.snapshot, player)}
              {@const isWinner = player.id === store.snapshot?.winnerId}
              <!-- Revealed from last place to first, one tick each, so the
                   winner arrives last (polish spec §6). -->
              <li
                data-testid="result-row"
                data-row
                data-status={player.status}
                data-best={endedOnClock(store.snapshot) ? "" : undefined}
                data-winner={String(isWinner)}
                use:revealRow={{ order: rows.length - 1 - index, winner: isWinner }}
                style:--ff-land-delay={isWinner ? landDelay(rows.length) : undefined}
                data-self={player.id === store.localPlayerId ? "true" : undefined}
                class="ff-result {isWinner ? 'ff-result--winner' : ''}"
              >
                <span class="ff-result__place">{placed ? `${index + 1}` : "—"}</span>
                <AsyncImage
                  testId="result-portrait"
                  class="ff-portrait size-row-portrait"
                  width={40}
                  height={40}
                  ring={false}
                  src={artSrc(portraitAliasFor(content(), player.characterId, scarfOf(player.id), isWinner ? "win" : "lose"))}
                />
                <NamePill name={player.name} colour={scarfOf(player.id)} testId="result-name" />
                <!-- A tie keeps the server's order; the tag says that order was its
                     tie-break, not a gap on the clock. -->
                {#if endedOnClock(store.snapshot) && !didNotStart(player)}
                  <span class="ff-result__time ff-result__time--best" data-testid="result-best">{@render line(player)}{@render tie(player.id)}</span>
                {:else}
                  <span class="ff-result__time">{@render line(player)}{@render tie(player.id)}</span>
                {/if}
              </li>
            {/each}
          </ol>
        </ScrollList>

        {#if arrangement === "stack"}{@render ways()}{/if}
      </Chip>
    </Rise>
  {/snippet}
</ScreenFrame>

<style>
  /* A short landscape screen has no height to spare: the winner line and the buttons come first. */
  :global([data-height]) .ff-results__mode {
    display: none;
  }
  .ff-results__mode {
    margin: 0;
    font: 600 var(--ff-type-hint) / 1.2 var(--ff-font-ui);
    color: var(--ff-text-2);
  }
  /* An upright iPad draws these rows big; their words take the button step (24 on the glass,
     divided by the shell's zoom as every step is) so a row is not a large box around 12 px. */
  :global([data-form-factor="tablet-portrait"]) .ff-result {
    --ff-type-hint: calc(var(--ff-step-button) / var(--ff-ui-zoom, 1));
  }
  /* Place, portrait, name and result on one line where they fit; on a narrow
     panel the result goes under the name, never a third line. */
  .ff-result {
    display: grid;
    grid-template-columns: 2ch var(--ff-row-portrait) minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 2px;
    min-height: var(--ff-row-h);
    padding: var(--ff-row-pad-y) 8px;
  }
  .ff-result :global(.ff-result__time) {
    text-align: end;
  }
  .ff-result__part {
    display: inline-block;
    white-space: nowrap;
  }
  @container results (max-width: 340px) {
    /* A narrow panel draws a tighter row (40 px portrait, 4 px padding) and
       the list reserves that row's height, so four racers, the winner line and
       the three buttons all fit a 568 px screen. */
    :global([data-testid="results-list"]) {
      --ff-row-portrait: 40px;
      --ff-row-pad-y: 4px;
      --ff-row-h: calc(40px + 2 * 4px + 2px);
    }
    .ff-result :global(.ff-portrait) {
      width: 40px;
      height: 40px;
    }
    .ff-result {
      grid-template-columns: 2ch var(--ff-row-portrait) minmax(0, 1fr);
      column-gap: 6px;
      padding-inline: 4px;
    }
    /* The place and the portrait stand beside both lines, so a row is two
       lines tall, not the portrait's height plus a line. */
    .ff-result :global(.ff-portrait),
    .ff-result__place {
      grid-row: 1 / span 2;
      align-self: center;
    }
    .ff-result :global(.ff-result__time) {
      grid-column: 3;
      text-align: start;
      font-size: var(--ff-type-hint);
    }
  }
  @container results (max-width: 480px) {
    .ff-result[data-best] {
      grid-template-columns: 2ch var(--ff-row-portrait) minmax(0, 1fr);
    }
    /* As the narrow panel's row: the place and the portrait stand beside both lines and the
       result is a size smaller, so a row stays the height the list reserves for it and the
       fourth racer is not cut by the screen's foot (review R19, phones held sideways). */
    .ff-result[data-best] :global(.ff-portrait),
    .ff-result[data-best] .ff-result__place {
      grid-row: 1 / span 2;
      align-self: center;
    }
    .ff-result[data-best] :global(.ff-result__time) {
      grid-column: 3;
      text-align: start;
      font-size: var(--ff-type-hint);
    }
  }

  /* The winner's portrait lands with one squash step (polish spec §6), once
     its row has risen in: the reveal runs last place first, so it waits for
     every other standing. A step, never a curve, anchored at its foot.
     Global: the portrait is drawn by AsyncImage. */
  .ff-result--winner :global(.ff-portrait) {
    animation: ff-win-land 120ms steps(1) var(--ff-land-delay, 0ms) both;
    transform-origin: 50% 100%;
  }

  @keyframes ff-win-land {
    from {
      transform: scaleY(0.9);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-result--winner :global(.ff-portrait) {
      animation: none;
    }
  }

  /* Side by side, the headline's column and the standings' are one width
     (ui layout spec §6.8, M9), rather than the menu sheet's width. */
  :global(.ff-screen-frame[data-testid="game-end"]) {
    --ff-split-body: 1fr;
  }

  /* Stacked, the winner line takes the height it needs and the standings take
     the rest, scrolling when they must; the default gives the body its content
     and squeezes the heading out from behind the list. */
  :global(.ff-screen-frame[data-testid="game-end"][data-arrangement="stack"]) {
    --ff-stack-rows: auto minmax(0, 1fr);
  }

  .ff-results__ways {
    display: grid;
    gap: 8px;
    margin-top: var(--ff-gutter);
  }

  /* One column width for the headline and the panel, side by side or
     stacked, so their edges line up (ui layout spec §6.8, M9). */
  :global(.ff-results__column) {
    width: 100%;
    max-width: var(--ff-panel-max);
    min-width: min(100%, var(--ff-panel-min));
    justify-self: center;
  }

  /* Stacked, the headline sits on the standings rather than mid-sky with a
     band of empty sky under it (visual audit, 2026-10-05). */
  :global(.ff-screen-frame[data-arrangement="stack"] .ff-results__column:not(.ff-results__panel-wrap)) {
    align-self: end;
  }

  /* An upright iPad (the root marks it): the headline and the standings are one block, centred in
     the screen, not a headline up in the sky and the standings low with a band of sky between. */
  :global(.ff-screen-frame[data-arrangement="stack"] .ff-screen-frame__content:has(> .ff-screen-frame__hero > [data-joined])) {
    grid-template-rows: auto auto;
    align-content: center;
  }

  /* A translated line, so the UI face the h1 rule gives it, not the brand's
     serif; CJK glyphs fill the em, so the line is opened up for them. */
  /* The winner's name stays on one line, hyphen and all. */
  .ff-results__winner-name {
    white-space: nowrap;
  }

  .ff-results__winner {
    line-height: 1.1;
    text-wrap: balance;
  }

  :global(.ff-results__column .ff-results__headline) {
    display: grid;
    gap: 4px;
    padding: 12px 16px;
  }

  /* The panel fills its column's height, so a short screen shrinks the
     standings' scroll region, never the actions (B1). */
  :global(.ff-results__panel-wrap) {
    display: grid;
    min-height: 0;
    align-self: stretch;
    align-content: center;
  }

  :global(.ff-results__panel-wrap .ff-results__panel) {
    display: grid;
    container: results / inline-size;
    /* `1fr`, not `minmax(0, 1fr)`: the standings' track must honour the
       four rows ScrollList reserves (its minimum height), so the actions
       give way before a place does (B1). */
    grid-template-rows: 1fr auto auto auto;
    gap: min(var(--ff-gutter), 8px);
    min-height: 0;
    /* At most 12 px at the sides, so the three actions keep one row at 360 px. */
    padding: min(var(--ff-gutter), 8px) min(var(--ff-gutter), 12px);
  }

  /* A tall body (a tablet held upright): the standings and the actions as
     one block under the headline, not the actions at the panel's foot with
     its middle empty (visual audit, 2026-10-05). */
  @container ff-screen (min-height: 860px) {
    :global(.ff-results__panel-wrap .ff-results__panel) {
      grid-template-rows: auto auto auto auto;
      align-self: start;
    }
  }
</style>
