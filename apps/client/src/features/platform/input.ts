/**
 * Input aggregation.
 *
 * Keyboard, controller and touch all feed this one manager, and it emits
 * only `HeldInput` fields: intent and a sequence. The race stamps each with
 * the tick it takes effect on when it samples it. Nothing downstream can tell
 * which device produced a frame, which is what keeps the control schemes from
 * drifting apart. Only the bookkeeping here keeps the devices apart
 * (launch polish §3.1.3, "Per-source intent").
 */

import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { DisposeBag } from "../../lib/dispose";

export type InputAction = "left" | "right" | "fastFall" | "reset";

/**
 * What the player is holding at one instant, with no sequence and no tick.
 *
 * The race numbers and stamps it when it samples it for a tick; until then it
 * is only intent.
 */
export type InputIntent = { left: boolean; right: boolean; fastFall: boolean; reset: boolean };

/** Keys bound to each action. Both the letter keys and the arrows are live. */
const KEY_BINDINGS: Record<string, InputAction> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyS: "fastFall",
  ArrowDown: "fastFall",
  KeyR: "reset",
};

export type InputListener = (frame: HeldInput) => void;

/** Keys that are the pause menu's and the browser's, never a start press. */
const NOT_A_START_KEY: ReadonlySet<string> = new Set(["Escape", "Tab"]);

/** The devices that can hold an action. */
export type InputSource = "keyboard" | "gamepad" | "touch";
const SOURCES: readonly InputSource[] = ["keyboard", "gamepad", "touch"];

export class InputManager {
  /**
   * What each device holds, kept apart.
   *
   * One shared set let a keyup on the keyboard release a direction the
   * controller was still holding. The race sees the union, so it still cannot
   * tell devices apart -- only the bookkeeping can.
   */
  private readonly held: Record<InputSource, Set<InputAction>> = {
    keyboard: new Set(),
    gamepad: new Set(),
    touch: new Set(),
  };
  private readonly listeners = new Set<InputListener>();
  /** Who wants to know the player pressed something the game does not bind; see `onAnyPress`. */
  private readonly pressListeners = new Set<(source: InputSource) => void>();
  private readonly bag = new DisposeBag();
  private sequence = 0;
  private attached = false;
  /**
   * Presses not yet sampled by the race: reset always, and fast-fall too.
   *
   * The press and the release can both land between two ticks -- a tap or a
   * flick is shorter than a frame -- so the press is latched here until
   * `sample` hands it to exactly one tick. Reading `frame` instead would miss
   * it, which is how a manual reset went unpredicted and arrived a round trip
   * late.
   */
  private readonly latched = new Set<"reset" | "fastFall">();
  /** Whether a pause overlay is open; see `setSuspended`. */
  private suspended = false;

  /** The frame most recently emitted, for a view that renders local intent. */
  private current: HeldInput = {
    sequence: 0,
    left: false,
    right: false,
    fastFall: false,
    reset: false,
  };

  get frame(): HeldInput {
    return this.current;
  }

  /** Begins listening to the keyboard. Touch controls call `set` directly. */
  attach(target: EventTarget = window): void {
    if (this.attached) return;
    this.attached = true;

    this.bag.addListener(target, "keydown", (event) => {
      const key = event as KeyboardEvent;
      const action = KEY_BINDINGS[key.code];
      if (action === undefined) {
        // A key no action uses is still a press, which a race that waits for
        // the player's first input may take as one (a chord, a repeat, Escape
        // and Tab are the browser's and the pause menu's, not hers).
        if (!key.repeat && !key.ctrlKey && !key.metaKey && !key.altKey && !NOT_A_START_KEY.has(key.key)) this.notePress("keyboard");
        return;
      }
      // A held key repeats; only the first press changes state.
      if (key.repeat) return;
      event.preventDefault();
      this.set(action, true, "keyboard");
    });

    this.bag.addListener(target, "keyup", (event) => {
      const action = KEY_BINDINGS[(event as KeyboardEvent).code];
      if (action === undefined) return;
      event.preventDefault();
      this.set(action, false, "keyboard");
    });

    // A window that loses focus mid-press would otherwise leave the key held
    // forever, because the matching keyup goes to whatever took focus. Only
    // the keyboard: a controller keeps what it physically holds, and its next
    // poll re-asserts it.
    this.bag.addListener(window, "blur", () => this.releaseSource("keyboard"));
  }

