/**
 * The input method the player last used, app-wide.
 *
 * The Controls tab and the Instructions teach the controls in the player's
 * hand, and neither lives inside a race, so this cannot be the race's
 * `InputManager`. A mouse moves nothing: it says nothing about which
 * controls to teach.
 */

import { padKeyEvents } from "./focus-nav";
import type { GlyphFamily } from "../i18n/glyphs";

export type InputMethod = "keyboard" | "gamepad" | "touch";

export class InputMethodTracker {
  /** A coarse pointer starts as touch, anything else as keyboard. */
  method = $state<InputMethod>(
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? "touch" : "keyboard",
  );

  /** Which labels the last controller's buttons carry. */
  family = $state<GlyphFamily>("generic");

  note(method: InputMethod): void {
    if (this.method !== method) this.method = method;
  }

  /** A controller was used; teach its own button names. */
  noteGamepad(family: GlyphFamily): void {
    this.note("gamepad");
    if (this.family !== family) this.family = family;
  }

  /** Listens in the capture phase, so a control that stops propagation still counts. */
  attach(target: EventTarget = window): () => void {
    // A controller's Back arrives as Escape; it is still the controller.
    const onKey = (event: Event): void => {
      if (!padKeyEvents.has(event)) this.note("keyboard");
    };
    const onPointer = (event: Event): void => {
      const type = (event as PointerEvent).pointerType;
      if (type === "touch" || type === "pen") this.note("touch");
    };
    target.addEventListener("keydown", onKey, { capture: true });
    target.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      target.removeEventListener("keydown", onKey, { capture: true });
      target.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }
}

/** The app's single tracker. */
export const inputMethod = new InputMethodTracker();
