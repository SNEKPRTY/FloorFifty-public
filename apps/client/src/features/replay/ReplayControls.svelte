<script lang="ts">
  /**
   * The replay's bar (race-options spec §7.3; ui layout spec §4.5): one bar
   * inside the visible band. Play/Pause and the speed, the position bar, the
   * racer followed (◀ name ▶, the name taking the room left), then Restart and
   * Back to results. On a short screen, or a container too narrow for the
   * position bar inline, the position bar becomes a thin line along the bar's
   * top edge, so the bar stays one row. At the end, Watch again and Back to
   * results; the position bar stays, so the race can be dragged back into.
   *
   * It steps aside after 2.5 s without input (`replay-idle.ts`). Hidden, it
   * takes no pointer, so a tap reaches the window, which wakes it. The first
   * time it steps aside in a visit, a hint in its place says so. The word
   * "Replay" is the HUD's chip beside the timer, not this bar's.
   */
  import * as m from "../../paraglide/messages.js";
  import Icon from "../kit/Icon.svelte";
  import Chip from "../kit/Chip.svelte";
  import Button from "../kit/Button.svelte";
  import IconButton from "../kit/IconButton.svelte";
  import Toast from "../kit/Toast.svelte";
  import { rollDigits } from "../kit/motion";
  import ActionBar from "../kit/layout/ActionBar.svelte";
  import NamePill from "../kit/layout/NamePill.svelte";
  import type { BarAction } from "../kit/layout/action-bar";
  import type { ReplayControlsActions, ReplayControlsState } from "./replay-controls.svelte";

  /**
   * Publishes the panel's top edge as `--ff-replay-panel-top`, so the race
   * HUD's portrait pip strip opens above the bar however tall large text
   * makes it.
   */
  function publishTop(node: HTMLElement) {
    const panel = node.closest<HTMLElement>(".ff-replay__panel") ?? node;
    const root = document.documentElement;
    const set = (): void => root.style.setProperty("--ff-replay-panel-top", `${panel.getBoundingClientRect().top}px`);
    set();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(set);
    observer?.observe(panel);
    window.addEventListener("resize", set);
    return {
      destroy() {
        observer?.disconnect();
        window.removeEventListener("resize", set);
        root.style.removeProperty("--ff-replay-panel-top");
      },
    };
  }

  let {
    state,
    drift,
    roomMoved,
    idle = false,
    hint,
    actions,
  }: {
    state: ReplayControlsState;
    drift: string | undefined;
    roomMoved: boolean;
    idle?: boolean;
    /** How to bring the bar back, said once while it is aside. */
    hint?: string;
    actions: ReplayControlsActions;
  } = $props();

  const length = $derived(Math.max(1, Math.ceil(state.lengthS)));
  const clock = (seconds: number): string => {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };

  // Derived, so a label follows a language switch.
  const playing = $derived<BarAction[]>([
    { id: "restart", testId: "replay-restart", label: m.replay_restart(), kind: "utility", icon: restartIcon, onSelect: () => actions.onRestart() },
    { id: "exit", testId: "replay-exit", label: m.replay_back_to_results(), shortLabel: m.shell_back(), kind: "secondary", onSelect: () => actions.onExit() },
  ]);
  const ended = $derived<BarAction[]>([
    { id: "watch-again", testId: "replay-watch-again", label: m.replay_watch_again(), kind: "primary", tone: "plain", onSelect: () => actions.onWatchAgain() },
    { id: "back", testId: "replay-back", label: m.replay_back_to_results(), shortLabel: m.shell_back(), kind: "secondary", tone: "go", onSelect: () => actions.onBack() },
  ]);
</script>

