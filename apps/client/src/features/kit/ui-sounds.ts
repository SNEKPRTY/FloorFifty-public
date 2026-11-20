/**
 * The interface, heard.
 *
 * One listener at the root of the overlay rather than a sound wired into each
 * control. The shell has dozens of buttons across a dozen components, and a
 * sound per `onclick` is a sound somebody forgets on the next one; delegated,
 * every control sounds by default and a control that means something else says
 * so with `data-sfx`:
 *
 * - `data-sfx="back"` -- leaving, closing, cancelling: a swish drawn back.
 * - `data-sfx="ready"` -- the ready toggle: a blade locked into its guard.
 * - `data-sfx="none"` -- a control whose own consequence is the sound.
 *
 * Focus ticks: the mouse moving onto a control, or a keyboard or pad moving
 * focus to one. Not a finger, which lands and presses in one motion and would
 * hear both. Not a scroll either, which slides control after control under a
 * mouse that never moved; and never faster than `TICK_GAP_MS`, so a held arrow
 * running down a list is a few ticks rather than a buzz. The tick sits under
 * the presses: it is the sound heard most, and the one that means least.
 *
 * A component that has something to say with no press behind it -- an error
 * arriving -- raises `requestUiSound`, which bubbles here.
 *
 * A volume slider let go asks for its bus's sample -- a landing, a call -- on
 * that bus rather than the interface's, so the level is set by ear.
 */

import type { AudioPort, Bus } from "../audio";

export const CONTROL = "button, a[href], [role='button'], select, input:not([type='range']):not([type='text'])";

/** The press sounds a control may declare, and the event-only ones. */
type PressSound = "confirm" | "back" | "ready";
export type UiSound =
  | PressSound
  | "hover"
  | "error"
  | "open"
  | "close"
  | "tick"
  | "copied"
  | "unlock"
  | "effectsSample"
  | "voiceSample"
  | "stamp";

const ALIAS: Record<UiSound, string> = {
  hover: "ui.hover",
  confirm: "ui.confirm",
  back: "ui.back",
  ready: "ui.ready",
  error: "ui.error",
  // A modal, sheet or pause overlay opening and closing (polish spec §8.2).
  open: "ui.open",
  close: "ui.close",
  // A standing revealed on Results, a second of a closing clock; and a copy.
  tick: "ui.tick",
  copied: "ui.copied",
  // NEW CHALLENGER (unlockables spec §7.1): NEW SONG's preview is its own sound.
  unlock: "ui.unlock",
  // A volume slider let go: what that bus sounds like at its new level.
  effectsSample: "sfx.landMid",
  voiceSample: "vo.title",
  // The winner's standing landing on Results: the race beats' stamp.
  stamp: "sfx.stamp",
};

/** The samples, on the bus whose slider asked; everything else is the interface's. */
const SAMPLE_BUS: Partial<Record<UiSound, Bus>> = { effectsSample: "effects", voiceSample: "voice" };

/**
 * The closest two samples may sound. An arrow key changes a slider once a
 * press, and each change is a release; a call is about a second long.
 */
const SAMPLE_GAP_MS = 600;

/** A focus following a press within this long is the press's, not news. */
const PRESS_FOCUS_MS = 400;

/** A mouse "moving onto" a control this soon after a scroll was the scroll. */
const SCROLL_QUIET_MS = 250;

/** The closest two focus ticks may sound. */
const TICK_GAP_MS = 90;

/** The tick's level against the UI bus. */
const HOVER_GAIN = 0.5;

const REQUEST = "ff-sfx";

/**
 * A request: the sound, the key of a moment that must be heard once whatever
 * repeats it, and the rate to play it at, where it is pitched.
 */
type UiSoundRequest = { readonly sound: UiSound; readonly key?: string; readonly rate?: number };

/**
 * Asks for an interface sound from inside a component; see the module note.
 * With a `key`, the sound is the audio's `eventId`: a component remounted for
 * the same moment asks again and is not heard twice. With a `rate`, it plays
 * that much faster and higher: a reveal climbing a scale.
 */
