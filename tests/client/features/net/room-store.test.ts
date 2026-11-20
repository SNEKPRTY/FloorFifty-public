/**
 * The room store.
 *
 * Two things are under test here. The ordinary one is that the store mirrors
 * what authority last said. The load-bearing one is the last case: a mirror has
 * no verbs of its own, and the store must never grow one.
 */

import { MAX_PLAYERS } from "@floor-fifty/shared/common/constants";
import { describe, expect, it } from "vitest";
import { createRoomStore } from "../../../../apps/client/src/features/net/store/room-store.svelte";
import { FakeNetwork } from "../../support/fakes/network";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

/** A lobby holding two of the four seats. */
const twoSeated = (overrides: Parameters<typeof snapshotAt>[1] = {}) =>
  snapshotAt(0, {
    phase: "lobby",
    players: [
      playerSnapshot({ id: LOCAL_ID, name: "Kite", ready: false }),
      playerSnapshot({ id: REMOTE_ID, name: "Bo", ready: true }),
    ],
    ...overrides,
  });

describe("the room store", () => {
  it("mirrors the newest snapshot", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);

    network.emitSnapshot(twoSeated({ lapCount: 3 }));

    expect(store.snapshot?.lapCount).toBe(3);
    store.dispose();
  });

  it("starts from the snapshot the port already holds", () => {
    // A store created mid-race must not show an empty room until the next
    // broadcast arrives.
    const network = new FakeNetwork();
    network.emitSnapshot(twoSeated({ lapCount: 3 }));

    const store = createRoomStore(network);

    expect(store.snapshot?.lapCount).toBe(3);
    store.dispose();
  });

  it("mirrors the connection state", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);

    network.emitConnectionState("reconnecting");

    expect(store.connection).toBe("reconnecting");
    store.dispose();
  });

  it("always reports four seats, filled or open", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);

    network.emitSnapshot(twoSeated());

    expect(store.seats).toHaveLength(MAX_PLAYERS);
    expect(store.seats[0]?.player?.name).toBe("Kite");
    expect(store.seats[3]?.player).toBeUndefined();
    store.dispose();
  });

  it("a seat's colour is its player's, not its position", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);
    network.emitSnapshot(
      snapshotAt(0, {
        phase: "lobby",
        players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", colour: "violet" }), playerSnapshot({ id: REMOTE_ID, name: "Bo", colour: "scarlet" })],
      }),
    );
    expect(store.seats.map((seat) => seat.scarf)).toEqual(["violet", "scarlet", "gold", "violet"]);
    store.dispose();
  });

  it("gives every seat a scarf, so an open seat still reads as a seat", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);

    const scarves = store.seats.map((seat) => seat.scarf);

    expect(scarves).toEqual(["scarlet", "cyan", "gold", "violet"]);
    store.dispose();
  });

  it("reads the local player's ready flag from the snapshot", () => {
    const network = new FakeNetwork();
    network.localPlayerId = REMOTE_ID;
    const store = createRoomStore(network);

    network.emitSnapshot(twoSeated());

    expect(store.localIsReady).toBe(true);
    store.dispose();
  });

  it("reads host from the snapshot rather than deciding it", () => {
    const network = new FakeNetwork();
    network.localPlayerId = REMOTE_ID;
    const store = createRoomStore(network);

    network.emitSnapshot(twoSeated({ hostId: REMOTE_ID }));

    expect(store.isHost).toBe(true);
    store.dispose();
  });

  it("is not host when the snapshot names someone else, whatever the seat order", () => {
    const network = new FakeNetwork();
    network.localPlayerId = REMOTE_ID;
    const store = createRoomStore(network);

    network.emitSnapshot(twoSeated({ hostId: LOCAL_ID }));

    expect(store.isHost).toBe(false);
    store.dispose();
  });

  it("picks up a room the port joined without announcing it", async () => {
    // `createRoom` sets the room code and returns; nothing is broadcast. A view
    // that reads the code straight off the port would never hear about it.
    const network = new FakeNetwork();
    const store = createRoomStore(network);
    expect(store.roomCode).toBeUndefined();

    await network.createRoom("Kite");
    store.sync();

    expect(store.roomCode).toBe("ABC123");
    expect(store.localPlayerId).toBe("room-p1");
    store.dispose();
  });

  it("retires the last snapshot when the room is left", async () => {
    // Otherwise the newest snapshot still describes a room the player is no
    // longer in, and the menu sits in its ready room forever.
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    const store = createRoomStore(network);
    network.emitSnapshot(twoSeated());
    expect(store.snapshot).toBeDefined();

    await network.leaveRoom();
    store.sync();

    expect(store.roomCode).toBeUndefined();
    expect(store.snapshot).toBeUndefined();
    store.dispose();
  });

  it("exposes no way to compute a result", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);

    // The boundary, stated as a test: a mirror has no verbs of its own. The
    // server's own `standings` still travels through `snapshot` untouched --
    // what must never appear is a name here that computes one.
    for (const forbidden of ["winner", "standings", "rank", "place", "lapOf", "finish"]) {
      expect(Object.keys(store)).not.toContain(forbidden);
    }
    store.dispose();
  });

  it("releases its subscription on dispose", () => {
    const network = new FakeNetwork();
    const store = createRoomStore(network);
    expect(network.subscriberCount).toBe(1);

    store.dispose();

    expect(network.subscriberCount).toBe(0);
  });
});
