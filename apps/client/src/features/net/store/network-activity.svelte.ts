/**
 * Network activity: how many room commands are waiting on the server.
 *
 * The one place a player's own request to the server is counted, so a single
 * loader (`NetworkLoader`) can say "working" for every one of them rather than
 * each screen drawing its own. It counts only what the player asked for and is
 * waiting on -- creating, joining, readying, leaving, racing again, reclaiming
 * a seat. The race's input stream and the transport's own reconnect loop are
 * not requests anyone waits on; the connection indicator speaks for the second.
 */

import type { NetworkPort } from "../network";

export class NetworkActivity {
  /** Commands in flight. A plain field: Svelte's `$state` class fields are the supported form. */
  pending = $state(0);

  get busy(): boolean {
    return this.pending > 0;
  }

  /** Counts `work` in flight until it settles either way. */
  async track<T>(work: () => Promise<T>): Promise<T> {
    this.pending += 1;
    try {
      return await work();
    } finally {
      this.pending -= 1;
    }
  }
}

/** The commands a player waits on, and so the ones the loader covers. */
const TRACKED = ["createRoom", "joinRoom", "setReady", "setLapCount", "setClock", "setMode", "raceAgain", "leaveRoom", "resume"] as const;
type Tracked = (typeof TRACKED)[number];

/**
 * The port with every tracked command counted.
 *
 * A command asked for again while the same one is still in flight is handed
 * the one already going rather than sent twice. The loader's scrim stops a
 * second tap, but not a key held down or a controller's confirm, and a
 * doubled `createRoom` is two rooms.
 */
export function trackNetworkActivity<P extends NetworkPort>(network: P, activity: NetworkActivity): P {
  const inFlight = new Map<Tracked, Promise<unknown>>();
  const wrapped = new Map<PropertyKey, unknown>();
  for (const name of TRACKED) {
    const command = network[name] as ((...args: unknown[]) => Promise<unknown>) | undefined;
    if (typeof command !== "function") continue;
    wrapped.set(name, (...args: unknown[]) => {
      const running = inFlight.get(name);
      if (running !== undefined) return running;
      const next = activity.track(() => command.apply(network, args)).finally(() => inFlight.delete(name));
      inFlight.set(name, next);
      return next;
    });
  }
  return new Proxy(network, {
    get(target, key) {
      if (wrapped.has(key)) return wrapped.get(key);
      const value: unknown = Reflect.get(target, key, target);
      // Bound, so a method reading a private field still finds it on the manager.
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
