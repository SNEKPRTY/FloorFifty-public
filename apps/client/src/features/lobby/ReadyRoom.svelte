<script lang="ts">
  /**
   * The ready room.
   *
   * Every control here outlives the snapshot stream. Authority broadcasts at
   * 20 Hz for as long as a player sits in this panel, and a control replaced
   * between `pointerdown` and `pointerup` never produces a click -- the press
   * is silently lost. Svelte patches attributes and text in place, so this is
   * the default behaviour, but only while nothing keys on snapshot data.
   *
   * Seats are keyed by seat index, which is stable. Keying them by player id
   * would rebuild a seat whenever the server reordered the room, which is
   * exactly the bug above wearing a different hat.
   *
   * A seat identifies its occupant three ways, and they are deliberately not
   * the same question: the seat number is a place in the room, `YOU` compares
   * the occupant against `localPlayerId`, and `HOST` compares it against the
   * snapshot's `hostId`. Deriving either marker from "seat one" would be right
   * only while the host happened to sit first.
   */
  import { characterName } from "../i18n/content";
  import * as m from "../../paraglide/messages.js";
  import type { LapCount } from "@floor-fifty/shared/common/ids";
  import type { NetworkPort } from "../net/network";
  import { pulseWhenFound, seatMotion, stampIn } from "./seat-motion";
  import type { RoomStore } from "../net/store/room-store.svelte";
  import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
  import { characterById, portraitAliasFor } from "../profile/character-art";
  import { tileAccess, type AccessOptions, NO_ACCESS } from "../profile/access";
  import { announcementFor, clockLine, quickMatchClock, readyLabel } from "./quick-match-model";
  import { clockChoicesFor, floorsChoices, formatClockChoice, lapChoicesFor } from "../race/race-options";
  import AsyncImage from "../kit/AsyncImage.svelte";
  import Chip from "../kit/Chip.svelte";
  import Rise from "../kit/Rise.svelte";
  import ActionBar from "../kit/layout/ActionBar.svelte";
  import BadgeRow from "../kit/layout/BadgeRow.svelte";
  import NamePill from "../kit/layout/NamePill.svelte";
  import OptionGroup from "../kit/layout/OptionGroup.svelte";
  import InfoSheet from "../kit/layout/InfoSheet.svelte";
  import ScrollList from "../kit/layout/ScrollList.svelte";
  import type { BarAction } from "../kit/layout/action-bar";
  import type { Arrangement } from "../kit/screen-arrangement";
  import type { SettingsStore } from "../profile/store/settings.svelte";

  let {
    store,
    network,
    attempt,
    setStatus,
    settings,
    artSrc,
    content,
    access = NO_ACCESS,
    seatedOnEntry = undefined,
    onChangeCharacter = () => {},
    arrangement,
  }: {
    store: RoomStore;
    network: NetworkPort;
    attempt: (action: () => Promise<void>) => void;
    setStatus: (message: () => string, tone?: "info" | "error") => void;
    settings: SettingsStore;
    /** A DOM image URL for an art alias, once the manifest is known. */
    artSrc: (alias: string) => string | undefined;
    /** A getter, because the artifact can be replaced while the panel is up. */
    content: () => GameContentPayload | undefined;
    /** What this device may pick: the dev flag, what it earned and what it owns. */
    access?: AccessOptions;
    /** The seat the device already held when the lobby was entered, if any. */
    seatedOnEntry?: string | undefined;
    /** Opens the Character page (select spec §6.1). */
    onChangeCharacter?: () => void;
    /** Stacked when held upright, the seats beside the settings otherwise (`roomArrangement`). */
    arrangement: Arrangement;
  } = $props();

  // The remembered body, once per seat taken here: never for a seat the
  // device held on entry (a resume, or Race again, keeps the body it has --
  // including one ? drew), and only when it is not already worn, the device
  // may pick it, and the seat is not ready. Here rather than on the Character
  // page, so a player who never opens it still wears it.
  // svelte-ignore state_referenced_locally
  let sentFor: string | undefined = seatedOnEntry;
  $effect(() => {
    const loaded = content();
    const mine = store.seats.find((seat) => seat.player !== undefined && seat.player.id === store.localPlayerId)?.player;
    if (loaded === undefined || mine === undefined || sentFor === mine.id) return;
    sentFor = mine.id;
    const remembered = settings.value.profile.lastCharacter;
    if (mine.ready || mine.characterId === remembered) return;
    if (characterById(loaded, remembered) === undefined) return;
    if (tileAccess(loaded, "character", remembered, access).state !== "open") return;
    attempt(() => network.pickCharacter(remembered));
  });

  /** A seat's character as its name reads in the player's language, or Random. */
  function wornName(characterId: string): string {
    const character = characterById(content(), characterId);
    return character === undefined ? m.ready_random() : characterName(character);
  }


  // The race options (race-options spec §3.4): the catalog's modes, and the
  // lap counts the room's mode offers. Laps show only where there is a choice.
  const modes = $derived(content()?.modes ?? []);
  const laps: readonly LapCount[] = $derived(lapChoicesFor(modes, store.snapshot?.modeId));
  const clocks: readonly number[] = $derived(clockChoicesFor(modes, store.snapshot?.modeId));
  // A private room's host may fill or free a seat with a CPU (CPU players spec §5.1).
  /** The chosen mode, in the player's language: said aloud when the host changes it. */
  const modeName = $derived(floorsChoices(modes).find((choice) => choice.id === store.snapshot?.modeId)?.name ?? "");
  const seatsCpus = $derived(store.isHost && store.snapshot?.access === "private" && store.snapshot.phase === "lobby");

  /**
   * Seat accent, as literal class names.
   *
   * Written out rather than composed, because Tailwind reads source text: a
   * class built from a variable at runtime is never emitted into the
   * stylesheet, and the seat would simply have no colour. It is a bar beside
   * the seat rather than the whole seat, so identity never depends on colour
   * alone -- the number, the portrait and the name all say who is there.
   */
  const SCARF_ACCENT = {
    scarlet: "bg-scarlet",
    cyan: "bg-cyan",
    gold: "bg-gold",
    violet: "bg-violet",
  } as const;

  function toggleReady(): void {
    // Read at press time rather than captured: this button outlives every
    // snapshot, so a value closed over would go stale within fifty milliseconds.
    attempt(() => network.setReady(!store.localIsReady));
  }

  function leave(): void {
    attempt(() => network.leaveRoom());
  }

  // A public lobby's start or search clock, undefined in a private room.
  const clock = $derived(quickMatchClock(store.snapshot));

  const actions = $derived<BarAction[]>([
    {
      id: "ready-toggle",
      label: readyLabel(clock, store.localIsReady),
      kind: "primary",
      sfx: "ready",
      // The stamp (polish spec §6): steps in at 1.1 and settles as the seat readies.
      ...(store.localIsReady ? { icon: readyStamp } : {}),
      onSelect: toggleReady,
    },
    { id: "leave-room", label: m.ready_leave_room(), kind: "secondary", tone: "stop", sfx: "back", onSelect: leave },
  ]);

  // Read once when a clock begins or changes kind, never each second.
  let announcement = $state("");
  let announcedKind: string | undefined;
  $effect(() => {
    const kind = clock?.kind;
    if (kind === announcedKind) return;
    announcedKind = kind;
    announcement = announcementFor(kind, clock !== undefined && "seconds" in clock ? clock.seconds : undefined);
  });

  // A CPU arriving or leaving is said once, in the same region (CPU players
  // spec §5.1): the cell changes in place, so nothing else tells a screen reader.
  let cpusHeard: Map<string, string> | undefined;
  $effect(() => {
    const now = new Map(store.seats.flatMap((seat) => (seat.player?.cpu === true ? [[seat.player.id, seat.player.name] as const] : [])));
    const before = cpusHeard;
    cpusHeard = now;
    if (before === undefined) return;
    for (const [id, name] of now) if (!before.has(id)) announcement = m.ready_announce_cpu_added({ name });
    for (const [id, name] of before) if (!now.has(id)) announcement = m.ready_announce_cpu_removed({ name });
  });
