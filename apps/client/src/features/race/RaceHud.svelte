<script lang="ts" module>
  /** How long a tap on the collapsed pill shows the full roster. */
  export const STANDINGS_EXPAND_MS = 3000;
</script>

<script lang="ts">
  /**
   * The race HUD.
   *
   * Smooth type at CSS resolution over the pixel world, which is the point of
   * the move: the drawn HUD had to set Silkscreen at whole multiples of its
   * eight-pixel grid or the rasteriser resampled it, and a roster row at four
   * seats was already at the size limit that imposed. Here the numerals can be
   * Fusion Pixel with tabular figures and stay legible at whatever the display has.
   *
   * Nothing over the course is interactive. The root is `pointer-events: none`,
   * so a thumb aiming at the course is never intercepted by a chip it happens
   * to pass over. The exceptions are the Menu button and -- on touch -- the
   * timer, which restarts on tap. The portrait standings line takes no pointer
   * at all, so a steer that starts under it still steers.
   *
   * It reads a `HudModel` and renders it. It counts nothing, orders nothing and
   * predicts nothing: every number on screen arrived in a snapshot.
   */
  import * as m from "../../paraglide/messages.js";
  import type { Attachment } from "svelte/attachments";
  import { untrack } from "svelte";
  import Icon from "../kit/Icon.svelte";
  import IconButton from "../kit/IconButton.svelte";
  import Panel from "../kit/Panel.svelte";
  import Toast from "../kit/Toast.svelte";
  import { standingsPillText, standingsSummary, statusWord, type HudModel, type HudRow } from "./hud-model";
  import type { SpringTuning } from "@floor-fifty/shared/content/game-content";
  import { flip, pulse, reducedMotion, rollDigits } from "../kit/motion";
  import { springPop } from "./spring-pop";
  import type { HudPlacement, RacerBox } from "./race-hud.svelte";
  import type { SettingsStore } from "../profile/store/settings.svelte";
  import RotateHint from "./RotateHint.svelte";
  import SwipeCoach from "./SwipeCoach.svelte";
  import RaceHint from "./RaceHint.svelte";
  import type { RaceHintKind } from "./race-hints";
  import { inputMethod } from "../platform/input-method.svelte";

  /**
   * The standing line's height and a gap: how far above the replay bar it must
   * sit. The bar publishes its top (ReplayControls); taller with large text,
   * it rose into the line.
   */
  const LINE_CLEARANCE = 52;

  let {
    model,
    placement,
    settings,
    hint,
    onCoachDismiss,
    onPause,
    onRestart,
    solo = false,
    replay = false,
    announcement = "",
    recoveryHint = false,
    racer = undefined,
    floorsPop = 0,
    popScale = 1.06,
    barks = {},
    popSpring = undefined,
  }: {
    model: HudModel;
    recoveryHint?: boolean;
    /** Where the local racer is drawn, while the coach is up: the coach hangs clear of it. */
    racer?: RacerBox | undefined;
    placement: HudPlacement;
    /** Carries the rotate hint's "seen" flag. */
    settings?: SettingsStore;
    /**
     * The one hint this race shows in the toast slot now, if any: the swipe
     * coach, the rotate hint or one of the first-race hints. The screen picks
     * (`race-hints.ts`), so two never share the slot.
     */
    hint?: RaceHintKind;
    /** Called when the swipe coach is dismissed. */
    onCoachDismiss?: () => void;
    /** Opens the pause overlay; the HUD owns only the button's place. */
    onPause?: () => void;
    /**
     * Makes the timer a restart button. Given on touch only, where there is
     * no R key: a tap on the clock, clear of both thumbs.
     */
    onRestart?: () => void;
    /**
     * One racer on one lap, as a solo replay is: the Lap chip and the standings
     * would say nothing Floors does not, so neither is drawn.
     */
    solo?: boolean;
    /** A replay: the timer carries a Replay chip, its capitals from CSS. */
    replay?: boolean;
    /** What the race's polite region says now (race-flow spec §6). */
    announcement?: string;
    /**
     * Floors authority has credited the local racer with, as drawn: the Floors
     * chip pops each time it rises (polish spec §6), never on a prediction.
     */
    floorsPop?: number;
    /** How far the chip pops: `juice.toml`'s `collect.hudPop.scale`. */
    popScale?: number;
    /** Each CPU's mood word while it lasts, by racer (CPU banding spec §4). */
    barks?: Readonly<Record<string, string>>;
    /** The pop's spring, `juice.toml`'s `springs.hudPop`; without one the chip pulses (Wonder spec §4.2). */
    popSpring?: SpringTuning | undefined;
  } = $props();

  /** Pops the chip when the count rises, on its spring when it has one; never on the first render. */
  function popOnRise(node: HTMLElement, value: { count: number; scale: number; spring?: SpringTuning | undefined }) {
    let last = value.count;
    let stop: (() => void) | undefined;
    return {
      update(next: { count: number; scale: number; spring?: SpringTuning | undefined }) {
        if (next.count > last) {
          if (next.spring === undefined) pulse(node, next.scale);
          else if (!reducedMotion()) stop = springPop(node, next.scale, next.spring);
        }
        last = next.count;
      },
      destroy() {
        stop?.();
      },
    };
  }

  /** The Floors chip's pop, as an attachment so it can sit on a `Panel`. */
  const popFloors: Attachment<HTMLElement> = (node) => {
    const handle = popOnRise(node, untrack(() => ({ count: floorsPop, scale: popScale, spring: popSpring })));
    $effect(() => handle.update({ count: floorsPop, scale: popScale, spring: popSpring }));
    return () => handle.destroy();
  };

  // Survival has no reset (survival spec §3): its clock is never a restart.
  const restart = $derived(model.endless === undefined ? onRestart : undefined);
  const timerTag = $derived(restart === undefined ? "span" : "button");

  const statusOf = (row: HudRow): string => statusWord(row.status);

  /**
   * A tablet held upright shows the named roster as a band under the metric row
   * (responsive parity spec §5.4); a phone held upright shows one standings line above the thumbs.
   */
  const band = $derived(placement.formFactor === "tablet-portrait");
  /* The metric row's and the band's heights, measured, so the band can hang
     under the row and the toast under the band at any text size. */
  let metricsHeight = $state(0);
  let rosterHeight = $state(0);
  /** The hint under the row, 0 with none: what the start prompt and a notice must clear. */
  let toastHeight = $state(0);
  /** Where the toast would start under the row, in window pixels. */
  const toastTop = $derived(placement.frame.y + placement.inset.top + metricsHeight + (band ? rosterHeight + 8 : 0) + 10);
  /**
   * How far the coach drops to hang under the racer when it would cover it
   * (a phone on its side crops the field, which puts the racer up under the
   * row). Worked from the toast's natural place, so it does not flip.
   */
  const coachDrop = $derived(
    racer === undefined || hint !== "swipe" || coachDone || toastHeight === 0 || racer.top >= toastTop + toastHeight + 4 || racer.bottom <= toastTop - 4
      ? 0
      : racer.bottom + 8 - toastTop,
  );
  /** How far down the HUD's own top block reaches, from the HUD's top: the row, the tablet's band and the hint. A notice in a race hangs under it. */
  const under = $derived(
    placement.inset.top + metricsHeight + (band ? rosterHeight + 8 : 0) + (toastHeight > 0 ? toastHeight + 10 + coachDrop : 0),
  );
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ff-hud-under", `${under}px`);
    // The same line in the window's own coordinates, for a notice that hangs under it.
    root.style.setProperty("--ff-hud-under-y", `${placement.frame.y + under}px`);
    return () => {
      root.style.removeProperty("--ff-hud-under");
      root.style.removeProperty("--ff-hud-under-y");
    };
  });

  /** Reports an element's height now and whenever it changes. */
  function measureHeight(node: HTMLElement, report: (height: number) => void) {
    report(node.offsetHeight);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => report(node.offsetHeight));
    observer?.observe(node);
    return { destroy: () => observer?.disconnect() };
  }

  /** The toast slot now on screen: a slot that is falling out must not zero the height of the one that replaced it. */
  let measuredToast: HTMLElement | undefined;

  /** Reports a toast's height, and 0 when it goes. */
  function measureToast(node: HTMLElement) {
    measuredToast = node;
    const report = (): void => {
      if (measuredToast === node) toastHeight = node.offsetHeight;
    };
    report();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(report);
    observer?.observe(node);
    return {
      destroy() {
        observer?.disconnect();
        if (measuredToast === node) {
          measuredToast = undefined;
          toastHeight = 0;
        }
      },
    };
  }

  /** Floors as the board sets them: two digits, "03 / 20". */
  const twoDigits = (value: number): string => String(value).padStart(2, "0");

  /** The swipe coach retires for this race as soon as it is dismissed. */
  let coachDone = $state(false);
  function coachDismissed(): void {
    coachDone = true;
    onCoachDismiss?.();
  }

  /** The portrait standing line's place: its strip, or clear of the replay bar where that rises past it. */
  const standingTop = $derived(`top: min(${placement.stripTop ?? 0}px, calc(var(--ff-replay-panel-top, 100000px) - ${LINE_CLEARANCE}px))`);

  /** The collapsed pill's text (spec §4.4), from the local row's id. */
  const localId = $derived(model.rows.find((row) => row.local)?.id ?? "");
  /** The latest CPU mood word, for the phone upright, which has no rows to hang it on. */
  const latestBark = $derived.by((): { text: string; scarf: string } | undefined => {
    for (const id of Object.keys(barks).reverse()) {
      const row = model.rows.find((candidate) => candidate.id === id);
      if (row !== undefined) return { text: barks[id]!, scarf: row.scarf };
    }
    return undefined;
  });
  const pillText = $derived(standingsPillText(standingsSummary(model.rows, localId)));
  /** A tap on the pill opens the full roster for a moment. */
  let expanded = $state(false);
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  function expandStandings(): void {
    clearTimeout(expandTimer);
    expanded = true;
    expandTimer = setTimeout(() => (expanded = false), STANDINGS_EXPAND_MS);
  }
  $effect(() => () => clearTimeout(expandTimer));
