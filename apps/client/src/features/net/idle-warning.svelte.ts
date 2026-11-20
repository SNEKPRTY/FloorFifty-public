/**
 * Whether the room has warned that it is about to close for want of anyone
 * using it (audit B1).
 *
 * The server sends the warning a minute before it closes a room nobody has
 * done anything in, and a second word, "kept open", if any seat then does. The
 * banner (`IdleWarning.svelte`) shows while this says so. Anything that ends the
 * warning another way clears it too: a lost connection has its own indicator, and
 * a race that starts is a room in use.
 */

import type { NetworkPort } from "./network";

export class IdleWarningStore {
  /** Whether the banner shows. A plain field: Svelte's `$state` class fields are the supported form. */
  visible = $state(false);

  show(): void {
    this.visible = true;
  }

  clear(): void {
    this.visible = false;
  }
}

/** Keeps the store in step with what the room says. Returns the unsubscribe. */
export function wireIdleWarning(network: Pick<NetworkPort, "subscribe">, store: IdleWarningStore): () => void {
  return network.subscribe({
    onIdleWarning: (warning) => {
      if (warning.closesInSeconds === null) store.clear();
      else store.show();
    },
    onConnectionState: (state) => {
      if (state !== "connected") store.clear();
    },
    onSnapshot: (snapshot) => {
      if (snapshot.phase === "countdown" || snapshot.phase === "racing") store.clear();
    },
  });
}
