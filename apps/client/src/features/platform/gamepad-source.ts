/**
 * The controller (spec §3.1.3).
 *
 * Polled once per rendered frame, ahead of the race's draw, so a press reaches
 * the same frame's sample. In a race it feeds the race's `InputManager` as its
 * own source; Start still reaches the page, because Start is pause, and A
 * fast-falls alongside the trigger and a downward push. Out of a race every
 * button is menu navigation.
 */

import type { InputManager } from "./input";

export type PadLike = {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { pressed: boolean; value: number }[];
};

export type GamepadNav = "up" | "down" | "left" | "right" | "confirm" | "back" | "start";

/**
 * The four shoulder buttons in the order they sit left to right on the pad --
 * left trigger, left bumper, right bumper, right trigger -- which is the order
 * the menu's racers stand in, so each is one racer's jump. None of them walks
 * the menus, so a jump never also presses what has focus.
 */
export const HOP_BUTTONS = [6, 4, 5, 7] as const;

export const DEADZONE = 0.25;
/** A stick must lean this far down to fast-fall, so a diagonal steer does not. */
const FAST_FALL_AXIS = 0.5;
const TRIGGER_PRESSED = 0.5;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

/** Standard-mapping button indices (W3C Gamepad, "standard" layout). */
const B = { south: 0, east: 1, rightTrigger: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

const pressed = (pad: PadLike, index: number): boolean => pad.buttons[index]?.pressed === true;

/**
 * One pad's state as race intents and menu edges.
 *
 * The deadzone is radial, so a stick resting slightly off-centre on both axes
 * never steers. Fast-fall wants a clear downward lean, so a diagonal steer
 * does not also drop the racer.
 */
export function readPad(pad: PadLike): {
  left: boolean;
  right: boolean;
  fastFall: boolean;
  reset: boolean;
  nav: ReadonlySet<GamepadNav>;
  /** Each shoulder button, in `HOP_BUTTONS` order. */
  hops: readonly boolean[];
} {
  const rawX = pad.axes[0] ?? 0;
  const rawY = pad.axes[1] ?? 0;
  const outside = Math.hypot(rawX, rawY) >= DEADZONE;
  const x = outside ? rawX : 0;
  const y = outside ? rawY : 0;

  const left = pressed(pad, B.left) || x <= -DEADZONE;
  const right = pressed(pad, B.right) || x >= DEADZONE;
  // A as well: players reach for the bottom face button as they would for
  // jump, and fast fall is the one action a race has besides steering.
  const fastFall =
    pressed(pad, B.down) ||
    pressed(pad, B.south) ||
    y >= FAST_FALL_AXIS ||
    (pad.buttons[B.rightTrigger]?.value ?? 0) >= TRIGGER_PRESSED;
  const reset = pressed(pad, B.select);

  // The stick navigates along its stronger axis only, at the same deadzone
  // in every direction, so a diagonal push is one step rather than two and
  // the stick walks a menu exactly as the d-pad does. Race intents above are
  // untouched: steering and fast-fall keep their own thresholds.
  const vertical = Math.abs(y) > Math.abs(x);
  const nav = new Set<GamepadNav>();
  if (pressed(pad, B.up) || (vertical && y < 0)) nav.add("up");
  if (pressed(pad, B.down) || (vertical && y > 0)) nav.add("down");
  if (pressed(pad, B.left) || (!vertical && x < 0)) nav.add("left");
  if (pressed(pad, B.right) || (!vertical && x > 0)) nav.add("right");
  if (pressed(pad, B.south)) nav.add("confirm");
  if (pressed(pad, B.east)) nav.add("back");
  if (pressed(pad, B.start)) nav.add("start");
  const hops = HOP_BUTTONS.map((button) => pressed(pad, button));
  return { left, right, fastFall, reset, nav: nav as ReadonlySet<GamepadNav>, hops };
}

const DIRECTIONS: ReadonlySet<GamepadNav> = new Set(["up", "down", "left", "right"]);

/**
 * What a pad held when it changed hands, kept from acting until let go.
 *
 * The pad moves between a race and the menus on Play, pause, Resume and the
 * race's end, and the press that caused the move is usually still down: A on
 * Resume would fast-fall the first ticks back, and a stick held as pause
 * opened would walk the pause menu. Each held button and stick direction is
 * masked on its own, so a held A never blocks a fresh lean of the stick.
 */
export class HandoverMask {
  private index: number | undefined;
  private readonly buttons = new Set<number>();
  /** Axis index and sign, as `"1+"`: a stick direction beyond the deadzone. */
  private readonly axes = new Set<string>();

  capture(pad: PadLike): void {
    this.clear();
    this.index = pad.index;
    pad.buttons.forEach((button, index) => {
      if (button.pressed || button.value >= TRIGGER_PRESSED) this.buttons.add(index);
    });
    pad.axes.forEach((value, index) => {
      if (value >= DEADZONE) this.axes.add(`${index}+`);
      if (value <= -DEADZONE) this.axes.add(`${index}-`);
    });
  }

  clear(): void {
    this.index = undefined;
    this.buttons.clear();
    this.axes.clear();
  }

  /** The pad with masked inputs read as released; forgets whatever was let go. */
  apply(pad: PadLike): PadLike {
    if (this.index !== pad.index) {
      this.clear();
      return pad;
    }
    for (const index of [...this.buttons]) {
      const button = pad.buttons[index];
      if (button === undefined || (!button.pressed && button.value < TRIGGER_PRESSED)) this.buttons.delete(index);
    }
    for (const key of [...this.axes]) {
      const value = pad.axes[Number(key.slice(0, -1))] ?? 0;
      const held = key.endsWith("+") ? value >= DEADZONE : value <= -DEADZONE;
      if (!held) this.axes.delete(key);
    }
    if (this.buttons.size === 0 && this.axes.size === 0) return pad;
    return {
      ...pad,
      buttons: pad.buttons.map((button, index) => (this.buttons.has(index) ? { pressed: false, value: 0 } : button)),
      axes: pad.axes.map((value, index) => (this.axes.has(`${index}+`) || this.axes.has(`${index}-`) ? 0 : value)),
    };
  }
}

export class GamepadSource {
  private target: InputManager | undefined;
  private activeIndex: number | undefined;
  /** Whether any pad was pressed on the last poll, so a new press is an edge. */
  private wasBusy = false;
  private readonly heldNav = new Map<GamepadNav, { since: number; lastFired: number }>();
  /** The shoulder buttons held on the last poll, so a press is reported once. */
  private heldHops: readonly boolean[] = [];
  /** The buttons held on the last poll as the race sees them (masked), so a new one is an edge. */
  private heldButtons = new Set<number>();
  private readonly mask = new HandoverMask();
  /** The active pad as last read, which a handover masks. */
  private lastPad: PadLike | undefined;
  /** Counts handovers, so a poll stops acting on a reading a handover made stale. */
  private handovers = 0;
  private readonly getGamepads: () => readonly (PadLike | null)[];

  constructor(
    private readonly options: {
      getGamepads?: () => readonly (PadLike | null)[];
      onNav?: (nav: GamepadNav) => void;
      /** A shoulder button pressed out of a race, by its place in `HOP_BUTTONS`. */
      onHop?: (slot: number) => void;
      onActive?: (pad: PadLike) => void;
      /** The pad changed hands: to a race's input, or back to the menus. */
      onHandover?: (to: "race" | "menu") => void;
    } = {},
  ) {
    this.getGamepads =
      options.getGamepads ?? (() => (navigator.getGamepads?.() ?? []) as readonly (PadLike | null)[]);
  }

  /** Whether a race's input holds the pad; otherwise it walks the menus. */
  get racing(): boolean {
    return this.target !== undefined;
  }

  /**
   * Hands the pad to a race's input, or back to the menus with `undefined`.
   * Whatever the pad held in the old race is released there first, and
   * whatever it still holds is masked on the new side until let go.
   */
  setRaceTarget(input: InputManager | undefined): void {
    if (this.target === input) return;
    this.target?.releaseSource("gamepad");
    this.target = input;
    this.heldNav.clear();
    this.handovers += 1;
    if (this.lastPad === undefined) this.mask.clear();
    else this.mask.capture(this.lastPad);
    this.options.onHandover?.(input === undefined ? "menu" : "race");
  }

  /** Reads every pad once; called once per rendered frame. */
  poll(nowMs: number): void {
    const pads = this.getGamepads().filter((pad): pad is PadLike => pad !== null && pad.connected);
    const read = pads.map((pad) => ({ pad, state: readPad(pad) }));

    // The most recently active pad drives; a second pad at rest never
    // releases what the first is holding. Every new press is reported, not
    // only a change of pad: a key pressed in between moves the app's input
    // method away, and a single pad must be able to take it back.
    const busy = read.find(
      (entry) =>
        entry.state.nav.size > 0 ||
        entry.state.fastFall ||
        entry.state.reset ||
        entry.state.hops.some(Boolean) ||
        // A button the game maps to nothing is still a press: it can start a waiting racer.
        entry.pad.buttons.some((button) => button.pressed || button.value >= TRIGGER_PRESSED),
    );
    if (busy !== undefined && (!this.wasBusy || busy.pad.index !== this.activeIndex)) {
      this.activeIndex = busy.pad.index;
      this.options.onActive?.(busy.pad);
    }
    this.wasBusy = busy !== undefined;
    const active = read.find((entry) => entry.pad.index === this.activeIndex);

    if (active === undefined) {
      this.lastPad = undefined;
      this.mask.clear();
      this.target?.releaseSource("gamepad");
      this.heldNav.clear();
      this.heldHops = [];
      this.heldButtons.clear();
      return;
    }

    // `read` stays raw, so a masked press still marks its pad active; what
    // the pad does is read through the mask.
    this.lastPad = active.pad;
    const seen = this.mask.apply(active.pad);
    const state = readPad(seen);
    this.noteButtons(seen);
    if (this.target !== undefined) {
      this.target.set("left", state.left, "gamepad");
      this.target.set("right", state.right, "gamepad");
      this.target.set("fastFall", state.fastFall, "gamepad");
      this.target.set("reset", state.reset, "gamepad");
    }
    this.fireNav(state.nav, nowMs);
    this.fireHops(state.hops);
  }

  /**
   * Tells the race's input about each button that has just gone down, the ones
   * no action uses too, so any button can start a racer who is waiting for a
   * first input. Start is the pause button and is not one. A button held across
   * a handover is masked out of `pad`, so it is not new when the race has the pad.
   */
  private noteButtons(pad: PadLike): void {
    const down = new Set<number>();
    pad.buttons.forEach((button, index) => {
      if (index !== B.start && (button.pressed || button.value >= TRIGGER_PRESSED)) down.add(index);
    });
    const fresh = [...down].some((index) => !this.heldButtons.has(index));
    this.heldButtons = down;
    if (fresh) this.target?.notePress("gamepad");
  }

  /** Out of a race, each new shoulder press; never repeated while held. */
  private fireHops(current: readonly boolean[]): void {
    const previous = this.heldHops;
    this.heldHops = current;
    if (this.target !== undefined) return;
    current.forEach((down, slot) => {
      if (down && previous[slot] !== true) this.options.onHop?.(slot);
    });
  }

  private fireNav(current: ReadonlySet<GamepadNav>, nowMs: number): void {
    for (const nav of [...this.heldNav.keys()]) if (!current.has(nav)) this.heldNav.delete(nav);
    const handovers = this.handovers;
    for (const nav of current) {
      // A nav that handed the pad over (Start pausing) makes the rest of this
      // reading stale: it was taken for the other owner.
      if (this.handovers !== handovers) return;
      // In a race only Start leaves the pad: the rest is steering.
      if (this.target !== undefined && nav !== "start") continue;
      const held = this.heldNav.get(nav);
      if (held === undefined) {
        this.heldNav.set(nav, { since: nowMs, lastFired: nowMs });
        this.options.onNav?.(nav);
        continue;
      }
      // A held direction repeats, as a held key does: once after a delay, then
      // steadily. Buttons never repeat; one press is one confirm.
      if (!DIRECTIONS.has(nav)) continue;
      const due =
        held.lastFired === held.since
          ? nowMs - held.since >= REPEAT_DELAY_MS
          : nowMs - held.lastFired >= REPEAT_EVERY_MS;
      if (due) {
        held.lastFired = nowMs;
        this.options.onNav?.(nav);
      }
    }
  }

  /** Releases what an unplugged pad held; the next poll finds a new one. */
  attach(target: EventTarget = window): () => void {
    const onDisconnect = (event: Event): void => {
      const pad = (event as GamepadEvent).gamepad;
      if (pad?.index === this.activeIndex) {
        this.activeIndex = undefined;
        this.lastPad = undefined;
        this.mask.clear();
        this.target?.releaseSource("gamepad");
        this.heldNav.clear();
      }
    };
    target.addEventListener("gamepaddisconnected", onDisconnect);
    return () => target.removeEventListener("gamepaddisconnected", onDisconnect);
  }
}
