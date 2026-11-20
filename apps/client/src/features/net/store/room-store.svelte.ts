/**
 * The room store.
 *
 * A mirror of what authority last said, and nothing else. It holds no rule: it
 * does not decide a lap, a standing, a winner, or who may start a race. Every
 * value here is read straight off a snapshot or off the network port.
 *
 * That restraint is the whole point of the file. `tests/client/features/results/game-end.test.ts`
 * asserts the results screen follows the server's order even when it disagrees
 * with the finish times, and the cheapest way to break that guarantee would be
 * a convenient derived value added here. Svelte makes derived state cheap
 * enough that a second implementation of the race rules could grow in this file
 * without anyone deciding to write one, so `room-store.test.ts` names the verbs
 * that must never appear rather than trusting that nobody adds them.
 *
 * The `.svelte.ts` extension is what lets `$state` live outside a component.
 */

import { MAX_PLAYERS } from "@floor-fifty/shared/common/constants";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { SEAT_SCARVES, type SeatScarf } from "../../../lib/constants";
import type { ConnectionState, NetworkPort } from "../network";

/**
 * One of the room's four places, filled or open.
 *
 * `player` is optional because a seat exists before anyone sits in it: the
 * lobby shows four seats from the moment it opens so a player can see how many
 * are still free.
 */
export type Seat = {
  index: number;
  scarf: SeatScarf;
  player: PlayerSnapshot | undefined;
};

export type RoomStore = ReturnType<typeof createRoomStore>;

export function createRoomStore(network: NetworkPort) {
  // Seeded from the port rather than left empty, so a store created mid-race
  // shows the room immediately instead of blanking until the next broadcast.
  let snapshot = $state<RoomSnapshot | undefined>(network.latestSnapshot());
  let connection = $state<ConnectionState>(network.connectionState);

  // `roomCode` and `localPlayerId` are pulled rather than broadcast: the port
  // sets them when a room command resolves and never announces the change.
  // Mirrored into state here so a view can react to joining and leaving at all.
  let roomCode = $state<string | undefined>(network.roomCode);
  let localPlayerId = $state<string | undefined>(network.localPlayerId);

  const unsubscribe = network.subscribe({
    onSnapshot: (next) => {
      snapshot = next;
      // A snapshot only arrives once a room exists, and leaving stops them, so
      // every broadcast is also a chance to notice the room identity changed.
      roomCode = network.roomCode;
      localPlayerId = network.localPlayerId;
    },
    onConnectionState: (next) => {
      connection = next;
    },
  });

  return {
    get snapshot() {
      return snapshot;
    },
    get connection() {
      return connection;
    },
    get roomCode() {
      return roomCode;
    },
    get localPlayerId() {
      return localPlayerId;
    },
    /**
     * Re-reads the values the port does not broadcast.
     *
     * Called after a room command resolves. Creating, joining and leaving all
     * change `roomCode` with no event to hear, and leaving produces no further
     * snapshot at all -- so without this the menu would sit in the ready room
     * of a room the player had already left.
     *
     * This is a re-read, not a derivation. It computes nothing the server owns.
     */
    sync(): void {
      roomCode = network.roomCode;
      localPlayerId = network.localPlayerId;
      // Leaving a room retires the last broadcast with it. Without this the
      // newest snapshot would still describe a room the player has left, and
      // anything reading "is there a room" from it would answer yes forever.
      if (roomCode === undefined) snapshot = undefined;
    },
    /** Four seats always, so a player can see how many are still open. */
    get seats(): Seat[] {
      return Array.from({ length: MAX_PLAYERS }, (_unused, index) => ({
        index,
        // The player's colour (select spec §6.7); an open seat shows its
        // position's, for the empty row's bar.
        scarf: snapshot?.players[index]?.colour ?? SEAT_SCARVES[index] ?? "scarlet",
        player: snapshot?.players[index],
      }));
    },
    get isHost() {
      return snapshot !== undefined && localPlayerId === snapshot.hostId;
    },
    get localIsReady() {
      return snapshot?.players.find((player) => player.id === localPlayerId)?.ready === true;
    },
    dispose: unsubscribe,
  };
}