</script>

<!--
  `pointer-events: none` on the information root, and nothing inside opts back
  in. `data-testid` rather than a class so a test can find it without depending
  on the styling.
-->
<div
  class="ff-hud"
  data-testid="race-hud"
  data-orientation={placement.portrait ? "portrait" : "landscape"}
  data-form-factor={placement.formFactor}
  data-compact={String(placement.compact)}
  data-band={band ? "roster" : undefined}
  style:--ff-strip-top="{placement.stripTop ?? 0}px"
  style:--ff-metrics-height="{metricsHeight}px"
  style:--ff-roster-height="{rosterHeight}px"
  style:--ff-hud-left="{placement.frame.x}px"
  style:--ff-hud-top="{placement.frame.y}px"
  style:--ff-hud-width="{placement.frame.width}px"
  style:--ff-hud-height="{placement.frame.height}px"
  style:--ff-hud-inset-top="{placement.inset.top}px"
  style:--ff-hud-inset-inline="{placement.inset.inline}px"
>
  {#if model.endless !== undefined}
    <div class="ff-hud__vignette" style:opacity={model.danger} data-testid="survival-vignette" aria-hidden="true"></div>
  {/if}
  <!-- Metrics and roster are separate landmarks, so a screen reader can jump to
       either without hearing the other. Neither is a live region: a timer that
       announced every tenth would be unusable. The one polite region below
       carries the race's phase and status changes (race-flow spec §6). -->
  <p class="sr-only" role="status" aria-live="polite" data-testid="race-announcer">{announcement}</p>
  <!-- The way into the pause overlay (launch polish §3.1.1): a control with
       a visible word, in the metric row's own grid so it can never sit on a
       chip -- beside Floors when the row has room to spare (landscape), and
       as the row's last cell in portrait, where three chips fill it. -->
  {#snippet pause()}
    {#if onPause !== undefined}
      <IconButton
        icon="menu"
        label={m.race_pause_menu()}
        data-testid="pause-open"
        data-sfx="none"
        class="ff-hud__pause ff-hud__pause--tile"
        onclick={onPause}
      />
    {/if}
  {/snippet}

  <!-- The floors value: "NN / NN", or in Infinite the floor now and the best
       reached (race-options spec §5.5). The count rolls when it changes
       (polish spec §6): a swap under reduced motion. -->
  {#snippet floorsValue()}
    {#if model.endless}
      <span class="ff-hud__value ff-hud__value--large">
        <span use:rollDigits={twoDigits(model.endless.floor)}></span>
        <span class="ff-hud__best" data-testid="hud-best"><span class="sr-only">{m.race_best_floor()} </span><span aria-hidden="true">▲</span> {model.endless.best}</span>
      </span>
    {:else}
      <span class="ff-hud__value ff-hud__value--large"><span use:rollDigits={twoDigits(model.collected)}></span> / {twoDigits(model.floorCount)}</span>
    {/if}
  {/snippet}

  <!-- The clock: elapsed time, or in Infinite the time left. The urgent style
       enlarges the digits, so it is never only a colour; it is never in the
       live region, so it is never announced. -->
  {#snippet clockValue(large: boolean)}
    {#if model.endless}
      <span
        class="{large ? 'ff-hud__value ff-hud__value--large ff-hud__value--timer' : ''} {model.endless.urgent ? 'ff-hud__value--urgent' : ''}"
        data-testid="hud-clock"
        data-urgent={String(model.endless.urgent)}>{model.endless.clock}</span
      >
    {:else}
      <span class={large ? "ff-hud__value ff-hud__value--large ff-hud__value--timer" : undefined} data-testid="hud-timer">{model.elapsed}</span>
    {/if}
  {/snippet}

  <section class="ff-hud__metrics" aria-label={m.race_progress()} data-hud-metrics use:measureHeight={(height) => (metricsHeight = height)}>
    <div class="ff-hud__cell ff-hud__cell--lead">
      <!-- Pops when authority credits the local racer a floor (polish spec §6). -->
      <Panel as="span" tone="hud" arrive="none" leave="none" class="ff-hud__chip ff-hud__chip--stacked" data-testid="hud-floors" {@attach popFloors}>
        <span class="ff-hud__label">{model.endless ? m.race_floor() : m.race_floors()}</span>
        {@render floorsValue()}
      </Panel>
      {#if !placement.portrait && !solo}
        <Panel as="span" tone="hud" arrive="none" leave="none" class="ff-hud__chip ff-hud__chip--stacked" data-testid="hud-lap">
          <span class="ff-hud__label">{m.race_lap()}</span>
          <span class="ff-hud__value">{model.lap}/{model.lapCount}</span>
        </Panel>
      {/if}
      {#if !placement.portrait}{@render pause()}{/if}
    </div>

    <!-- Time, or in a replay the Replay chip in its place (Task 5; the
         capitals are CSS's). -->
    <Panel
      as={timerTag}
      tone="hud"
      arrive="none"
      leave="none"
      type={restart === undefined ? undefined : "button"}
      aria-label={restart === undefined ? undefined : model.restart}
      data-testid={restart === undefined ? undefined : "hud-restart"}
      class="ff-hud__chip ff-hud__chip--stacked ff-hud__cell--centre {restart === undefined ? '' : 'ff-hud__restart'}"
      onclick={restart}
    >
      {#if replay}<span class="ff-hud__replay" data-testid="hud-replay">{m.race_replay()}</span>{:else}<span class="ff-hud__label">{m.race_time()}</span>{/if}
      {@render clockValue(true)}
      {#if restart !== undefined}<span class="ff-hud__restart-glyph" aria-hidden="true"><Icon name="restart" /></span>{/if}
    </Panel>

    <div class="ff-hud__cell ff-hud__cell--trail">
      {#if placement.portrait && !solo}
        <Panel as="span" tone="hud" arrive="none" leave="none" class="ff-hud__chip ff-hud__chip--stacked" data-testid="hud-lap">
          <span class="ff-hud__label">{m.race_lap()}</span>
          <span class="ff-hud__value ff-hud__value--large">{model.lap}/{model.lapCount}</span>
        </Panel>
      {/if}
      {#if placement.portrait}{@render pause()}{/if}
    </div>

    <!-- The toast slot: one hint at a time, centred under the top row on
         every form factor, so it never sits on a chip or over the thumbs. The
         rotate hint is for a phone held upright only (a tablet's portrait is
         a layout of its own, spec §5.6). -->
    {#if model.outBanner !== undefined}
      <!-- Out: the slot's room is "OUT!" and its reason's, whatever was showing. -->
    {:else if hint === "swipe" && !coachDone}
      <div class="ff-hud__toast" {@attach (node) => measureToast(node).destroy} style:margin-top="{coachDrop}px">
        <SwipeCoach endless={model.endless !== undefined} onDismiss={coachDismissed} />
      </div>
    {:else if hint === "edge" || hint === "floors" || hint === "restart"}
      <!-- A first-race hint comes before the missed-floor reminder: the screen
           counts its seconds and marks it seen whether or not it was on show,
           and the floors hint says what the reminder says. The reminder is
           back once the hints are spent. -->
      <div class="ff-hud__toast" {@attach (node) => measureToast(node).destroy}>
        <Toast class="ff-aq-secondary"><RaceHint kind={hint} /></Toast>
      </div>
    {:else if recoveryHint}
      <div class="ff-hud__toast" {@attach (node) => measureToast(node).destroy}>
        <Toast class="ff-aq-secondary" data-testid="missed-floor-help">{m.race_missed_floor_help()}</Toast>
      </div>
    {:else if hint === "rotate" && settings !== undefined && placement.formFactor === "phone-portrait" && !settings.value.seen.rotateHint}
      <div class="ff-hud__toast ff-hud__toast--row" {@attach (node) => measureToast(node).destroy}>
        <RotateHint portrait {settings} />
      </div>
    {/if}
  </section>

  {#if solo}
    <!-- No standings with one racer. -->
  {:else if placement.portrait && !band}
    <!-- Phone portrait: one line, the local racer's place and who leads, above
         the thumbs. It reads from the model and takes no pointer. -->
    <Panel
      as="p"
      tone="hud"
      arrive="none"
      leave="none"
      class="ff-hud__standing"
      data-testid="hud-standings-line"
      style={standingTop}
    >{pillText}{#if latestBark !== undefined}<span class="ff-hud__bark ff-hud__bark--line" data-testid="hud-bark" style:color="var(--ff-player-{latestBark.scarf})" aria-hidden="true">{latestBark.text}</span>{/if}</Panel>
  {:else if placement.collapsed && !expanded}
    <Panel
      as="button"
      type="button"
      tone="hud"
      arrive="none"
      leave="none"
      class="ff-hud__summary"
      data-testid="hud-standings-pill"
      aria-label={m.race_standings_pill({ standings: pillText })}
      onclick={expandStandings}
    >{pillText}</Panel>
  {:else}
  <!-- One panel, a dot and a name per racer: the Aquarian
       board's roster (spec §2.8 item 12). On a tablet held upright it is a
       band under the metric row instead, and the lap stays in the row. -->
  <Panel tone="hud" arrive="none" leave="none" class="ff-hud__roster" data-testid="hud-roster" {@attach (node) => measureHeight(node, (height) => (rosterHeight = height)).destroy}>
  <ol class="ff-hud__rows" aria-label={m.race_racers()}>
    {#each model.rows as row (row.id)}
      <li
        animate:flip
        class="ff-hud__row"
        data-testid="hud-row"
        data-seat={row.seat}
        data-local={String(row.local)}
        data-status={row.status}
        data-out={String(row.out)}
        data-pulse={String(row.pulse)}
        data-leader={String(row.leader)}
      >
        <!-- Seat identity as a coloured dot, and never the only signal: the
             seat number and the name beside it say the same thing. -->
        <span
          class="ff-hud__dot"
          style:background="var(--ff-player-{row.scarf})"
          aria-hidden="true"
        ></span>
        <span class="ff-hud__place">{row.seat + 1}</span>
        {#if barks[row.id] !== undefined}
          <span class="ff-hud__bark" data-testid="hud-bark" style:color="var(--ff-player-{row.scarf})" aria-hidden="true">{barks[row.id]}</span>
        {/if}
        <!-- The whole name lives in the DOM and in `title`; the ellipsis is a
             visual affordance, not a truncation of the value. -->
        <!-- Infinite's leader (race-options spec §5.5): a mark, not a reorder. -->
        {#if row.leader}<span class="ff-hud__leader" aria-hidden="true">▲</span>{/if}
        <span class="ff-hud__name" data-truncatable title={row.name}>{row.name}</span>
        <!-- The lap chip and the status word share the row's fourth cell. The
             climb bar is pinned to the fifth, and a cell each would push it
             onto a second row for a ghost or DNS racer. -->
        {#if model.lapCount > 1 || statusOf(row) !== ""}
          <span class="ff-hud__row-tail">
            {#if model.lapCount > 1}<span class="ff-hud__row-lap" data-testid="hud-row-lap">{row.lap}/{model.lapCount}</span>{/if}
            {#if statusOf(row) !== ""}
              <span class="ff-hud__status">{statusOf(row)}</span>
            {/if}
          </span>
        {/if}
        <!-- The racer's climb as a bar in the seat colour: the user preferred
             it to the dot alone. -->
        <span class="ff-hud__track" aria-hidden="true">
          <span
            class="ff-hud__fill"
            style:width="{Math.round(row.progress * 100)}%"
            style:background="var(--ff-player-{row.scarf})"
          ></span>
        </span>
      </li>
    {/each}
  </ol>
  </Panel>
  {/if}
  <!-- The lap the local racer is held for (race-flow spec §4.1). Hidden from
       assistive tech: the race's live region says the lap. -->
  {#if model.lapBanner !== undefined}
    {#key model.lapBanner}
      <p class="ff-hud__lap-banner" data-testid="lap-banner" aria-hidden="true">{model.lapBanner}</p>
    {/key}
  {/if}
  <!-- Survival's out (survival spec §7), in the lap banner's voice. The
       results say it in words; this is the moment. -->
  {#if model.outBanner !== undefined}
    <!-- The word and the reason share one box, so the reason sits directly
         under the word at any size and never over it. Both are silent: the
         race's live region says why (first-race spec part 3). -->
    <div class="ff-hud__out">
      <p class="ff-hud__lap-banner ff-hud__out-banner" data-testid="out-banner" aria-hidden="true">{model.outBanner}</p>
      {#if model.outLine !== undefined}
        <p class="ff-hud__out-line" data-testid="out-line" aria-hidden="true">{model.outLine}</p>
      {/if}
    </div>
  {:else if model.awaitingStart && !replay}
    <!-- A Survival racer's edge waits for her first input (first-race spec
         part 2). Silent: the screen asks the same of everyone who can see it,
         and a screen reader's player is on a keyboard, where any key works. A
         replay starts every racer waiting and is never asked to press. -->
    <Panel as="p" arrive="none" leave="none" class="ff-hud__start-prompt" data-testid="start-prompt" aria-hidden="true">
      {inputMethod.method === "touch" ? m.race_start_tap() : m.race_start_press()}
    </Panel>
  {/if}
</div>

<style>
  /* These rules stay scoped rather than moving to utilities (responsive parity
     spec §3.3): each is positioned by the inline letterbox geometry
     (`--ff-hud-*`) and the safe areas, or switched by `data-compact` /
     `data-local`, which reads as one stylesheet here and as a string of long
     arbitrary values in markup. Sizes come from the form-factor tokens. */

  /* Positioned against the visible play field rather than the canvas. The
     placement comes from the screen, which derives it from the shared
     `ViewportInfo` -- so the HUD and the letterbox cannot disagree about where
     the field is. */
  .ff-hud {
    position: fixed;
    left: var(--ff-hud-left);
    top: var(--ff-hud-top);
    width: var(--ff-hud-width);
    height: var(--ff-hud-height);
    pointer-events: none;
    /* Above the touch surfaces (z 2), under the swipe coach (z 4): the root
       takes no pointer, so only the controls it opts back in are lifted over
       the swipe surface. */
    z-index: 3;
    font-family: var(--ff-font-ui);
    /* Tabular figures and a fixed advance, so a running clock does not shift
       the chips either side of it as the digits change. */
    font-variant-numeric: tabular-nums;
  }

  /* One grid on every form factor: Floors, then Time on the centre axis, then
     the trailing cell. Every tile is the row's height (spec §4.4). */
  .ff-hud__metrics {
    position: absolute;
    top: max(var(--ff-hud-inset-top), env(safe-area-inset-top));
    left: max(var(--ff-hud-inset-inline), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    right: max(var(--ff-hud-inset-inline), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: stretch;
    gap: 8px;
  }
  .ff-hud__cell {
    display: flex;
    align-items: stretch;
    gap: 8px;
    min-width: 0;
  }
  .ff-hud__cell--lead { justify-content: flex-start; }
  .ff-hud__cell--trail { justify-content: flex-end; }
  :global(.ff-hud__cell--centre) { justify-self: center; align-items: center; }
  /* Landscape keeps the roster panel in the top right, so the trailing cell is
     empty there (Lap is in the lead cell) and the panel sits over it. */
  .ff-hud[data-orientation="landscape"] .ff-hud__cell--trail { visibility: hidden; }
  /* A replay's chip and its clock side by side in the centre tile (Task 5). */
  :global(.ff-hud__cell--centre):has(.ff-hud__replay) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  /* Menu: a square tile the row's height. */
  :global(.ff-hud__pause--tile) {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    padding: 0;
    min-width: 44px;
  }
  /* The rotate hint is a slim row of the grid, under the tiles. */
  .ff-hud__metrics > .ff-hud__toast--row,
  .ff-hud[data-orientation="portrait"] .ff-hud__metrics > .ff-hud__toast--row {
    position: static;
    transform: none;
    grid-column: 1 / -1;
    justify-self: center;
  }
  .ff-hud__value { white-space: nowrap; }
  /* Portrait: the side cells are the grid's two equal columns, and their
     chips fill them, so Time stands on the centre line with the same gap
     either side. Alone, Lap is gone and the menu fills the trailing cell, so
     the row does not lean on Floors. */
  .ff-hud[data-orientation="portrait"] .ff-hud__cell > :global(.ff-hud__chip) { flex: 1 1 auto; }
  /* Held upright the menu is always the row's last, square tile, whatever stands beside it: in
     the story, with Time alone, it had flowed into a wide column as a blue slab (review R29). */
  .ff-hud[data-orientation="portrait"] :global(.ff-hud__pause--tile) { grid-column: -2; justify-self: end; aspect-ratio: 1; }
  /* And Time keeps the centre column, alone or not. */
  .ff-hud[data-orientation="portrait"] .ff-hud__metrics > :global(.ff-hud__cell--centre),
  .ff-hud[data-orientation="portrait"] :global(.ff-hud__cell--centre) { grid-column: 2; }
  /* Held upright, phone or tablet, each tile's text is centred in it: the
     tiles fill the row, and flush-left words left them looking lopsided. */
  .ff-hud[data-orientation="portrait"] :global(.ff-hud__chip--stacked) {
    align-items: center;
    text-align: center;
  }
  /* ...and the hint under them, whose lines wrap there. */
  .ff-hud[data-form-factor="phone-portrait"] .ff-hud__toast :global(p) { text-align: center; }

  /* The toast slot: out of the row's grid, hung under it and centred on the
     screen, in either orientation. The portrait chip rule stretches and pads
     every cell; this one is neither. */
  /* The slot is as wide as its toast, so the toast's own percentage limit shrank it to a few
     words a line. Its limit is the HUD's width instead. */
  .ff-hud__toast :global(.ff-toast) {
    max-width: min(36rem, calc(var(--ff-hud-width) - 2 * var(--ff-gutter, 16px)));
  }

  .ff-hud__metrics > .ff-hud__toast,
  .ff-hud[data-orientation="portrait"] .ff-hud__metrics > .ff-hud__toast {
    position: absolute;
    top: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    justify-content: center;
    width: max-content;
    max-width: 100%;
    padding: 0;
    min-width: 0;
  }

  /* The one control in the HUD, so the one element the root's
     `pointer-events: none` lets back in (with the touch restart). */
  :global(.ff-hud__pause) {
    pointer-events: auto;
  }
  /* Held upright, Floors, Time and Lap are one width and the menu is the same
     gap away from Lap as they are from each other (Owner, 2026-11-18 22:22Z:
     "equal spacing, just shrink it to fit"). The cells step aside so the four
     tiles are the grid's own columns, in the order they are drawn. A tile
     whose numbers do not fit its width drops them to the label size, all
     three together, so none looks bigger than its neighbours. */
  .ff-hud[data-orientation="portrait"] .ff-hud__metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 8px;
  }
  .ff-hud[data-orientation="portrait"] .ff-hud__cell { display: contents; }
  .ff-hud[data-orientation="portrait"] :global(.ff-hud__chip--stacked) {
    container-type: inline-size;
    padding: 6px 4px;
  }
  .ff-hud[data-orientation="portrait"] .ff-hud__cell > :global(.ff-hud__chip),
  .ff-hud[data-orientation="portrait"] :global(.ff-hud__cell--centre) { justify-self: stretch; }
  @container (width < 84px) {
    :global(.ff-hud__chip) .ff-hud__value--large,
    :global(.ff-hud__chip) .ff-hud__value--timer { font-size: var(--ff-type-hint); }
    /* Urgent is still twice what the clock is, so it is never only a colour. */
    :global(.ff-hud__chip) .ff-hud__value--urgent { font-size: var(--ff-type-button); }
  }
  /* A phone on its side leaves the lead cell about 200 px for Floors, Lap and
     the menu: tighter chips keep the menu off the time. */
  .ff-hud[data-compact="true"] .ff-hud__metrics,
  .ff-hud[data-compact="true"] .ff-hud__cell { gap: 4px; }
  .ff-hud[data-compact="true"] :global(.ff-hud__chip--stacked) { padding: 4px 3px; }
  :global(.ff-hud__chip) {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 10px;
  }

  /* Label over value: "Floors" above "03 / 20". */
  :global(.ff-hud__chip--stacked) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 8px 14px;
  }

  .ff-hud__label {
    font-size: var(--ff-hud-label);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--ff-text-2);
    text-transform: uppercase;
  }

  .ff-hud__value {
    font-size: var(--ff-hud-value);
    font-weight: 600;
    color: var(--ff-text);
  }

  .ff-hud__value--large {
    font-size: var(--ff-hud-numeral);
    line-height: 1.1;
  }

  /* The clock's own size: "0:00.0" is the widest chip, so a phone holds it
     smaller than the floors numeral beside it. */
  .ff-hud__value--timer {
    font-size: var(--ff-hud-timer);
  }

  /* Infinite's last ten seconds: larger digits, so urgency is never only a
     colour (race-options spec §5.5). No transition: only opacity tweens. */
  .ff-hud__value--urgent {
    font-size: var(--ff-type-hero);
  }

  /* Infinite's best floor beside the floor now, and the leader's mark. */
  .ff-hud__best,
  .ff-hud__leader {
    font-size: var(--ff-type-hint);
  }

  /* The timer as restart, on touch: the chip's own material, and pressed as
     the controls press, so the one tap it takes reads as a tap. */
  :global(.ff-hud__restart) {
    pointer-events: auto;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  :global(.ff-hud__restart):focus-visible {
    outline: 2px solid var(--ff-text);
    outline-offset: 2px;
  }
  /* The restart arrow under the time, centred: the chip stacks its lines as a column. */
  :global(.ff-hud__restart) {
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
  .ff-hud__restart-glyph {
    --ff-icon-size: var(--ff-hud-label);
    color: var(--ff-text-2);
  }


  /* One panel in the top right, clear of the thumb corners: the lap, then a
     dot and a name per racer. */
  :global(.ff-hud__roster) {
    position: absolute;
    top: max(var(--ff-hud-inset-top), env(safe-area-inset-top));
    right: max(var(--ff-hud-inset-inline), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    display: grid;
    gap: 4px;
    /* Its inline padding, which the barks clear (the owner: the panel covered them). */
    --ff-roster-pad: 12px;
    padding: 8px var(--ff-roster-pad);
  }


  .ff-hud__rows {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  :global(.ff-hud__roster) { width: clamp(180px, 24vw, 280px); }
  .ff-hud__row {
    position: relative;
    display: grid;
    grid-template-columns: 10px auto minmax(0, 1fr) auto minmax(40px, 0.6fr);
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .ff-hud__track {
    display: block;
    grid-column: 5;
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--ff-panel-border);
    overflow: hidden;
  }
  .ff-hud[data-compact="true"] .ff-hud__row { padding: 0; }
  .ff-hud[data-compact="true"] :global(.ff-hud__roster) { --ff-roster-pad: 8px; padding: 4px var(--ff-roster-pad); }
  /* The collapsed standings: one pill in the top-right corner, a target. */
  :global(.ff-hud__summary) {
    position: absolute;
    top: max(var(--ff-hud-inset-top), env(safe-area-inset-top));
    right: max(var(--ff-hud-inset-inline), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    pointer-events: auto;
    min-height: 44px;
    padding: 6px 12px;
    font: 600 var(--ff-hud-value) / 1 var(--ff-font-ui);
    color: var(--ff-text);
    white-space: nowrap;
    cursor: pointer;
  }

  .ff-hud__dot {
    display: block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .ff-hud__place {
    font-size: var(--ff-type-hint);
    font-weight: 600;
    color: var(--ff-text-2);
  }

  .ff-hud__name {
    min-width: 0;
    font-size: var(--ff-type-hint);
    color: var(--ff-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .ff-hud__fill {
    display: block;
    height: 100%;
  }

  .ff-hud__row-tail {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .ff-hud__status {
    font-size: var(--ff-type-hint);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--ff-text-2);
    text-transform: uppercase;
  }




  /* A tablet held upright: the roster is a band across the screen under the
     metric row, the four racers side by side with their names. It sat at the
     bottom strip's top, above the thumbs, which is where a player's fingers
     rest on a tablet held upright -- so it was always under one. The top is
     free scenery in portrait, as the metric row already relies on. */
  .ff-hud[data-band="roster"] :global(.ff-hud__roster) {
    top: calc(max(var(--ff-hud-inset-top), env(safe-area-inset-top)) + var(--ff-metrics-height) + 8px);
    left: max(var(--ff-hud-inset-inline), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px));
    right: max(var(--ff-hud-inset-inline), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    /* The band runs edge to edge: the corner panel's width would win over
       `right` and squeeze four racers into one panel's width. */
    width: auto;
    padding: 10px 16px;
  }

  /* The toast hangs under the band rather than over it. */
  .ff-hud[data-band="roster"] .ff-hud__metrics > .ff-hud__toast {
    top: calc(100% + 8px + var(--ff-roster-height) + 10px);
  }

  /* A quarter of the band per racer, centred as a group: with fewer than
     four racers, four fixed columns left the cells on the band's left. */
  .ff-hud[data-band="roster"] .ff-hud__rows {
    grid-auto-flow: column;
    grid-auto-columns: calc((100% - 3 * 20px) / 4);
    justify-content: center;
    column-gap: 20px;
  }

  /* In the band each racer is a cell of two lines: the dot, place and name,
     then the climb bar under them across the cell. Beside the name, at the
     cell's end, each bar sat against the next racer's dot and read as theirs. */
  .ff-hud[data-band="roster"] .ff-hud__row {
    grid-template-columns: 10px auto auto minmax(0, 1fr) auto;
    row-gap: 5px;
  }
  .ff-hud[data-band="roster"] .ff-hud__dot { grid-area: 1 / 1; }
  .ff-hud[data-band="roster"] .ff-hud__place { grid-area: 1 / 2; }
  .ff-hud[data-band="roster"] .ff-hud__leader { grid-area: 1 / 3; }
  .ff-hud[data-band="roster"] .ff-hud__name { grid-area: 1 / 4; }
  .ff-hud[data-band="roster"] .ff-hud__row-tail { grid-area: 1 / 5; }
  .ff-hud[data-band="roster"] .ff-hud__track { grid-row: 2; grid-column: 1 / -1; }

  /* Portrait: the standings are one line in the bottom band, above the
     thumbs. It takes no pointer, so a steer can start under it. */
  :global(.ff-hud__standing) {
    position: absolute;
    left: 50%;
    translate: -50% 0;
    max-width: calc(100% - 2 * var(--ff-hud-inset-inline));
    margin: 0;
    padding: 6px 12px;
    font: 600 var(--ff-hud-value) / 1.2 var(--ff-font-ui);
    color: var(--ff-text);
    text-align: center;
    pointer-events: none;
  }

  /* Survival's danger (survival spec §7): the field's edges darken as the
     racer's edge closes in, most at the bottom, where it rises from. Under
     every chip, and it takes no pointer. */
  .ff-hud__vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition: opacity 120ms linear;
    background:
      radial-gradient(ellipse at 50% 40%, transparent 55%, color-mix(in srgb, var(--ff-text) 60%, transparent) 100%),
      linear-gradient(to top, color-mix(in srgb, var(--ff-text) 55%, transparent), transparent 30%);
  }
  .ff-hud__row[data-out="true"] {
    opacity: 0.45;
  }
  .ff-hud__lap-banner {
    position: absolute;
    inset-inline: 0;
    top: 30%;
    margin: 0;
    text-align: center;
    pointer-events: none;
    font: 600 round(down, clamp(40px, 11vmin, 96px), var(--ff-type-hint)) / 1 var(--ff-font-ui);
    color: var(--ff-text);
    text-shadow: 0 3px 0 var(--ff-panel-border);
    animation: ff-lap-banner-in 240ms steps(8) both;
  }
  /* The out word and its reason, one box (audit S3 keeps both silent). The
     word keeps its look; it only stops being absolutely placed on its own. */
  .ff-hud__out {
    position: absolute;
    inset-inline: 0;
    top: 30%;
    display: grid;
    justify-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .ff-hud__out > .ff-hud__lap-banner {
    position: static;
    inset-inline: auto;
  }
  .ff-hud__out-line {
    margin: 0;
    max-width: min(32rem, calc(100% - 32px));
    text-align: center;
    text-wrap: balance;
    font: 600 round(down, clamp(14px, 3vmin, 22px), var(--ff-type-hint)) / 1.25 var(--ff-font-ui);
    color: var(--ff-text);
    text-shadow: 0 2px 0 var(--ff-panel-border);
  }
  /* Large words over the racer until her first input. Whole words wrap (CJK
     between characters), the type never drops under 24 px, and the top is
     set low (30%, and at least 112 px) and under whatever hangs below the
     metric row (the coach, a hint), measured in `--ff-hud-under`. */
  :global(.ff-hud__start-prompt) {
    position: absolute;
    /* On the glass panel, under the racer rather than across her: the camera
       holds her a little above the middle, and at 30% the words ran over her
       name tag (review R18). Below her, over the city, they cover no one. */
    left: 50%;
    translate: -50% 0;
    top: max(62%, calc(var(--ff-hud-under, 0px) + 12px));
    width: max-content;
    max-width: calc(100% - 32px);
    box-sizing: border-box;
    margin: 0;
    padding: 8px 16px;
    text-align: center;
    text-wrap: balance;
    pointer-events: none;
    font: 600 round(down, clamp(20px, 5vmin, 36px), var(--ff-type-hint)) / 1.1 var(--ff-font-ui);
    animation: ff-lap-banner-in 240ms steps(8) both;
  }
  /* Under a dialog (the pause menu) the start words step aside, so none show around its edges
     or under its top (review R16). */
  :global(body:has(.ff-modal)) :global(.ff-hud__start-prompt) {
    visibility: hidden;
  }
  .ff-hud__row-lap {
    font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui);
  }
  /* 600 ms: LAP_PULSE_MS in hud-model.ts ends the pulse as the keyframes do. */
  [data-pulse="true"] .ff-hud__row-lap {
    animation: ff-lap-pulse 600ms steps(6) both;
  }
  /* A CPU's mood word (CPU banding spec §4): out to the left of its row, or
     beside its row, positioned so nothing in the standings moves. */
  /* Left of its row, clear of the panel's edge: the panel never covers it. */
  .ff-hud__bark {
    position: absolute;
    right: calc(100% + var(--ff-roster-pad, 0px) + 8px);
    top: 50%;
    translate: 0 -50%;
    font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui);
    white-space: nowrap;
    pointer-events: none;
    paint-order: stroke;
    -webkit-text-stroke: 3px var(--ff-aq-white);
    animation: ff-bark-pop 1400ms steps(8) both;
  }
  /* On a phone upright: under the standings line, so the line never moves. */
  .ff-hud__bark--line {
    right: auto;
    left: 50%;
    top: calc(100% + 4px);
    translate: -50% 0;
  }
  @keyframes ff-bark-pop {
    0% { opacity: 0; scale: 0.6; }
    10% { opacity: 1; scale: 1.25; }
    20%, 75% { opacity: 1; scale: 1; }
    100% { opacity: 0; scale: 1; }
  }
  @keyframes ff-lap-banner-in {
    from { opacity: 0; transform: translateY(-16px); }
  }
  @keyframes ff-lap-pulse {
    0%, 100% { transform: scale(1); }
    40% { transform: scale(1.35); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ff-hud__bark {
      animation: none;
    }
    .ff-hud__lap-banner,
    :global(.ff-hud__start-prompt),
    [data-pulse="true"] .ff-hud__row-lap {
      animation: none;
    }
  }

  /* The replay's mark, beside the clock: small capitals, set by CSS
     (docs/copy-style.md), in the action blue so it reads as a state. */
  .ff-hud__replay {
    font: 600 var(--ff-type-hint) / 1 var(--ff-font-ui);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ff-text);
  }
</style>
