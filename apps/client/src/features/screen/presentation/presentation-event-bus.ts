/**
 * The presentation event bus.
 *
 * One typed, synchronous, FIFO channel from code-owned producers to
 * code-owned actions. It carries facts about what has happened -- a bundle
 * resolved, the room reached a phase, a button's network call settled -- and
 * never a command, an input frame, or an outbound protocol message.
 *
 * It does not de-duplicate and it does not interpret payloads. Lifecycle
 * producers own their own phase-edge idempotency, and the race-event gate a
 * later initiative adds will own replay/reconnect idempotency. One owner per
 * kind of duplicate, rather than a bus that guesses.
 *
 * Publication during a drain is appended rather than nested: the current
 * event's listeners all run, then the next event's. Without that, a listener
 * that publishes would see its own event delivered before the one it was
 * reacting to had finished being delivered to everyone else.
 */

import type {
  PresentationEventMap,
  PresentationEventName,
} from "@floor-fifty/shared/content/presentation";

/** One published event, with its name and payload kept together and typed. */
export type PresentationEnvelope = {
  [K in PresentationEventName]: {
    readonly name: K;
    readonly payload: PresentationEventMap[K];
  };
}[PresentationEventName];

export type PresentationPublisher = <K extends PresentationEventName>(
  name: K,
  payload: PresentationEventMap[K],
) => void;

export type PresentationListener = (event: PresentationEnvelope) => void;

export class PresentationEventBus {
  private readonly listeners = new Set<PresentationListener>();
  private readonly queue: PresentationEnvelope[] = [];
  private draining = false;

  subscribe(listener: PresentationListener): () => void {
    this.listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.listeners.delete(listener);
    };
  }

  /**
   * Publishes one event.
   *
   * A listener is expected to return promptly and not to throw; the router is
   * what isolates an action's failure, so that a broken action cannot stop the
   * events behind it.
   */
  publish<K extends PresentationEventName>(name: K, payload: PresentationEventMap[K]): void {
    this.queue.push({ name, payload } as PresentationEnvelope);
    if (this.draining) return;

    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift() as PresentationEnvelope;
        // A snapshot of the set: a listener that unsubscribes while being
        // notified must not disturb the delivery of this event to the others.
        for (const listener of [...this.listeners]) listener(event);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Drops queued events and listeners. Safe to call more than once. */
  dispose(): void {
    this.queue.length = 0;
    this.listeners.clear();
  }
}
