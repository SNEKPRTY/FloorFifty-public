/**
 * The controller's line to the menu's racers.
 *
 * Out of a race each shoulder button is one racer's jump (`HOP_BUTTONS`). The pad
 * is polled in `main.ts` and the racers live in whichever menu hero is mounted,
 * if any, so the press goes through here rather than either knowing the other.
 * With no hero listening, a press is simply dropped.
 */

type HopListener = (seat: number) => void;

const listeners = new Set<HopListener>();

/** Asks the racer in `seat` (left to right, from 0) to jump. */
export function requestRacerHop(seat: number): void {
  for (const listener of listeners) listener(seat);
}

/** Hears every jump the pad asks for; returns the unsubscribe. */
export function onRacerHopRequest(listener: HopListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
