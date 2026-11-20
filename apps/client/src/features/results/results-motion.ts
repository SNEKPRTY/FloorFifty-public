/**
 * The results reveal (polish spec §6).
 *
 * Standings arrive from last place to first, so the winner arrives last, each
 * with one `ui.tick`. They are 2 × `STAGGER` apart rather than one: the tick
 * keeps `ui-sounds.ts`'s 90 ms gap, and at 60 ms every other standing's tick
 * would be dropped. Each time rolls up to its value.
 */

import { rateFor, semitonesOf } from "../audio/pentatonic";
import { STAGGER, riseIn, rollDigits } from "../kit/motion";
import { requestUiSound } from "../kit/ui-sounds";

/** Reveal steps between two standings, in `STAGGER`s. */
const REVEAL_STEPS = 2;
/** A standing's rise: the results' one longer, calmer reveal. */
const REVEAL_SECONDS = 0.3;

/**
 * How fast to play the tick for the standing revealed `order`th: a step up
 * the landings' own scale (`pentatonic.ts`) each time, from the tick's own
 * note, so the reveal rises toward the winner the way a score counting up
 * does, and sits in key over the results song.
 */
export function revealRate(order: number): number {
  return rateFor(semitonesOf(Math.max(0, Math.floor(order))));
}

/**
 * A Svelte action on a standing: `use:revealRow={{ order, winner }}`, where
 * `order` 0 is revealed first (last place) and the winner's is the highest.
 * Each standing ticks a step higher than the one before, and the `winner`'s
 * lands on the stamp instead -- only a race's winner: a round everyone went
 * out of ticks all the way up. Under reduced motion the row is simply there,
 * and the sounds still mark each standing.
 */
export function revealRow(node: HTMLElement, { order, winner = false }: { order: number; winner?: boolean }) {
  const rise = riseIn(node, { delay: order * REVEAL_STEPS, duration: REVEAL_SECONDS });
  // Only for a standing still on the page when its turn comes.
  const tick = setTimeout(() => {
    if (!node.isConnected) return;
    if (winner) requestUiSound(node, "stamp");
    else requestUiSound(node, "tick", undefined, revealRate(order));
  }, order * REVEAL_STEPS * STAGGER * 1000);
  return {
    destroy() {
      clearTimeout(tick);
      rise.destroy?.();
    },
  };
}

/** When the winner, revealed last of `count`, has finished rising: its portrait lands then. */
export function landDelay(count: number): string {
  return `${Math.round(((count - 1) * REVEAL_STEPS * STAGGER + REVEAL_SECONDS) * 1000)}ms`;
}

/** A time that rolls up from zeros to its value: `use:rollUp={time}`. Swaps under reduced motion. */
export function rollUp(node: HTMLElement, value: string) {
  const roll = rollDigits(node, value.replace(/\d/g, "0"));
  roll.update(value);
  return roll;
}
