/**
 * The replay's bar (race-options spec §7.3), mounted over the race's own HUD.
 *
 * The screen owns the run; this owns the bar and its keys. Every action is
 * one call back to the screen, so the keyboard, the controller (which walks
 * the bar's buttons, as on every menu, and nudges the position bar a second a
 * step) and touch all do the same thing. After 2.5 s without input the bar
 * steps aside (`replay-idle.ts`); paused, scrubbed or on the end card it stays.
 */

import { mount, unmount } from "svelte";
import type { StagePort } from "../render/stage-port";
import ReplayControls from "./ReplayControls.svelte";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { REPLAY_HINT_MS, REPLAY_IDLE_MS, createIdleTimer, replayHintText, type IdleTimer } from "./replay-idle";
import { inputMethod } from "../platform/input-method.svelte";

export type ReplaySpeed = 0.5 | 1 | 2;

export type ReplayControlsState = {
  /** Seconds of race from GO to what is shown, or to where a seek is going. */
  positionS: number;
  /** Seconds of race from GO to the finish. */
  lengthS: number;
  paused: boolean;
  speed: ReplaySpeed;
  /** The followed racer's name. */
  following: string;
  /** The followed racer's chosen colour, for the name pill's dot (select spec §6.7). */
  followingColour: SeatColour;
  /** Holding on the last frame: Watch again and Back to results replace the bar. */
  held: boolean;
  /** The race's standings by name, on the end card; empty before it. */
  standings: readonly string[];
};

export type ReplayControlsActions = {
  onPlayPause(): void;
  onSpeed(): void;
  onRestart(): void;
  onFollow(step: -1 | 1): void;
  onExit(): void;
  onWatchAgain(): void;
  onBack(): void;
  /** The bar was moved to this many seconds from GO. */
  onSeek(seconds: number): void;
  /** A finger or the mouse went down on the bar (true) or let go (false). */
  onScrub(active: boolean): void;
};

