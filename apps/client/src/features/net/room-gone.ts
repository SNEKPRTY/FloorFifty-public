/**
 * What the lobby does with an error the server or the connection pushes
 * (audit S10).
 *
 * A pushed error used to set the status line and nothing else. Whether the
 * player is "in a room" is read from a store that only a snapshot or a command
 * changes, so after a room died -- the server restarted, a phone slept past the
 * 30 second grace, the server closed an idle room -- the player kept the select
 * or ready screen of a room that no longer existed, with no Leave on select.
 * When the error says the room is gone, the lobby leaves it, which stops any
 * reconnect and clears the seat, then re-reads the store: the connect panel
 * comes back, with the reason on its status line.
 */

import type { NetworkPort } from "./network";

/** Whether an error says the player's room no longer exists. */
export function roomIsGone(error: unknown): boolean {
  return (error as { code?: unknown } | undefined)?.code === "ROOM_CLOSED";
}

export type RoomErrorDeps = {
  network: Pick<NetworkPort, "leaveRoom">;
  /** Re-reads the room store from the network (`RoomStore.sync`). */
  sync(): void;
  /** Puts the reason on the status line. */
  report(error: unknown): void;
};

export function onRoomError(error: unknown, deps: RoomErrorDeps): void {
  deps.report(error);
  if (!roomIsGone(error)) return;
  // Leaving a room that is already gone may refuse; the store is re-read either way.
  void deps.network.leaveRoom().catch(() => undefined).finally(() => deps.sync());
}
