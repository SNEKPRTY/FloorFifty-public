import { describe, expect, it, vi } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { SeatRegistry, type SeatClient } from "../../../apps/server/src/rooms/seat-registry";

const P1 = asPlayerId("room-p1");
const P2 = asPlayerId("room-p2");

/** A client that records what it was sent. */
function recordingClient(): SeatClient & { sent: [string, unknown][] } {
  const sent: [string, unknown][] = [];
  return { sent, send: (type, message) => sent.push([type, message]) };
}

describe("seats", () => {
  it("finds a seat's player, and a player's seat", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    expect(seats.playerOf("s1")).toBe(P1);
    expect(seats.sessionOf(P1)).toBe("s1");
    expect(seats.playerOf("nobody")).toBeUndefined();
    expect(seats.sessionOf(P2)).toBeUndefined();
  });

  it("keeps a returning session's place in the seating order", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    seats.seat("s2", P2, recordingClient());
    seats.seat("s1", P1, recordingClient()); // a reconnect
    expect(seats.playerIds()).toEqual([P1, P2]);
  });

  it("gives a live view of the seated players, in seating order", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    seats.seat("s2", P2, recordingClient());
    expect([...seats.seatedPlayers()]).toEqual([P1, P2]);
  });

  it("keeps the others in order once the first seat frees", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    seats.seat("s2", P2, recordingClient());
    seats.release("s1");
    expect(seats.playerIds()).toEqual([P2]);
    expect(seats.size).toBe(1);
  });

  it("frees every seat whose player is not kept", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    seats.seat("s2", P2, recordingClient());
    seats.keepOnly((playerId) => playerId === P2);
    expect(seats.playerIds()).toEqual([P2]);
  });

  it("says which seats it freed, so the room can forget what they held", () => {
    const seats = new SeatRegistry();
    seats.seat("s1", P1, recordingClient());
    seats.seat("s2", P2, recordingClient());
    expect(seats.keepOnly((playerId) => playerId === P2)).toEqual([{ sessionId: "s1", playerId: P1 }]);
  });

  it("remembers that someone sat down, after everyone has gone", () => {
    const seats = new SeatRegistry();
    expect(seats.everSeated).toBe(false);
    seats.seat("s1", P1, recordingClient());
    seats.release("s1");
    expect(seats.size).toBe(0);
    expect(seats.everSeated).toBe(true);
  });
});

describe("announcements", () => {
  it("tells a new seat its player id and the room code, once", () => {
    const seats = new SeatRegistry();
    const client = recordingClient();
    seats.seat("s1", P1, client);
    seats.announce("ABC123");
    seats.announce("ABC123");
    expect(client.sent).toEqual([["seated", { playerId: P1, roomCode: "ABC123" }]]);
  });

  it("announces again after a reconnect", () => {
    const seats = new SeatRegistry();
    const client = recordingClient();
    seats.seat("s1", P1, client);
    seats.announce("ABC123");
    seats.seat("s1", P1, client);
    seats.announce("ABC123");
    expect(client.sent).toHaveLength(2);
  });

  it("announces nothing to a seat released before the tick", () => {
    const seats = new SeatRegistry();
    const client = recordingClient();
    seats.seat("s1", P1, client);
    seats.release("s1");
    seats.announce("ABC123");
    expect(client.sent).toEqual([]);
  });

  it("still announces the others when one client has already gone", () => {
    const seats = new SeatRegistry();
    const gone: SeatClient = {
      send: () => {
        throw new Error("socket closed");
      },
    };
    const present = recordingClient();
    seats.seat("s1", P1, gone);
    seats.seat("s2", P2, present);
    expect(() => seats.announce("ABC123")).not.toThrow();
    expect(present.sent).toEqual([["seated", { playerId: P2, roomCode: "ABC123" }]]);
  });
});

describe("reconnection holds", () => {
  it("cancels a closed hold exactly once", () => {
    const seats = new SeatRegistry();
    const cancel = vi.fn();
    seats.hold("s1", cancel);
    seats.closeHold("s1");
    seats.closeHold("s1");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel a hold that already settled", () => {
    const seats = new SeatRegistry();
    const cancel = vi.fn();
    seats.hold("s1", cancel);
    seats.endHold("s1");
    seats.closeHold("s1");
    expect(cancel).not.toHaveBeenCalled();
  });
});
