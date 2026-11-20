/**
 * The ready room's seats in motion (polish spec §6).
 *
 * The seats are keyed by index on purpose and never reorder, so a seat's
 * motion is about who is in it:
 * - a seat that fills slides in from its edge;
 * - a seat that empties collapses and settles;
 * - a seat whose racer readies pulses, as it always has;
 * - the host badge pulses once when the host passes to this seat. The badge
 *   is rebuilt in its new seat, so its own first render cannot carry the pulse.
 *
 * The rules in `motion.ts` hold: whole pixels, steps, no colour.
 */

import gsap from "gsap";
import { BEAT, STEP_EASE, pulse, reducedMotion } from "../kit/motion";

export type SeatState = { readonly occupant: string | undefined; readonly ready: boolean; readonly host: boolean };

/** How far a filling seat slides in, in pixels. */
const SLIDE = 16;
/** How short an emptying seat collapses to before it settles. */
const COLLAPSE = 0.85;

/** A Svelte action on a seat: `use:seatMotion={{ occupant, ready, host }}`. Still on the first render. */
export function seatMotion(node: HTMLElement, state: SeatState) {
  let last = state;
  return {
    update(next: SeatState) {
      const previous = last;
      last = next;
      if (reducedMotion()) return;
      if (previous.occupant === undefined && next.occupant !== undefined) {
        gsap.fromTo(
          node,
          { x: -SLIDE, opacity: 0 },
          { x: 0, opacity: 1, duration: BEAT, ease: STEP_EASE, roundProps: "x", clearProps: "x,opacity,transform" },
        );
        return;
      }
      if (previous.occupant !== undefined && next.occupant === undefined) {
        gsap.fromTo(
          node,
          { scaleY: COLLAPSE },
          { scaleY: 1, duration: BEAT, ease: STEP_EASE, transformOrigin: "50% 0%", clearProps: "scale,transform" },
        );
        return;
      }
      if (next.ready !== previous.ready || (next.host && !previous.host)) pulse(node);
    },
  };
}

/**
 * A public room's status line pulsing once when a race is found: `found` turns true (the start
 * clock begins). Never on the first render, and never when it turns false again (the race is called
 * off), so only the good news moves. A Svelte action: `use:pulseWhenFound={found}`.
 */
export function pulseWhenFound(node: HTMLElement, found: boolean) {
  let last = found;
  return {
    update(next: boolean) {
      const before = last;
      last = next;
      if (next && !before) pulse(node);
    },
  };
}

/**
 * The ready stamp stepping in: at 1.1, settling to 1 in two steps. A Svelte
 * action, so it plays as the stamp mounts. Appears in place under reduced motion.
 */
export function stampIn(node: HTMLElement): void {
  if (reducedMotion()) return;
  gsap.fromTo(node, { scale: 1.1 }, { scale: 1, duration: BEAT * 0.5, ease: "steps(2)", clearProps: "scale,transform" });
}