export function requestUiSound(from: Element, sound: UiSound, key?: string, rate?: number): void {
  // The element's own window's event type: one from another realm is refused.
  const Event = from.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
  const detail: UiSoundRequest = { sound, ...(key === undefined ? {} : { key }), ...(rate === undefined ? {} : { rate }) };
  from.dispatchEvent(new Event<UiSoundRequest>(REQUEST, { bubbles: true, detail }));
}

export function installUiSounds(
  root: HTMLElement,
  audio: Pick<AudioPort, "cue">,
  now: () => number = () => performance.now(),
): () => void {
  const play = (sound: UiSound, key?: string, rate?: number): void =>
    audio.cue(ALIAS[sound], {
      bus: SAMPLE_BUS[sound] ?? "ui",
      ...(sound === "hover" ? { gain: HOVER_GAIN } : {}),
      ...(key === undefined || sound === "hover" ? {} : { eventId: key }),
      ...(rate === undefined ? {} : { rate }),
    });
  let focused: Element | null = null;
  let pressedAt = Number.NEGATIVE_INFINITY;
  let scrolledAt = Number.NEGATIVE_INFINITY;
  let tickedAt = Number.NEGATIVE_INFINITY;
  let sampledAt = Number.NEGATIVE_INFINITY;

  const control = (target: EventTarget | null): Element | null =>
    target instanceof Element ? target.closest(CONTROL) : null;

  const tick = (element: Element | null): void => {
    if (element === null || element === focused) return;
    focused = element;
    // Remembered either way, so the control is not ticked for on the next move.
    if (now() - tickedAt < TICK_GAP_MS) return;
    tickedAt = now();
    play("hover");
  };

  const onPointerOver = (event: Event): void => {
    if ((event as PointerEvent).pointerType !== "mouse") return;
    const element = control(event.target);
    if (now() - scrolledAt < SCROLL_QUIET_MS) {
      focused = element;
      return;
    }
    tick(element);
  };
  const onScroll = (): void => {
    scrolledAt = now();
  };
  const onPointerDown = (): void => {
    pressedAt = now();
  };
  const onFocusIn = (event: Event): void => {
    const element = control(event.target);
    if (now() - pressedAt < PRESS_FOCUS_MS) {
      // Focus a press brought along. Remembered, so the pointer resting on it
      // afterwards does not tick either.
      focused = element;
      return;
    }
    tick(element);
  };
  const onClick = (event: Event): void => {
    const element = control(event.target);
    if (element === null || element.matches(":disabled")) return;
    const declared = element.getAttribute("data-sfx");
    if (declared === "none") return;
    play(declared === "back" || declared === "ready" ? declared : "confirm");
  };
  const onRequest = (event: Event): void => {
    const { sound, key, rate } = (event as CustomEvent<UiSoundRequest>).detail;
    if (!(sound in ALIAS)) return;
    // A surface opening or closing moves focus, into it or back to its
    // opener. That move is the surface's own, so it is not ticked on top of
    // the sound: UI never stacks (polish spec §8.3).
    if (sound === "open" || sound === "close") pressedAt = now();
    // A tick shares the focus tick's gap: two ticks inside it are one.
    if (sound === "tick") {
      if (now() - tickedAt < TICK_GAP_MS) return;
      tickedAt = now();
    }
    if (SAMPLE_BUS[sound] !== undefined) {
      if (now() - sampledAt < SAMPLE_GAP_MS) return;
      sampledAt = now();
    }
    play(sound, key, rate);
  };

  const listeners: [string, (event: Event) => void][] = [
    ["pointerover", onPointerOver],
    ["pointerdown", onPointerDown],
    ["focusin", onFocusIn],
    ["click", onClick],
    // `scroll` does not bubble, but capture still passes through the root.
    ["wheel", onScroll],
    ["scroll", onScroll],
    [REQUEST, onRequest],
  ];
  // Capture, so a control that stops propagation still sounds. Passive: none
  // of them cancels anything, and a wheel listener that might would hold up
  // every scroll while the browser waits to find out.
  for (const [type, listener] of listeners) root.addEventListener(type, listener, { capture: true, passive: true });
  return () => {
    for (const [type, listener] of listeners) root.removeEventListener(type, listener, true);
  };
}
