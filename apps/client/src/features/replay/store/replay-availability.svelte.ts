/**
 * Whether a replay of the race just finished is in hand, for Results' Watch
 * replay (race-options spec §7.1). Read off the network, which keeps the
 * bytes; this only makes their arrival reactive.
 */

import type { NetworkPort } from "../../net/network";

export type ReplayAvailability = { readonly available: boolean; dispose(): void };

/** Why Results would not open a replay, once it has said so. */
export type ReplayRefusalBox = { message: (() => string) | undefined };

export function createRefusal(): ReplayRefusalBox {
  let message = $state<(() => string) | undefined>(undefined);
  return {
    get message() {
      return message;
    },
    set message(next) {
      message = next;
    },
  };
}

export function createReplayAvailability(network: NetworkPort): ReplayAvailability {
  let available = $state(network.latestReplay() !== undefined);
  const unsubscribe = network.subscribe({
    onReplay: () => {
      available = true;
    },
    onSnapshot: () => {
      available = network.latestReplay() !== undefined;
    },
  });
  return {
    get available() {
      return available;
    },
    dispose: unsubscribe,
  };
}