/** Whether focus on `target` draws its ring; where the selector is unknown, assume it does. */
function focusShows(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Whether this visit has said how to bring the bar back; one for the page. */
const visitHint = { shown: false };

/** The speed after `speed`: 1 → 2 → 0.5 → 1. */
export const nextSpeed = (speed: ReplaySpeed): ReplaySpeed => (speed === 1 ? 2 : speed === 2 ? 0.5 : 1);

/** Keys the bar answers, and what each does (spec §7.3). */
const KEYS: Record<string, (actions: ReplayControlsActions) => void> = {
  " ": (actions) => actions.onPlayPause(),
  ArrowLeft: (actions) => actions.onFollow(-1),
  ArrowRight: (actions) => actions.onFollow(1),
  s: (actions) => actions.onSpeed(),
  S: (actions) => actions.onSpeed(),
  r: (actions) => actions.onRestart(),
  R: (actions) => actions.onRestart(),
  Escape: (actions) => actions.onExit(),
};

/** Keys the focused position bar keeps for itself: they move it. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export class ReplayControlsView {
  private state = $state<ReplayControlsState>({
    positionS: 0,
    lengthS: 0,
    paused: false,
    speed: 1,
    following: "",
    followingColour: "scarlet",
    held: false,
    standings: [],
  });
  private drift = $state<string | undefined>(undefined);
  private roomMoved = $state(false);
  private idle = $state(false);
  private hint = $state<string | undefined>(undefined);
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private scrubbing = false;
  private focusInside = false;
  private readonly timer: IdleTimer;
  private readonly app: Record<string, unknown>;
  private readonly onKey: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private readonly onInput: () => void;
  private readonly onFocus: (event: FocusEvent) => void;

  constructor(
    stage: StagePort,
    actions: ReplayControlsActions,
    private readonly visit: { shown: boolean } = visitHint,
  ) {
    const view = this;
    this.timer = createIdleTimer(REPLAY_IDLE_MS, (idle) => {
      view.idle = idle;
      if (idle) view.sayHint();
      else view.dropHint();
    });
    // A finger on the position bar holds the bar in view as well as the race.
    const held: ReplayControlsActions = {
      ...actions,
      onScrub: (active) => {
        view.scrubbing = active;
        view.syncHold();
        actions.onScrub(active);
      },
    };
    this.app = mount(ReplayControls, {
      target: stage.overlay,
      props: {
        get state() {
          return view.state;
        },
        get drift() {
          return view.drift;
        },
        get roomMoved() {
          return view.roomMoved;
        },
        get idle() {
          return view.idle;
        },
        get hint() {
          return view.hint;
        },
        actions: held,
      },
    });

    // Any input shows the bar again (ui layout spec §4.5).
    this.onInput = () => view.timer.poke();
    for (const type of ["pointermove", "pointerdown", "wheel"]) window.addEventListener(type, this.onInput);

    // One listener for the bar's keys, in the capture phase on `window`, so
    // it runs ahead of the page's own arrow walk (`main.ts`), which would
    // otherwise take ← and → for focus first (audit remediation B8). The
    // replay's keys win whatever has focus (D-R3): Space plays and pauses
    // rather than pressing a focused button, and the arrows follow a racer.
    // Enter -- and the controller's A, which clicks -- presses the button. A
    // key taken here goes no further. The position bar keeps the keys that
    // move it. Any key also wakes the bar (ui layout spec §4.5).
    this.onKey = (event: KeyboardEvent): void => {
      view.timer.poke();
      // A chord (Cmd/Ctrl+R to reload) is the browser's, not the replay's.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "range") {
        if (SLIDER_KEYS.has(event.key)) return;
      } else if (target instanceof Element && target.closest("input, select, textarea") !== null) return;
      const run = KEYS[event.key];
      if (run === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      run(held);
    };
    // A browser presses a focused button on Space's keyup; the keydown above
    // already played or paused, so the keyup must not press it as well.
    this.onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== " ") return;
      const target = event.target;
      if (target instanceof Element && target.closest("button") !== null) event.preventDefault();
    };
    window.addEventListener("keydown", this.onKey, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    // Keyboard or controller focus inside the bar is use, like a held finger:
    // it stays (§4.5). Only focus that shows its ring (`:focus-visible`): a
    // tap or click focuses the button it pressed too, and that must not hold
    // the bar over the race. The pad focuses with `focusVisible`, so it holds.
    this.onFocus = (event: FocusEvent): void => {
      const target = event.target;
      view.focusInside =
        event.type === "focusin" &&
        target instanceof Element &&
        target.closest('[data-testid="replay-controls"]') !== null &&
        focusShows(target);
      view.timer.poke();
      view.syncHold();
    };
    window.addEventListener("focusin", this.onFocus);
    window.addEventListener("focusout", this.onFocus);
  }

  /** The first time the bar steps aside in a visit, say how to bring it back. */
  private sayHint(): void {
    if (this.visit.shown) return;
    this.visit.shown = true;
    this.hint = replayHintText(inputMethod.method);
    this.hintTimer = setTimeout(() => this.dropHint(), REPLAY_HINT_MS);
  }

  private dropHint(): void {
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
    this.hint = undefined;
  }

  /** Paused, scrubbed or on the end card: the bar is in use, so it stays. */
  private syncHold(): void {
    this.timer.hold(this.state.paused || this.state.held || this.scrubbing || this.focusInside);
  }

  update(state: ReplayControlsState): void {
    const current = this.state;
    if (
      current.positionS === state.positionS &&
      current.lengthS === state.lengthS &&
      current.paused === state.paused &&
      current.speed === state.speed &&
      current.following === state.following &&
      current.followingColour === state.followingColour &&
      current.held === state.held &&
      current.standings.join("|") === state.standings.join("|")
    ) {
      return;
    }
    this.state = state;
    this.syncHold();
  }

  /** A notice shown once; a second call with any text is ignored. */
  notice(text: string): void {
    if (this.drift === undefined) this.drift = text;
  }

  setRoomMoved(moved: boolean): void {
    this.roomMoved = moved;
  }

  destroy(): void {
    this.timer.dispose();
    this.dropHint();
    window.removeEventListener("keydown", this.onKey, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("focusin", this.onFocus);
    window.removeEventListener("focusout", this.onFocus);
    for (const type of ["pointermove", "pointerdown", "wheel"]) window.removeEventListener(type, this.onInput);
    void unmount(this.app);
  }
}