</script>

{#snippet readyStamp()}<span data-testid="ready-stamp" class="ff-ready__stamp" use:stampIn></span>{/snippet}

<div data-testid="ready-room" class="ff-ready grid h-full w-full min-h-0" data-arrangement={arrangement}>
  {#snippet seats()}
    <ScrollList minRows={4} rowCount={store.seats.length} rowGap="var(--ff-seat-gap)" label={m.ready_seats()} testId="seat-list">
      <!-- The seats' container is their wrapper: a list cannot query its own
           width, so on the list itself the two-across seats never applied. -->
      <div class="ff-ready__seats-box @container/seats">
      <ol data-testid="seats" class="m-0 grid list-none content-start gap-[var(--ff-seat-gap)] p-0 @min-[34rem]/seats:grid-cols-2 @min-[34rem]/seats:gap-12">
        {#each store.seats as seat (seat.index)}
          {@const player = seat.player}
          {@const isYou = player !== undefined && player.id === store.localPlayerId}
          {@const isHost = player !== undefined && player.id === store.snapshot?.hostId}
          {@const isCpu = player?.cpu === true}
          <li
            data-testid="seat"
            data-row
            data-ready={player === undefined ? undefined : String(player.ready)}
            data-scarf={player === undefined ? undefined : seat.scarf}
            data-character={player?.characterId}
            data-you={player === undefined ? undefined : String(isYou)}
            data-host={player === undefined ? undefined : String(isHost)}
            data-cpu={player === undefined ? undefined : String(isCpu)}
            use:seatMotion={{ occupant: player?.id, ready: player?.ready ?? false, host: isHost }}
            class="ff-seat relative grid min-h-[var(--ff-row-h)] grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-[var(--ff-seat-col-gap,12px)] gap-y-[var(--ff-seat-col-gap,12px)] px-[var(--ff-seat-px,12px)] py-row-pad"
          >
            <span data-testid="seat-number" class="ff-seat__number {player === undefined ? 'text-aq-muted' : 'text-aq-ink'}">{seat.index + 1}</span>
            {#if player === undefined}
              <span class="ff-seat__badge ff-seat__badge--open size-row-portrait"></span>
            {:else}
              <AsyncImage
                src={artSrc(portraitAliasFor(content(), player.characterId, seat.scarf, "neutral"))}
                width={40}
                height={40}
                class="ff-seat__badge ff-portrait size-row-portrait"
                ring={false}
              />
            {/if}
            <!-- Each line hugs its contents, so your ink-edged name is as wide as the name. -->
            <span class="ff-seat__who grid min-w-0 justify-items-start gap-6">
              <NamePill name={player?.name ?? m.ready_seat_open()} colour={player === undefined ? undefined : seat.scarf} self={isYou} whole testId="seat-name" />
              {#if player !== undefined && (isYou || isHost)}
                <BadgeRow
                  badges={[
                    ...(isYou ? [{ text: m.ready_seat_you(), kind: "status" as const, testId: "seat-you" }] : []),
                    ...(isHost ? [{ text: m.ready_seat_host(), kind: "status" as const, testId: "seat-host" }] : []),
                    ...(isYou && !player.ready ? [{ text: m.ready_seat_change(), kind: "action" as const, testId: "seat-change-tag" }] : []),
                  ]}
                />
              {/if}
            </span>
            <span
              data-testid="seat-status"
              class="ff-seat__status {player === undefined || (!isCpu && !player.ready) ? 'text-aq-muted' : 'text-aq-ink'}"
              >{player === undefined ? (seatsCpus ? m.ready_seat_add_cpu() : "") : isCpu ? m.ready_seat_cpu() : player.ready ? m.ready_ready() : m.ready_waiting()}</span
            >
            <span class="ff-seat__bar {player === undefined ? 'bg-aq-edge' : SCARF_ACCENT[seat.scarf]}" aria-hidden="true"></span>
            {#if seatsCpus && (player === undefined || isCpu)}
              <!-- Covers the cell as your own seat's button does, without its touch
                   floor: a CPU must not make any cell taller (CPU players spec §5.1). -->
              <button
                type="button"
                data-testid={player === undefined ? "seat-add-cpu" : "seat-remove-cpu"}
                data-sfx="confirm"
                data-motion="none"
                class="ff-seat__cpu"
                aria-label={player === undefined ? m.ready_seat_add_cpu_label() : m.ready_seat_remove_cpu_label({ name: player.name })}
                onclick={() => attempt(() => (player === undefined ? network.addCpu() : network.removeCpu(player.id)))}
              ></button>
            {/if}
            {#if isYou}
              <button
                type="button"
                data-testid="seat-change"
                data-sfx="confirm"
                data-motion="none"
                class="ff-seat__change"
                aria-label={m.ready_change_character({ name: wornName(player.characterId) })}
                disabled={player.ready}
                onclick={onChangeCharacter}
              ></button>
            {/if}
          </li>
        {/each}
      </ol>
      </div>
    </ScrollList>
  {/snippet}

  {#snippet settingsAndActions()}
    <div class="ff-ready__settings grid min-h-0 content-start gap-[var(--ff-panel-gap)]">
      <div data-testid="race-options" class="ff-race-options flex flex-wrap items-center gap-x-16 gap-y-8">
        {#if modes.length > 0}
          <OptionGroup
            label={m.ready_floors()}
            testId="mode-chooser"
            options={floorsChoices(modes).map((choice) => ({ value: choice.id, label: choice.label, testId: `mode-${choice.id}`, ariaLabel: choice.name, ...(choice.icon === undefined ? {} : { icon: choice.icon }), ...(choice.badge === undefined ? {} : { badge: choice.badge }) }))}
            value={store.snapshot?.modeId}
            onChange={(id) => attempt(() => network.setMode(id))}
            disabled={!store.isHost}
          />
        {/if}

        {#if laps.length > 1}
          <OptionGroup
            label={m.ready_laps()}
            testId="lap-chooser"
            options={laps.map((count) => ({ value: String(count), label: String(count), testId: `lap-${count}` }))}
            value={store.snapshot?.lapCount === undefined ? undefined : String(store.snapshot.lapCount)}
            onChange={(count) => attempt(() => network.setLapCount(Number(count) as LapCount))}
            disabled={!store.isHost}
          />
        {/if}
        {#if clocks.length > 0}
          <!-- Survival's clock (survival spec §5), shown only for a mode that offers one. -->
          <OptionGroup
            label={m.ready_clock()}
            testId="clock-chooser"
            options={clocks.map((seconds) => ({ value: String(seconds), label: formatClockChoice(seconds), testId: `clock-${seconds}` }))}
            value={store.snapshot?.clockSeconds === undefined ? undefined : String(store.snapshot.clockSeconds)}
            onChange={(seconds) => attempt(() => network.setClock(Number(seconds)))}
            disabled={!store.isHost}
          />
        {/if}
      </div>
      <!-- The rules are behind a button; the mode change is still heard, since
           text inside a closed sheet is not. -->
      <span data-testid="mode-live" class="sr-only" aria-live="polite">{modeName}</span>
      <div class="ff-ready__foot">
        <!-- A race found (the start clock begins) pulses the line once. -->
        <p data-testid="race-options-status" class="ff-ready__status m-0" use:pulseWhenFound={clock?.kind === "starting"}>
          {#if clock !== undefined}
            <span data-testid="quick-match-clock">{clockLine(clock)}</span>
          {:else if store.isHost}
            {m.ready_everyone_ready()}
          {:else}
            {m.ready_waiting_room()}
          {/if}
        </p>
        <div class="ff-ready__rules">
          <InfoSheet title={m.ready_rules_button()} testId="ready-rules">
            <p data-testid="mode-tagline" class="ff-aq-body ff-ready__rule m-0">
              {store.snapshot?.modeId === "infinite" ? m.ready_mode_survival_tagline() : m.ready_mode_finite_tagline()}
            </p>
            <p data-testid="wall-tech-help" class="ff-aq-body ff-ready__rule m-0">{m.ready_wall_help()}</p>
          </InfoSheet>
        </div>
      </div>
      <p class="sr-only" aria-live="polite">{announcement}</p>
      <!-- Directly under the settings: no dead gap between the line and the
           buttons on a sideways phone (UI layout spec §6.3, m8). -->
      <ActionBar {actions} testId="ready-actions" />
    </div>
  {/snippet}

  <Rise delay={1} class="grid min-h-0">
    <Chip class="ff-ready__chip grid min-h-0 gap-[var(--ff-panel-gap)] p-[var(--ff-panel-pad)]">
      {#if arrangement === "split"}
        <div class="ff-ready__cols">
          {@render seats()}
          {@render settingsAndActions()}
        </div>
      {:else}
        <!-- `1fr`, not `minmax(0, 1fr)`: the seats' track honours the four rows
             ScrollList reserves, so the settings give way first (M12). -->
        <div class="ff-ready__stack grid min-h-0 grid-rows-[1fr_auto] gap-[var(--ff-panel-gap)]">
          {@render seats()}
          {@render settingsAndActions()}
        </div>
      {/if}
    </Chip>
  </Rise>
</div>

<style>
  /* Floors take a row of their own; the other choice and Rules share the next. */
  .ff-race-options > :global(.ff-options:first-child) {
    flex-basis: 100%;
  }
  /* The wait line and Rules share one row. */
  .ff-ready__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }
  .ff-ready__foot > .ff-ready__status {
    flex: 1 1 8rem;
    min-width: 0;
  }
  .ff-ready__rules {
    margin-inline-start: auto;
  }
  /* Each rule in the popup is its own short line with an accent bar, so two
     sentences read as two things, not a wall. */
  .ff-ready__rule {
    padding-inline-start: 12px;
    border-inline-start: 3px solid var(--ff-plain);
  }

  /* The wait line is something to read, so it takes the text colour, not the
     rules' grey. */
  .ff-ready__status {
    font-family: var(--ff-font-ui);
    font-size: var(--ff-type-hint);
    color: var(--ff-text);
  }

  /* The ready stamp: a tick beside the label, drawn here so it adds no text.
     It marks readiness in a shape as well as the word (never colour alone). */
  .ff-ready__stamp::before {
    content: "✓";
  }

  /* Your seat's button covers its row. The row stays the thing drawn; the
     button only takes the press and draws the focus ring. */
  .ff-seat__change,
  .ff-seat__cpu {
    position: absolute;
    inset: -1px;
    z-index: 1;
    padding: 0;
    background: none;
    border: 0;
    border-radius: inherit;
    cursor: pointer;
  }
  .ff-seat__change:disabled {
    cursor: default;
  }
  .ff-seat__change:hover:not(:disabled),
  .ff-seat__cpu:hover {
    background: color-mix(in srgb, var(--ff-plain) 8%, transparent);
  }
  .ff-seat__change:focus-visible {
    --ff-focus-offset: -2px;
    outline: 2px solid var(--ff-text);
    outline-offset: -2px;
  }
  /* The CPU seat's button rings inset, as your own seat's does. */
  .ff-seat__cpu:focus-visible {
    --ff-focus-offset: -2px;
    outline: 2px solid var(--ff-text);
    outline-offset: -2px;
  }
  /* The Change badge presses with the row it is drawn on. */
  .ff-seat:has(.ff-seat__change:active:not(:disabled)) :global(.ff-badge--action) {
    translate: 0 1px;
  }
  /* A row is the row token tall. Your own seat is a control, so it keeps the
     44 px touch floor however short the screen; the others need not, which
     is what lets four whole seats fit the 270 px a browser leaves (M12). */
  .ff-seat {
    min-height: var(--ff-row-h);
  }

  /* Short upright rooms need compact seats as well as compact settings:
     the rules must not push Ready and Leave below the viewport. Keep every
     seat visible and every seat button at the existing touch-target floor. */
  @container ff-screen (max-height: 640px) and (max-width: 599px) {
    .ff-ready[data-arrangement="stack"] {
      --ff-row-portrait: 28px;
      --ff-row-pad-y: 1px;
      --ff-row-h: calc(var(--ff-row-portrait) + 2 * var(--ff-row-pad-y) + 2px);
      --spacing-row-portrait: var(--ff-row-portrait);
      --spacing-row-pad: var(--ff-row-pad-y);
      --ff-namepill-self-pad: 0 6px;
      --ff-seat-col-gap: 8px;
      --ff-seat-px: 8px;
      --ff-seat-gap: 3px;
      --ff-panel-gap: 4px;
      --ff-panel-pad: 8px;
      --ff-badge-h: 18px;
    }
    .ff-ready[data-arrangement="stack"] .ff-ready__stack {
      grid-template-rows: auto minmax(0, 1fr);
    }
    .ff-ready[data-arrangement="stack"] .ff-ready__settings {
      grid-template-rows: minmax(min-content, 1fr) auto auto;
    }
  }

  /* Sideways on the smallest phone: tighter seat and panel gaps, so the seats,
     the settings, Ready and Leave all fit the height with nothing to scroll. */
  @container ff-screen (max-height: 340px) {
    .ff-ready[data-arrangement="split"] {
      --ff-row-portrait: 24px;
      --ff-row-pad-y: 2px;
      --ff-row-h: calc(var(--ff-row-portrait) + 2 * var(--ff-row-pad-y) + 2px);
      --spacing-row-portrait: var(--ff-row-portrait);
      --spacing-row-pad: var(--ff-row-pad-y);
      --ff-namepill-self-pad: 0 6px;
      --ff-seat-col-gap: 8px;
      --ff-seat-px: 8px;
      --ff-seat-gap: 3px;
      --ff-panel-gap: 4px;
      --ff-panel-pad: 8px;
      --ff-badge-h: 16px;
    }
    .ff-ready[data-arrangement="split"] .ff-ready__settings {
      grid-template-rows: minmax(min-content, 1fr) auto auto;
    }
  }

  /* Your seat's badges (YOU, HOST, Change) run on their own line under the
     name and the status both, so a translation ("TÚ · ANFITRIÓN · CAMBIAR")
     keeps one line instead of wrapping and costing the room its fourth seat
     (visual audit, 2026-10-05). The name and the status share the first
     line; the number and the portrait stand beside both. */
  .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) {
    grid-template-rows: auto auto auto;
    row-gap: 4px;
  }
  .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) > :global(*:nth-child(-n + 2)) {
    grid-row: 1 / span 3;
  }
  .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) .ff-seat__who {
    display: contents;
  }
  .ff-seat__who > :global(.ff-badge-row) {
    grid-column: 3 / -1;
    grid-row: 2;
    justify-self: start;
  }
  .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) .ff-seat__who > :global(:first-child) {
    grid-column: 3 / -1;
    grid-row: 1;
    justify-self: start;
    min-width: 0;
  }
  /* Your own seat reads name, badges, state: the name has the row to itself
     so it is never broken, whatever the width. */
  .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) > :global([data-testid="seat-status"]) {
    grid-column: 3 / -1;
    grid-row: 3;
    justify-self: start;
  }

  /* In the squeezed rooms the seat's number takes its digit's width and no
     more, so your own long name keeps its line. */
  @container ff-screen (max-height: 640px) and (max-width: 599px) {
    .ff-ready[data-arrangement="stack"] .ff-seat__number {
      min-width: 0;
    }
    .ff-ready[data-arrangement="stack"] .ff-race-options {
      row-gap: 4px;
    }
    /* Survival, 20 and 50 share one row: the Featured badge gives way, as it does
       sideways, which keeps Ready and Leave on the screen in the longest language. */
    .ff-ready[data-arrangement="stack"] .ff-race-options :global(.ff-option__badge),
    .ff-ready[data-arrangement="stack"] .ff-race-options :global(.ff-option__icon) {
      display: none;
    }
    /* A little less side padding, so Survival, 20 and 50 keep one row in the
       longest language. */
    .ff-ready[data-arrangement="stack"] .ff-race-options :global(.ff-option) {
      padding-inline: 8px;
    }
    /* Your own seat's state is on the Ready button (its tick) and read aloud;
       its line is what the squeezed room can give up. */
    .ff-ready[data-arrangement="stack"] .ff-seat[data-you="true"] > :global([data-testid="seat-status"]) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .ff-ready[data-arrangement="stack"] .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) {
      grid-template-rows: auto auto;
    }
    .ff-ready[data-arrangement="stack"] .ff-seat:has(.ff-seat__who > :global(.ff-badge-row)) > :global(*:nth-child(-n + 2)) {
      grid-row: 1 / span 2;
    }
  }
  @container ff-screen (max-height: 340px) {
    .ff-ready[data-arrangement="split"] .ff-seat__number {
      min-width: 0;
    }
    .ff-ready[data-arrangement="split"] .ff-race-options {
      row-gap: 4px;
    }
    /* Survival, 20 and 50 share one row: the Featured badge gives way. */
    .ff-ready[data-arrangement="split"] .ff-race-options :global(.ff-option__badge) {
      display: none;
    }
    /* Survival's stopwatch is drawn beside its word: with the longest words it is
       what keeps 50 on a row of its own, and the word says it. */
    .ff-ready[data-arrangement="split"] .ff-race-options :global(.ff-option__icon) {
      display: none;
    }
    .ff-ready[data-arrangement="split"] .ff-race-options :global(.ff-option) {
      padding-inline: 8px;
    }
    /* Sideways on the smallest phone there is no line to spare: the Floors
       row (Survival, 20, 50) is named to a screen reader and by its own
       buttons, and the Minutes row keeps its word. */
    .ff-ready[data-arrangement="split"] .ff-race-options > :global(.ff-options:first-child > .ff-aq-label) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  /* Two columns whenever the room is sideways: always side by side, never
     stacked by a measure of the panel. */
  .ff-ready__cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    min-height: 0;
  }

  /* The room is never wider than the content maximum, centred: on iPad and
     desktop the zoom has already made it a quarter bigger. */
  .ff-ready {
    max-width: var(--ff-content-max);
    justify-self: center;
  }
  /* Sideways, even a phone has two columns' worth of width: only the desktop
     measure caps it. */
  .ff-ready[data-arrangement="split"] {
    max-width: 880px;
  }

  /* Held sideways or on desktop: Ready and Leave stay at the foot of the
     right column, under the race choice. */
  .ff-ready[data-arrangement="split"] .ff-ready__settings {
    grid-template-rows: minmax(min-content, 1fr) auto auto;
    align-content: stretch;
  }
  /* A tall room (iPad sideways, a desktop window): the panel is as tall as
     what it holds, in the middle, not stretched with its middle empty. */
  @container ff-screen (min-height: 480px) {
    .ff-ready[data-arrangement="split"] :global(.ff-ready__chip) {
      align-self: center;
    }
  }
  /* A tall room held upright (a phone, an iPad): the panel is as tall as the
     room it holds, at the screen's foot under the thumb, Ready and Leave at
     its bottom, rather than full height with its middle empty. */
  @container ff-screen (min-height: 600px) {
    .ff-ready[data-arrangement="stack"] .ff-ready__stack {
      grid-template-rows: auto auto;
    }
    /* `safe`, and held to the room: a panel taller than the room (Survival's
       Featured badge on its own line, on a 15 Pro Max) rose over the corner
       row and hid the code, Copy and Mute (review R35). It scrolls instead. */
    .ff-ready[data-arrangement="stack"] :global(.ff-ready__chip) {
      align-self: safe end;
      max-height: 100%;
      overflow-y: auto;
    }
  }
  /* An iPad held upright is tall and wide: the panel takes the whole room
     instead of sitting at the foot under a blank sky, and the seats share the
     height the settings leave, a row each, rather than leaving the middle
     empty. A phone keeps the compact foot panel above. */
  @container ff-screen (min-height: 600px) and (min-width: 500px) {
    .ff-ready[data-arrangement="stack"] .ff-ready__stack {
      grid-template-rows: 1fr auto;
    }
    .ff-ready[data-arrangement="stack"] :global(.ff-ready__chip) {
      align-self: stretch;
      max-height: none;
    }
    .ff-ready[data-arrangement="stack"] .ff-ready__seats-box {
      height: 100%;
    }
    .ff-ready[data-arrangement="stack"] [data-testid="seats"] {
      height: 100%;
      align-content: stretch;
      grid-auto-rows: minmax(var(--ff-row-h), 1fr);
    }
  }
  .ff-seat:has(.ff-seat__change) {
    min-height: max(var(--ff-row-h), var(--ff-aq-target));
  }
</style>
