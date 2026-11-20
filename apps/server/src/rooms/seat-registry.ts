/**
 * Who sits in which seat, and what each seat is still owed.
 *
 * A seat ties a Colyseus session to the player it controls. Two things can be
 * pending on a seat:
 *
 * - An announcement: the `seated` message that tells a client its own player
 *   id, the one thing the shared state cannot tell it. It waits for the next
 *   tick because `onJoin` runs before the client has registered its handler,
 *   so a message sent from there is lost. Joins and reconnects both queue
 *   here, so there is exactly one path by which a client learns who it is.
 * - A reconnection hold: after an unexpected drop the seat is kept for the
 *   grace period, so a player whose train went through a tunnel comes back to
 *   the same race.
 *
 * No Colyseus import: a client is anything with `send`, and a hold is a
 * cancel callback, so this is tested with plain objects.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";

/** The one thing the registry does with a client: tell it where it sits. */
export type SeatClient = { send(type: string, message: unknown): void };

export class SeatRegistry {
  /** The player per session, in the order they first sat down. */
  private readonly players = new Map<string, PlayerId>();
  /** Clients still waiting to hear their own player id. */
  private readonly unannounced = new Map<string, SeatClient>();
  /** How to cancel each pending reconnection, keyed by the session that dropped. */
  private readonly holds = new Map<string, () => void>();
  private seatedOnce = false;

  /** Seats taken, counting those held for a player who dropped. */
  get size(): number {
    return this.players.size;
  }

  /**
   * Whether anyone has ever sat down. An empty room that has had a player is
   * abandoned; one that has not is still waiting for its first player's socket.
   */
  get everSeated(): boolean {
    return this.seatedOnce;
  }

  playerOf(sessionId: string): PlayerId | undefined {
    return this.players.get(sessionId);
  }

  /** The session sitting as `playerId`, if it still holds a seat. */
  sessionOf(playerId: PlayerId): string | undefined {
    for (const [sessionId, seated] of this.players) {
      if (seated === playerId) return sessionId;
    }
    return undefined;
  }

  /** Every seated player, in seating order: a copy, safe to keep. */
  playerIds(): PlayerId[] {
    return [...this.players.values()];
  }

  /**
   * Every seated player, in seating order, without copying: for loops that run
   * on every tick. Do not seat or free anyone while iterating it.
   */
  seatedPlayers(): Iterable<PlayerId> {
    return this.players.values();
  }

  /**
   * Seats a session as a player and queues its announcement.
   *
   * Called on a join and again on a reconnect. A returning session keeps its
   * place in the seating order.
   */
  seat(sessionId: string, playerId: PlayerId, client: SeatClient): void {
    this.players.set(sessionId, playerId);
    this.unannounced.set(sessionId, client);
    this.seatedOnce = true;
  }

  /**
   * Frees a seat for good. Nothing is announced to it afterwards.
   *
   * It does not touch a reconnection hold: a caller freeing a dropped seat
   * calls `closeHold` first, as `expireGhosts` does, or the token stays valid.
   */
  release(sessionId: string): void {
    this.players.delete(sessionId);
    this.unannounced.delete(sessionId);
  }

  /**
   * Frees every seat whose player `keep` rejects, and says which ones it
   * freed, so the caller can forget whatever else those seats held.
   */
  keepOnly(keep: (playerId: PlayerId) => boolean): { sessionId: string; playerId: PlayerId }[] {
    const freed: { sessionId: string; playerId: PlayerId }[] = [];
    for (const [sessionId, playerId] of [...this.players]) {
      if (keep(playerId)) continue;
      this.release(sessionId);
      freed.push({ sessionId, playerId });
    }
    return freed;
  }

  /**
   * Tells each waiting client its player id and the room code. Once per tick.
   *
   * A client that disconnected after it was queued makes `send` throw. Its
   * seat has already been dealt with by `onLeave`, so the failure is
   * swallowed and the other clients are still told.
   */
  announce(roomCode: string): void {
    // Almost always empty: return before copying anything, every tick.
    if (this.unannounced.size === 0) return;
    for (const [sessionId, client] of [...this.unannounced]) {
      this.unannounced.delete(sessionId);
      const playerId = this.players.get(sessionId);
      if (playerId === undefined) continue;
      try {
        client.send("seated", { playerId, roomCode });
      } catch {
        // Gone between the queue and the tick; `onLeave` decided what the seat became.
      }
    }
  }

  /** Records how to cancel the reconnection held for a dropped session. */
  hold(sessionId: string, cancel: () => void): void {
    this.holds.set(sessionId, cancel);
  }

  /** Forgets a hold that has settled: the player came back, or the grace ran out. */
  endHold(sessionId: string): void {
    this.holds.delete(sessionId);
  }

  /**
   * Ends a hold early. Its token stops working, so a client still holding it
   * is refused rather than seated into a race that has moved on.
   */
  closeHold(sessionId: string): void {
    const cancel = this.holds.get(sessionId);
    if (cancel === undefined) return;
    this.holds.delete(sessionId);
    cancel();
  }
}
