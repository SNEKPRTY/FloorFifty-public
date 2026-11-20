/**
 * Which address a matchmaking request came from, for as long as Colyseus works
 * on it (audit B1).
 *
 * Only Colyseus knows whether a request opens a room: a Find a race may fill
 * a listed one. And a room's `onCreate` is handed the client's options but
 * never the request. So the gate runs Colyseus's own handlers inside this
 * context, and `onCreate` reads from it who is opening the room. Anything that
 * runs outside a request (a test that makes a room directly, the room driver)
 * has no owner and is not counted.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const owner = new AsyncLocalStorage<string>();

/** Runs `run` -- and everything it awaits -- on behalf of `address`. */
export function withRoomOwner<T>(address: string, run: () => T): T {
  return owner.run(address, run);
}

/** The address whose request is being worked on, if the caller is inside one. */
export function currentRoomOwner(): string | undefined {
  return owner.getStore();
}