{#snippet restartIcon()}<Icon name="restart" />{/snippet}

{#snippet track()}
  <input
    class="ff-replay__track"
    type="range"
    min="0"
    max={length}
    step="1"
    data-testid="replay-progress"
    aria-label={m.replay_position()}
    aria-valuetext="{clock(state.positionS)} of {clock(length)}"
    value={Math.min(length, Math.max(0, Math.round(state.positionS)))}
    oninput={(event) => actions.onSeek(Number(event.currentTarget.value))}
    onpointerdown={() => actions.onScrub(true)}
    onpointerup={() => actions.onScrub(false)}
    onpointercancel={() => actions.onScrub(false)}
    onlostpointercapture={() => actions.onScrub(false)}
  />
{/snippet}

<!-- Beside the bar, not in it: the bar is invisible while it is aside. It
     takes no pointer, so the tap it asks for reaches the window. -->
{#if hint !== undefined}
  <div class="ff-replay-hint">
    <Toast tone="menu" data-testid="replay-hint" class="ff-replay-hint__pill">{hint}</Toast>
  </div>
{/if}

<div
  class="ff-replay"
  data-testid="replay-controls"
  data-idle={String(idle)}
  data-standings={state.held ? state.standings.join("|") : undefined}
>
  {#if roomMoved}
    <p class="ff-aq-label ff-replay__line" data-testid="replay-room-moved">{m.replay_room_moved()}</p>
  {/if}
  {#if drift !== undefined}
    <p class="ff-aq-label ff-replay__line" data-testid="replay-drift" role="status">{drift}</p>
  {/if}

  <Chip class="ff-replay__panel">
    <div class="ff-replay__bar" use:publishTop>
      <!-- One position bar for the run and the end card: a press that leaves
           the end card lets go on the element it went down on, so the
           replay's hold is released (WebKit sends the pointerup nowhere else). -->
      <div class="ff-replay__track-slot">{@render track()}</div>
      {#if state.held}
        <div class="ff-replay__end"><ActionBar actions={ended} testId="replay-end-actions" /></div>
      {:else}
        <span class="ff-replay__toggles">
          <IconButton
            icon={state.paused ? "play" : "pause"}
            label={state.paused ? m.replay_play() : m.replay_pause()}
            class="ff-replay__icon"
            data-testid="replay-play"
            onclick={() => actions.onPlayPause()}
          />
          <!-- A number, so a change rolls its digit rather than swapping the text. -->
          <Button
            class="ff-replay__icon"
            data-testid="replay-speed"
            aria-label={m.replay_speed({ speed: state.speed })}
            onclick={() => actions.onSpeed()}
          >
            <span use:rollDigits={`${state.speed}×`}></span>
          </Button>
        </span>
        <span class="ff-replay__follow">
          <IconButton icon="previous" label={m.replay_previous_racer()} class="ff-replay__icon" data-testid="replay-follow-prev" onclick={() => actions.onFollow(-1)} />
          <NamePill name={state.following} colour={state.followingColour} self testId="replay-follow-name" />
          <IconButton icon="next" label={m.replay_next_racer()} class="ff-replay__icon" data-testid="replay-follow-next" onclick={() => actions.onFollow(1)} />
        </span>
        <ActionBar actions={playing} testId="replay-actions" />
      {/if}
    </div>
  </Chip>
</div>

<style>
  /* Inside the visible band (ui layout spec §4.1), at its foot: the bar never
     lands on the letterbox's bars. */
  .ff-replay {
    position: fixed;
    inset-inline: 0;
    top: var(--ff-band-top);
    height: var(--ff-band-height);
    /* The race HUD's layer: over the drawn race, under a modal. */
    z-index: 3;
    display: grid;
    align-content: end;
    justify-items: center;
    gap: 8px;
    padding-inline: max(var(--ff-gutter), env(safe-area-inset-left), var(--ff-host-reserved-left, 0px)) max(var(--ff-gutter), env(safe-area-inset-right), var(--ff-host-reserved-right, 0px));
    padding-bottom: max(8px, env(safe-area-inset-bottom));
    pointer-events: none;
    transition: opacity 200ms ease-out;
  }

  /* The hint sits where the bar was, at the band's foot, and is never a target. */
  .ff-replay-hint {
    position: fixed;
    inset-inline: 0;
    top: var(--ff-band-top);
    height: var(--ff-band-height);
    z-index: 3;
    display: grid;
    align-content: end;
    justify-items: center;
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    pointer-events: none;
  }
  .ff-replay-hint :global(.ff-replay-hint__pill) {
    margin: 0;
    padding: 8px 14px;
    font-size: var(--ff-type-hint);
    white-space: nowrap;
  }

  /* Stepped aside: invisible and out of the pointer's way. */
  .ff-replay[data-idle="true"] {
    opacity: 0;
  }
  .ff-replay[data-idle="true"] :global(*) {
    pointer-events: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .ff-replay {
      transition: none;
    }
  }

  .ff-replay :global(.ff-replay__panel) {
    pointer-events: auto;
    container: replay-bar / inline-size;
    position: relative;
    width: min(100%, 960px);
    padding: 8px 12px;
  }

  .ff-replay__line {
    margin: 0;
    pointer-events: auto;
  }

  /* One row: toggles, the position bar, the follow (taking the room left),
     the actions. */
  .ff-replay__bar {
    display: grid;
    grid-template-columns: auto minmax(120px, 0.5fr) minmax(0, 1fr) auto;
    grid-template-areas: "toggles track follow actions";
    align-items: center;
    gap: 8px;
  }
  .ff-replay__toggles {
    grid-area: toggles;
  }
  .ff-replay__track-slot {
    grid-area: track;
  }
  .ff-replay__follow {
    grid-area: follow;
  }
  .ff-replay__bar > :global(.ff-action-bar) {
    grid-area: actions;
  }
  .ff-replay__end {
    grid-area: end;
  }
  /* The end bar's two buttons fill it. */
  .ff-replay__end :global(.ff-action-bar) {
    inline-size: 100%;
  }

  .ff-replay__toggles,
  .ff-replay__follow {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .ff-replay__follow :global([data-testid="replay-follow-name"]) {
    flex: 1;
    min-width: 0;
    justify-content: center;
  }

  .ff-replay :global(.ff-replay__icon) {
    /* IconButton's own 44 px floor would shrink these under the 48 px bar buttons. */
    min-height: var(--ff-aq-control-height);
    min-width: var(--ff-aq-target);
    padding-inline: 8px;
  }

  .ff-replay__track {
    width: 100%;
    /* The thumb is the drag target: the row is 44 px tall for a finger. */
    min-height: 44px;
    margin: 0;
    accent-color: var(--ff-plain);
    touch-action: none;
  }

  /* The end card: the position bar, then Watch again and Back to results. */
  .ff-replay__bar:has(.ff-replay__end) {
    grid-template-columns: minmax(120px, 1fr) auto;
    grid-template-areas: "track end";
  }

  /* Too narrow for the position bar inline, or a short screen: the position
     bar is a thin line along the bar's top edge, and the row keeps the rest. */
  @container replay-bar (max-width: 639px) {
    .ff-replay__bar {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: "toggles follow actions";
      padding-top: 14px;
    }
    .ff-replay__track-slot {
      position: absolute;
      inset-inline: 12px;
      top: -14px;
    }
    .ff-replay__bar:has(.ff-replay__end) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "end";
      justify-items: end;
    }
  }
  :global([data-height]) .ff-replay__bar {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "toggles follow actions";
    padding-top: 14px;
  }
  :global([data-height]) .ff-replay__track-slot {
    position: absolute;
    inset-inline: 12px;
    top: -14px;
  }
  /* The thin line keeps a finger-high box, which lies under the row below and
     reaches above the panel. The row's controls stack over it, so a press on
     Pause's edge pauses rather than seeks, and the box is clipped at the
     panel's edge, so it takes no press meant for the HUD above. The line and
     its thumb are drawn inside the panel. */
  .ff-replay__toggles,
  .ff-replay__follow,
  .ff-replay__bar > :global(.ff-action-bar) {
    position: relative;
    z-index: 1;
  }
  @container replay-bar (max-width: 639px) {
    .ff-replay__track-slot {
      clip-path: inset(14px 0 0 0);
    }
  }
  :global([data-height]) .ff-replay__track-slot {
    clip-path: inset(14px 0 0 0);
  }
  :global([data-height]) .ff-replay__bar:has(.ff-replay__end) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "end";
    justify-items: end;
  }

  /* The end card on a short screen (a phone held sideways): the position bar and the two
     buttons share one slim row, not a tall, mostly empty bar over the racers (review R23). */
  :global([data-height]) .ff-replay__bar:has(.ff-replay__end) {
    grid-template-columns: minmax(120px, 1fr) auto;
    grid-template-areas: "track end";
    justify-items: stretch;
    padding-top: 0;
  }
  :global([data-height]) .ff-replay__bar:has(.ff-replay__end) .ff-replay__track-slot {
    position: static;
    clip-path: none;
  }

  /* A phone held upright: seven controls cannot share one row, so Restart
     and Back to results take a second row the bar's full width, and the
     position bar is the thin line along the top. */
  @container replay-bar (max-width: 519px) {
    /* A short screen's one-row rule above is the more specific: restated for
       it, or a phone-wide bar on a short screen crushed seven controls into
       one row, over one another. */
    .ff-replay__bar,
    :global([data-height]) .ff-replay__bar {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: "toggles follow" "actions actions";
    }
    /* The end card: the position bar a thin line along the top, and the two buttons the bar's
       full width, so neither runs off the screen's edge ("e nuevo", review R22). */
    .ff-replay__bar:has(.ff-replay__end),
    :global([data-height]) .ff-replay__bar:has(.ff-replay__end) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "end";
      justify-items: stretch;
      padding-top: 14px;
    }
    .ff-replay__bar:has(.ff-replay__end) .ff-replay__track-slot,
    :global([data-height]) .ff-replay__bar:has(.ff-replay__end) .ff-replay__track-slot {
      position: absolute;
      clip-path: inset(14px 0 0 0);
    }
    .ff-replay__end {
      min-width: 0;
    }
  }
</style>
