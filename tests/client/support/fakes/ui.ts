import { flushSync } from "svelte";

/**
 * Lets any mounted Svelte tree catch up with what just happened.
 *
 * Svelte batches DOM updates into a microtask, so without this a test that
 * delivers a broadcast and then reads the DOM sees the frame before it. A real
 * client gets the same settling for free from the next paint; a synchronous
 * test has to ask. Harmless for the screens that are still imperative, which
 * have no pending effects to flush.
 */
export function settleUi(): void {
  flushSync();
}

/** A splash gate the player has already opened, for tests past the splash. */
export const proceedAtOnce = (): { done: Promise<void>; cancel: () => void } => ({
  done: Promise.resolve(),
  cancel: () => {},
});

/** The studio's screen already over, for tests past it. */
export const skipStudio = (): { done: Promise<void>; cancel: () => void } => ({
  done: Promise.resolve(),
  cancel: () => {},
});
