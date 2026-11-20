/**
 * What one screen hands to the next.
 *
 * A screen owns what it creates, and exit releases it. The title and the lobby
 * draw the same menu backdrop, though, and tearing it down between them
 * restarts its clock and parallax, so the sky jumps as if the page reloaded
 * while only the panel changed. A screen that claims a thing here under a key
 * still releases it on exit; the release is only deferred while the screen
 * manager is between two screens, and the thing survives if the incoming
 * screen claims the same key. Whatever it does not claim is destroyed once it
 * has entered.
 *
 * Outside a transition a release destroys at once, so a screen exited on its
 * own -- a test, a page unload -- still leaves nothing behind.
 */

export type CarriedValue = { destroy(): void };

export type CarryLease<T> = {
  readonly value: T;
  /** Lets go of the claim. Idempotent. */
  release(): void;
};

export interface CarryOverPort {
  /** The value held under `key`, or a new one from `build`, claimed until released. */
  claim<T extends CarriedValue>(key: string, build: () => T): CarryLease<T>;
}

type Held = { value: CarriedValue; claimed: boolean };

export class CarryOver implements CarryOverPort {
  private readonly held = new Map<string, Held>();
  private holding = false;

  claim<T extends CarriedValue>(key: string, build: () => T): CarryLease<T> {
    let entry = this.held.get(key);
    if (entry === undefined) {
      entry = { value: build(), claimed: false };
      this.held.set(key, entry);
    }
    if (entry.claimed) throw new Error(`"${key}" is already claimed`);
    entry.claimed = true;

    const claimed = entry;
    let released = false;
    return {
      value: claimed.value as T,
      release: () => {
        if (released) return;
        released = true;
        claimed.claimed = false;
        if (!this.holding) this.drop(key, claimed);
      },
    };
  }

  /** Between two screens: releases wait for the incoming screen's claims. */
  hold(): void {
    this.holding = true;
  }

  /** The incoming screen has entered: destroys what it did not claim. */
  settle(): void {
    this.holding = false;
    for (const [key, entry] of [...this.held]) if (!entry.claimed) this.drop(key, entry);
  }

  private drop(key: string, entry: Held): void {
    if (this.held.get(key) !== entry) return;
    this.held.delete(key);
    entry.value.destroy();
  }
}