  /**
   * Sets one action's state for one device.
   *
   * Emits only when the union changes, so a held key, a stationary thumb or a
   * second device pressing what the first already holds does not fill the
   * input budget the server allots.
   */
  set(action: InputAction, active: boolean, source: InputSource): void {
    // A release still goes through, so nothing stays latched on.
    if (this.suspended && active) return;
    const before = this.isHeld(action);
    const set = this.held[source];
    if (active === set.has(action)) return;
    if (active) set.add(action);
    else set.delete(action);
    if (active && (action === "reset" || action === "fastFall")) this.latched.add(action);
    if (this.isHeld(action) !== before) this.emit();
  }

  /**
   * Hears each deliberate press the game binds to nothing: a key with no
   * action, any controller button but Start, and whatever a screen reports
   * with `notePress`. Reports it and sends no frame of its own, so the race
   * decides what a press means (the first-race start pulse is one use).
   */
  onAnyPress(listener: (source: InputSource) => void): () => void {
    this.pressListeners.add(listener);
    return () => this.pressListeners.delete(listener);
  }

  /** One such press, from one device. Nothing while a pause overlay is open. */
  notePress(source: InputSource): void {
    if (this.suspended) return;
    for (const listener of [...this.pressListeners]) listener(source);
  }

  /**
   * The intent for one tick, consuming the latched presses.
   *
   * Called by the race once per tick it samples. The directions are whatever
   * is held now. Reset is true on the first sample after a press and on no
   * other, so one press is one respawn however many ticks a frame covers;
   * fast-fall is held or pressed since the last sample, so a tap still lands.
   */
  sample(): InputIntent {
    const intent = {
      left: this.isHeld("left"),
      right: this.isHeld("right"),
      fastFall: this.isHeld("fastFall") || this.latched.has("fastFall"),
      reset: this.latched.has("reset"),
    };
    this.latched.clear();
    return intent;
  }

  /** Releases everything one device holds, leaving the others' holds alone. */
  releaseSource(source: InputSource): void {
    const set = this.held[source];
    if (set.size === 0) return;
    const before = this.current;
    set.clear();
    if (
      this.isHeld("left") !== before.left ||
      this.isHeld("right") !== before.right ||
      this.isHeld("fastFall") !== before.fastFall
    ) {
      this.emit();
    }
  }

  /**
   * While a pause overlay is open: nothing steers, and nothing stays held.
   * The race goes on sampling, and a suspended manager samples as neutral.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.releaseAll();
  }

  /** Releases every device, as leaving a race does. */
  releaseAll(): void {
    for (const source of SOURCES) this.releaseSource(source);
  }

  subscribe(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private isHeld(action: InputAction): boolean {
    return this.held.keyboard.has(action) || this.held.gamepad.has(action) || this.held.touch.has(action);
  }

  private emit(): void {
    this.sequence += 1;
    this.current = {
      sequence: this.sequence,
      left: this.isHeld("left"),
      right: this.isHeld("right"),
      fastFall: this.isHeld("fastFall"),
      // Reset is an edge, not a state: it fires on the frame the key went down
      // and is cleared immediately so one press is one respawn.
      reset: this.isHeld("reset"),
    };

    const frame = this.current;
    for (const listener of [...this.listeners]) listener(frame);

    if (frame.reset) {
      for (const source of SOURCES) this.held[source].delete("reset");
      this.current = { ...frame, reset: false };
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.pressListeners.clear();
    for (const source of SOURCES) this.held[source].clear();
    this.latched.clear();
    this.bag.dispose();
    this.attached = false;
  }
}
