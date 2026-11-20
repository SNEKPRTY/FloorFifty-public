/**
 * Press and hover for every control in the shell (polish spec §5.2).
 *
 * As `ui-sounds.ts` gives every control its sound, one set of delegated
 * listeners at the overlay root gives every control its press and, from a
 * mouse, its lift -- so a control added tomorrow presses without anyone
 * remembering to wire it, and no component writes its own.
 *
 * - A pointer press steps down on pointer-down and springs on release.
 * - A keyboard or pad activation arrives as a click with no pointer, so it
 *   plays both steps at once.
 * - `data-motion="none"` opts a control out, for one whose own consequence
 *   is the motion: the select screen's tiles, the swipe surface, the race's
 *   touch buttons.
 * - A disabled or `aria-disabled` control does not press; it refuses.
 * - A `.ff-aq-control` presses in CSS (`aquarian.css`: the face drops 2 px at
 *   once). A tween on top would stack with it and spring back past rest, which
 *   is the bounce the menus no longer have; so it gets no press, release or
 *   hover lift from here, only the refusal.
 */

import { hoverLift, pressDown, pressThrough, pressUp, refuse } from "./motion";
import { CONTROL } from "./ui-sounds";

/** A control this module leaves alone: its own consequence is the motion. */
const OPTED_OUT = "[data-motion='none']";

function controlOf(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const control = target.closest<HTMLElement>(CONTROL);
  if (control === null || control.closest(OPTED_OUT) !== null) return undefined;
  return control;
}

/** A control whose press the stylesheet draws, so no tween is added. */
const pressedByCss = (control: HTMLElement): boolean => control.matches(".ff-aq-control");

const isDisabled = (control: HTMLElement): boolean =>
  control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";

/** Installs press and hover under `root`; returns the release. */
export function installUiMotion(root: HTMLElement): () => void {
  // Per pointer: a second finger down must not be sprung by the first's lift.
  const pressed = new Map<number, HTMLElement>();
  const options = { capture: true, passive: true } as const;

  const down = (event: PointerEvent): void => {
    const control = controlOf(event.target);
    if (control === undefined) return;
    if (isDisabled(control)) {
      refuse(control);
      return;
    }
    if (pressedByCss(control)) return;
    pressed.set(event.pointerId, control);
    pressDown(control);
  };
  const up = (event: PointerEvent): void => {
    const control = pressed.get(event.pointerId);
    if (control === undefined) return;
    pressed.delete(event.pointerId);
    pressUp(control);
  };
  // A click with no pointer behind it: the keyboard, a pad, assistive tech.
  const click = (event: MouseEvent): void => {
    if (event.detail !== 0) return;
    const control = controlOf(event.target);
    if (control !== undefined && !isDisabled(control) && !pressedByCss(control)) pressThrough(control);
  };
  const over = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    const control = controlOf(event.target);
    if (control !== undefined && !isDisabled(control) && !pressedByCss(control)) hoverLift(control, true);
  };
  const out = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    const control = controlOf(event.target);
    if (control !== undefined && !pressedByCss(control)) hoverLift(control, false);
  };

  const listeners = [
    ["pointerdown", down],
    ["pointerup", up],
    ["pointercancel", up],
    ["click", click],
    ["pointerover", over],
    ["pointerout", out],
  ] as const;
  for (const [type, listener] of listeners) root.addEventListener(type, listener as EventListener, options);
  return () => {
    for (const [type, listener] of listeners) root.removeEventListener(type, listener as EventListener, options);
  };
}
