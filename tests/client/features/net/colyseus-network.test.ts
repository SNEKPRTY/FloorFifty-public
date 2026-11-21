import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, RECONNECT_GRACE_TICKS, TICK_MS } from "@floor-fifty/shared/common/constants";
import {
  ColyseusNetworkManager,
  reconnectDelay,
  schemaToSnapshot,
} from "../../../../apps/client/src/features/net/colyseus-network";
import { CLIENT_BUILD } from "../../../../apps/client/src/lib/build-facts";

/** What every join carries besides its own options (release readiness §4.2). */
const BUILD = { buildId: CLIENT_BUILD.buildId, rulesetRevision: CLIENT_BUILD.rulesetRevision };

describe("the reconnect backoff", () => {
  it("doubles from 250 ms to a 2 s ceiling", () => {
    expect([0, 1, 2, 3, 4, 9].map((attempt) => reconnectDelay(attempt, () => 0.5))).toEqual([
      250, 500, 1_000, 2_000, 2_000, 2_000,
    ]);
  });

  it("spreads each climbing step by up to a quarter either way, so a restart does not bring everyone back at once", () => {
    expect(reconnectDelay(0, () => 0)).toBe(187.5);
    expect(reconnectDelay(0, () => 1)).toBe(312.5);
    expect(reconnectDelay(2, () => 0)).toBe(750);
  });
});
import { fakeSchemaState, fakeColyseusClient } from "../../support/fakes/server";

describe("schema to snapshot", () => {
  it("projects a schema state into the shape every screen already reads", () => {
    const snapshot = schemaToSnapshot(fakeSchemaState(), []);

    expect(snapshot.tick).toBe(42);
    expect(snapshot.phase).toBe("racing");
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]!.lastAckedSequence).toBe(7);
    expect(snapshot.platforms[0]!.collectedBy).toEqual(["p1"]);
    expect(snapshot.tuning.GRAVITY).toBe(-275);
    expect(snapshot.standings).toEqual([]);
  });

  it("turns absent sentinels back into absent fields", () => {
    const snapshot = schemaToSnapshot(fakeSchemaState({ winnerId: "", raceStartedAtTick: -1 }), []);
    expect(snapshot.winnerId).toBeUndefined();
    expect(snapshot.raceStartedAtTick).toBeUndefined();
    expect("finishedAtTick" in snapshot.players[0]!).toBe(false);
  });

  it("carries a lap hold, and no hold as absent", () => {
    const state = fakeSchemaState();
    const row = (state.players as unknown as Map<string, Record<string, unknown>>).get("p1")!;
    expect("holdUntilTick" in schemaToSnapshot(state, []).players[0]!).toBe(false);
    row["holdUntilTick"] = 240;
    expect(schemaToSnapshot(state, []).players[0]!.holdUntilTick).toBe(240);
  });

  it("carries the select phase, the stage and its course revision", () => {
    const snapshot = schemaToSnapshot(
      fakeSchemaState({
        phase: "select",
        roomSeed: 99,
        stageId: "snow-shrine",
        courseRevision: "c".repeat(64),
        select: {
          step: "stageReveal",
          endsAtTick: 300,
          picks: new Map([["p1", { focus: "snow-shrine", locked: true, seed: "48213" }]]),
          stageId: "snow-shrine",
          stagePickedBy: "p1",
          stageSeed: 48213,
          stageClassic: false,
          songId: "",
          songPickedBy: "",
          loaded: [],
        },
      }),
      [],
    );
    expect(snapshot.roomSeed).toBe(99);
    expect(snapshot.stageId).toBe("snow-shrine");
    expect(snapshot.courseRevision).toBe("c".repeat(64));
    expect(snapshot.select).toEqual({
      step: "stageReveal",
      endsAtTick: 300,
      picks: { p1: { focus: "snow-shrine", locked: true, seed: 48213 } },
      stage: { id: "snow-shrine", pickedBy: "p1", seed: 48213, classic: false },
      loaded: [],
    });
  });

  it("carries no select or stage before there is one", () => {
    const snapshot = schemaToSnapshot(fakeSchemaState(), []);
    expect("select" in snapshot).toBe(false);
    expect("stageId" in snapshot).toBe(false);
    expect("songId" in snapshot).toBe(false);
    expect(snapshot.courseRevision).toBe("");
  });

  it("carries a room's access and, in a public lobby, its clocks", () => {
    const snapshot = schemaToSnapshot(fakeSchemaState({ access: "public", startsAtTick: 1900, soloFromTick: -1 }), []);
    expect(snapshot.access).toBe("public");
    expect(snapshot.startsAtTick).toBe(1900);
    expect("soloFromTick" in snapshot).toBe(false);
  });

  it("reads anything but public as private", () => {
    expect(schemaToSnapshot(fakeSchemaState({ access: "" }), []).access).toBe("private");
  });

  it("carries the song result and the race's song", () => {
    const snapshot = schemaToSnapshot(
      fakeSchemaState({
        phase: "select",
        stageId: "snow-shrine",
        songId: "whats-next",
        select: {
          step: "songReveal",
          endsAtTick: 600,
          picks: new Map([["p1", { focus: "whats-next", locked: true, seed: "classic" }]]),
          stageId: "snow-shrine",
          stagePickedBy: "p1",
          stageSeed: 1111,
          stageClassic: true,
          songId: "whats-next",
          songPickedBy: "p1",
          loaded: [],
        },
      }),
      [],
    );
    expect(snapshot.songId).toBe("whats-next");
    expect(snapshot.select?.song).toEqual({ id: "whats-next", pickedBy: "p1" });
    expect(snapshot.select?.stage).toEqual({ id: "snow-shrine", pickedBy: "p1", seed: 1111, classic: true });
    expect(snapshot.select?.picks["p1"]?.seed).toBe("classic");
  });

  it("carries no song before the song reveal", () => {
    const snapshot = schemaToSnapshot(
      fakeSchemaState({
        phase: "select",
        stageId: "snow-shrine",
        select: {
          step: "song",
          endsAtTick: 900,
          picks: new Map([["p1", { focus: "moving-on", locked: false, seed: "not-a-seed" }]]),
          stageId: "snow-shrine",
          stagePickedBy: "p1",
          stageSeed: -1,
          stageClassic: false,
          songId: "",
          songPickedBy: "",
          loaded: [],
        },
      }),
      [],
    );
    expect("songId" in snapshot).toBe(false);
    expect("song" in snapshot.select!).toBe(false);
    // No seed until the roulette lands; an unreadable choice reads as Random.
    expect("seed" in snapshot.select!.stage!).toBe(false);
    expect(snapshot.select!.picks["p1"]!.seed).toBe("random");
  });

  it("produces a plain object holding no schema reference", () => {
    const state = fakeSchemaState();
    const snapshot = schemaToSnapshot(state, []);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(snapshot.players[0]).not.toBe([...state.players.values()][0]);
  });
});

describe("the colyseus network manager", () => {
  it("creates a room with the protocol version and remembers the seat", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.createRoom("Kite");

    expect(client.create).toHaveBeenCalledWith("race", {
      name: "Kite",
      protocolVersion: PROTOCOL_VERSION,
      deviceClass: "desktop",
      ...BUILD,
    });
    expect(manager.roomCode).toBe(room.roomId);
    expect(manager.localPlayerId).toBe("p1");
    expect(manager.connectionState).toBe("connected");
  });

  it("turns off the SDK's own reconnect loop, so a drop reaches ours", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.createRoom("Kite");

    expect(room.reconnection.enabled).toBe(false);
  });

  it("finds a race with joinOrCreate, asking for a public room, and remembers the seat", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.quickMatch("Kite");

    expect(client.joinOrCreate).toHaveBeenCalledWith("race", {
      name: "Kite",
      protocolVersion: PROTOCOL_VERSION,
      deviceClass: "desktop",
      quickMatch: true,
      ...BUILD,
    });
    expect(client.create).not.toHaveBeenCalled();
    expect(manager.roomCode).toBe(room.roomId);
    expect(manager.connectionState).toBe("connected");
  });

  it("tries once more when the room it was offered has just closed", async () => {
    const { client, room } = fakeColyseusClient();
    client.joinOrCreate
      .mockRejectedValueOnce(new Error("ROOM_CLOSED: this room is already racing"))
      .mockResolvedValueOnce(room);
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.quickMatch("Kite");

    expect(client.joinOrCreate).toHaveBeenCalledTimes(2);
    expect(manager.connectionState).toBe("connected");
  });

  it("tries once more when the room it was offered has just filled", async () => {
    const { client, room } = fakeColyseusClient();
    client.joinOrCreate.mockRejectedValueOnce(new Error('room "ABC234" is locked')).mockResolvedValueOnce(room);
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.quickMatch("Kite");

    expect(client.joinOrCreate).toHaveBeenCalledTimes(2);
  });

  it("says so in the game's words when the second try is refused too, and tries no third time", async () => {
    const { client } = fakeColyseusClient();
    client.joinOrCreate.mockRejectedValue(new Error("ROOM_CLOSED: this room is already racing"));
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const errors: string[] = [];
    manager.subscribe({ onError: (error) => errors.push(error.code) });

    await expect(manager.quickMatch("Kite")).rejects.toMatchObject({ code: "ROOM_CLOSED" });

    expect(client.joinOrCreate).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(["ROOM_CLOSED"]);
    expect(manager.connectionState).toBe("offline");
  });

  it("marks a seat refused because the race started, so the player reads that it is racing", async () => {
    const { client } = fakeColyseusClient();
    client.joinOrCreate.mockRejectedValue(new Error("ROOM_CLOSED: this room is already racing"));
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const details: (string | undefined)[] = [];
    manager.subscribe({ onError: (error) => details.push(error.detail) });

    await expect(manager.quickMatch("Kite")).rejects.toMatchObject({ code: "ROOM_CLOSED", detail: "room-racing" });
    expect(details).toEqual(["room-racing"]);
  });

  it("does not retry a refusal that is not about the room", async () => {
    const { client } = fakeColyseusClient();
    client.joinOrCreate.mockRejectedValue(new Error("unsupported protocol version 3"));
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await expect(manager.quickMatch("Kite")).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    expect(client.joinOrCreate).toHaveBeenCalledTimes(1);
  });

  it("passes STILL_SEARCHING on by its code, for the copy to be chosen from", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.quickMatch("Kite");

    const pending = manager.setReady(true).catch((error: Error & { code?: string }) => error);
    const request = room.sent.at(-1)!.payload as { requestId: string };
    room.emit("commandResult", {
      requestId: request.requestId,
      ok: false,
      error: { code: "STILL_SEARCHING", message: "for the log" },
    });

    expect(await pending).toMatchObject({ code: "STILL_SEARCHING" });
  });

  it("puts the device's access in the join options once it has one", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const access = { stages: ["rooftops"], songs: [], characters: ["ninja"] };

    manager.setAccess(access);
    await manager.createRoom("Kite");
    await manager.joinRoom("ABC234", "Kite");

    expect(client.create).toHaveBeenCalledWith("race", { name: "Kite", protocolVersion: PROTOCOL_VERSION, access, deviceClass: "desktop", ...BUILD });
    expect(client.joinById).toHaveBeenCalledWith("ABC234", { name: "Kite", protocolVersion: PROTOCOL_VERSION, access, deviceClass: "desktop", ...BUILD });
  });

  it("puts this device's class in every join (unlockables spec §3)", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    manager.setDeviceClass("phone");

    await manager.createRoom("Kite");
    await manager.joinRoom("ABC234", "Kite");

    expect(client.create).toHaveBeenCalledWith("race", expect.objectContaining({ deviceClass: "phone" }));
    expect(client.joinById).toHaveBeenCalledWith("ABC234", expect.objectContaining({ deviceClass: "phone" }));
  });

  it("reads a seat's class from the schema, and a value it does not know as desktop", () => {
    const state = fakeSchemaState();
    const [row] = [...state.players.values()] as Record<string, unknown>[];
    row!["deviceClass"] = "tablet";
    expect(schemaToSnapshot(state, []).players[0]!.deviceClass).toBe("tablet");
    row!["deviceClass"] = "fridge";
    expect(schemaToSnapshot(state, []).players[0]!.deviceClass).toBe("desktop");
  });

  it("puts the remembered colour in the join options, read at the moment of joining", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    let remembered: "violet" | "gold" = "violet";
    manager.setColourSource(() => remembered);

    await manager.createRoom("Kite");
    remembered = "gold";
    await manager.joinRoom("ABC234", "Kite");

    expect(client.create).toHaveBeenCalledWith("race", { name: "Kite", protocolVersion: PROTOCOL_VERSION, colour: "violet", deviceClass: "desktop", ...BUILD });
    expect(client.joinById).toHaveBeenCalledWith("ABC234", { name: "Kite", protocolVersion: PROTOCOL_VERSION, colour: "gold", deviceClass: "desktop", ...BUILD });
  });

  it("reports a changed access at once in a lobby, and says nothing when it is unchanged or mid-race", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    const reports = () => room.sent.filter((message) => message.type === "reportAccess");
    const access = { stages: [], songs: [], characters: ["ninja", "frog"] };

    room.pushState({ phase: "racing" });
    manager.setAccess(access);
    expect(reports()).toHaveLength(0);

    room.pushState({ phase: "lobby" });
    expect(reports()).toHaveLength(1);
    manager.setAccess({ ...access, characters: ["ninja"] });
    expect(reports()).toHaveLength(2);
    expect((reports()[1]!.payload as { access: unknown }).access).toEqual({ ...access, characters: ["ninja"] });

    manager.setAccess({ ...access, characters: ["ninja"] });
    room.pushState({ phase: "lobby" });
    expect(reports()).toHaveLength(2);
  });

  it("resends an access earned at results once the room is back in the lobby, and only once", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const reports = () => room.sent.filter((message) => message.type === "reportAccess");
    const before = { stages: [], songs: [], characters: ["ninja"] };
    const after = { stages: [], songs: [], characters: ["ninja", "frog"] };
    manager.setAccess(before);
    await manager.createRoom("Kite");

    room.pushState({ phase: "lobby" });
    expect(reports()).toHaveLength(0);

    room.pushState({ phase: "results" });
    manager.setAccess(after);
    expect(reports()).toHaveLength(0);

    room.pushState({ phase: "lobby" });
    room.pushState({ phase: "lobby" });
    expect(reports()).toHaveLength(1);
    expect((reports()[0]!.payload as { access: unknown }).access).toEqual(after);
  });

  it("resends an access the room refused at its next lobby snapshot", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    const reports = () => room.sent.filter((message) => message.type === "reportAccess");
    const access = { stages: [], songs: [], characters: ["ninja", "frog"] };

    room.pushState({ phase: "lobby" });
    manager.setAccess(access);
    expect(reports()).toHaveLength(1);
    room.emit("commandResult", {
      requestId: (reports()[0]!.payload as { requestId: string }).requestId,
      ok: false,
      error: { code: "MALFORMED_MESSAGE", message: "access is reported in the ready room" },
    });
    await Promise.resolve();

    room.pushState({ phase: "lobby" });
    expect(reports()).toHaveLength(2);
    expect((reports()[1]!.payload as { access: unknown }).access).toEqual(access);
  });

  it("starts afresh in a new room: the join options are that room's report", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const reports = () => room.sent.filter((message) => message.type === "reportAccess");
    const first = { stages: [], songs: [], characters: ["ninja"] };
    const second = { stages: [], songs: [], characters: ["ninja", "frog"] };
    manager.setAccess(first);
    await manager.createRoom("Kite");
    room.pushState({ phase: "results" });
    manager.setAccess(second);
    await manager.leaveRoom();

    await manager.joinRoom("ABC234", "Kite");
    room.pushState({ phase: "lobby" });

    expect(client.joinById).toHaveBeenCalledWith("ABC234", { name: "Kite", protocolVersion: PROTOCOL_VERSION, access: second, deviceClass: "desktop", ...BUILD });
    expect(reports()).toHaveLength(0);
  });

  it("sends pickCharacter as a correlated command", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.pickCharacter("frog");
    const sent = room.sent.at(-1)!;
    expect(sent.type).toBe("pickCharacter");
    expect(sent.payload).toMatchObject({ characterId: "frog" });
    room.emit("commandResult", { requestId: (sent.payload as { requestId: string }).requestId, ok: true });

    await expect(pending).resolves.toBeUndefined();
  });

  it("sends pickSong as a correlated command", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.pickSong("whats-next");
    const sent = room.sent.at(-1)!;
    expect(sent.type).toBe("pickSong");
    expect(sent.payload).toMatchObject({ songId: "whats-next" });
    room.emit("commandResult", { requestId: (sent.payload as { requestId: string }).requestId, ok: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it("sends pickColour as a correlated command", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.pickColour("gold");
    const sent = room.sent.at(-1)!;
    expect(sent.type).toBe("pickColour");
    expect(sent.payload).toMatchObject({ colour: "gold" });
    room.emit("commandResult", { requestId: (sent.payload as { requestId: string }).requestId, ok: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves a correlated command only when its own result arrives", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.setReady(true);
    const requestId = (room.sent.at(-1)!.payload as { requestId: string }).requestId;
    room.emit("commandResult", { requestId: "someone-else", ok: true });
    room.emit("commandResult", { requestId, ok: true });

    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects a refused command and reports the error to subscribers", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });
    await manager.createRoom("Kite");

    const pending = manager.setLapCount(3);
    const requestId = (room.sent.at(-1)!.payload as { requestId: string }).requestId;
    room.emit("commandResult", {
      requestId,
      ok: false,
      error: { code: "NOT_HOST", message: "only the host chooses the lap count" },
    });

    await expect(pending).rejects.toMatchObject({ code: "NOT_HOST" });
    // The code reaches subscribers; the player's words are chosen from it when
    // shown (features/screen/error-copy.ts), and the room's log wording is never read.
    expect(onError).toHaveBeenCalledWith({ code: "NOT_HOST", message: "only the host chooses the lap count" });
  });

  it("sends input fire-and-forget", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    manager.sendInput({ sequence: 1, tick: 40, left: false, right: true, fastFall: false, reset: false });

    expect(room.sent.at(-1)!.type).toBe("input");
    expect(room.sent.at(-1)!.payload).not.toHaveProperty("requestId");
  });

  it("publishes a snapshot on every state change", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onSnapshot = vi.fn();
    manager.subscribe({ onSnapshot });
    await manager.createRoom("Kite");

    room.pushState();

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(manager.latestSnapshot()!.tick).toBe(42);
  });

  it("carries a race event batch on the snapshot that follows it", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onSnapshot = vi.fn();
    manager.subscribe({ onSnapshot });
    await manager.createRoom("Kite");

    room.emit("raceEvents", [
      { id: "1:floorLanded:p1:floor-1", tick: 1, type: "floorLanded", playerId: "p1", floorId: "floor-1", floorIndex: 1 },
    ]);

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0]![0].events).toHaveLength(1);
  });

  it("keeps the latest replay, tells its listeners, and forgets it when the next race counts down (race-options spec §6.4)", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const heard: Uint8Array[] = [];
    manager.subscribe({ onReplay: (bytes) => heard.push(bytes) });
    await manager.createRoom("Kite");
    expect(manager.latestReplay()).toBeUndefined();

    room.emit("replay", new Uint8Array([1, 2, 3]));
    expect(manager.latestReplay()).toEqual(new Uint8Array([1, 2, 3]));
    expect(heard).toEqual([new Uint8Array([1, 2, 3])]);

    room.pushState({ phase: "finished" });
    expect(manager.latestReplay()).toEqual(new Uint8Array([1, 2, 3]));
    room.pushState({ phase: "countdown" });
    expect(manager.latestReplay()).toBeUndefined();
  });

  it("keeps the last finished snapshot after the room moves on, until the next race counts down or the seat leaves", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    expect(manager.latestFinished()).toBeUndefined();

    room.pushState({ phase: "finished", roomSeed: 7 });
    room.pushState({ phase: "lobby", roomSeed: 7 });
    expect(manager.latestFinished()).toMatchObject({ phase: "finished", roomSeed: 7 });

    room.pushState({ phase: "countdown" });
    expect(manager.latestFinished()).toBeUndefined();

    room.pushState({ phase: "finished" });
    await manager.leaveRoom();
    expect(manager.latestFinished()).toBeUndefined();
  });

  it("asks for the replay with a correlated command", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");
    void manager.getReplay().catch(() => undefined);
    expect(room.sent.at(-1)?.type).toBe("getReplay");
  });

  it("stores the reconnection token in session storage and never in the url", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const stored = window.sessionStorage.getItem("floor-fifty.session");
    expect(stored).toContain(room.reconnectionToken);
    expect(window.location.href).not.toContain(room.reconnectionToken);
  });

  it("keeps trying while the seat is held and gives up when the window closes", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const states: string[] = [];
    const errors: unknown[] = [];
    manager.subscribe({
      onConnectionState: (state) => states.push(state),
      onError: (error) => errors.push(error),
    });
    await manager.createRoom("Kite");

    // The seat is held for thirty seconds, so one refusal is not the end of
    // the attempt; only the window closing is.
    vi.useFakeTimers();
    try {
      client.reconnect.mockRejectedValue(new Error("expired"));
      // 1006: the socket closed without a close frame, which is what a lost
      // network looks like from the browser.
      room.emit("leave", 1006);

      // Seconds in: still trying, and the indicator still says so.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(states.at(-1)).toBe("reconnecting");
      expect(client.reconnect.mock.calls.length).toBeGreaterThan(1);

      // Past the window: the seat is gone and the player is told why.
      await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_TICKS * TICK_MS);
    } finally {
      vi.useRealTimers();
    }

    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("offline");
    expect(errors.at(-1)).toMatchObject({ code: "ROOM_CLOSED" });
  });

  it("persists a rotated token before a reconnect is announced seated", async () => {
    const first = fakeColyseusClient();
    const returned = fakeColyseusClient({ announceSeat: false });
    returned.room.reconnectionToken = "rotated-token";
    first.client.reconnect.mockResolvedValue(returned.room);
    const manager = new ColyseusNetworkManager("http://test", () => first.client);
    await manager.createRoom("Kite");
    await manager.reconnect();

    // The handshake already rotated the token; seated arrives on a later
    // server tick. A second drop or reload in that gap must use the new token.
    expect(manager.connectionState).toBe("connected");
    expect(JSON.parse(window.sessionStorage.getItem("floor-fifty.session")!)).toMatchObject({
      playerId: "p1", roomCode: "ABC234", reconnectionToken: "rotated-token",
    });
    await manager.reconnect();
    expect(first.client.reconnect).toHaveBeenLastCalledWith("rotated-token");
    manager.dispose();
  });

  it("closes the transport when the browser reports no network", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const states: string[] = [];
    manager.subscribe({ onConnectionState: (state) => states.push(state) });
    await manager.createRoom("Kite");

    // The socket can look open for as long as the operating system takes to
    // notice, so the client closes it and makes the drop real.
    window.dispatchEvent(new Event("offline"));

    expect(states.at(-1)).toBe("reconnecting");
    expect(room.connection.close).toHaveBeenCalled();

    manager.dispose();
    window.dispatchEvent(new Event("offline"));
    expect(states.at(-1)).toBe("reconnecting");
  });

  it("delivers a server error to subscribers as well as the room", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });
    await manager.createRoom("Kite");

    // A halted room says so on the wire; nothing throws on this side, because
    // the failure happened to a race the player is watching rather than to a
    // request they made.
    room.emit("serverError", {
      code: "SIMULATION_FAILURE",
      message: "This race could not continue.",
    });

    expect(onError).toHaveBeenCalledWith({
      code: "SIMULATION_FAILURE",
      message: "This race could not continue.",
    });
  });

  it.each([4001, 1006])(
    "says a draining room was moved on, once, rather than that it closed (close %i)",
    async (closeCode) => {
      const { client, room } = fakeColyseusClient();
      const manager = new ColyseusNetworkManager("http://test", () => client);
      const onError = vi.fn();
      manager.subscribe({ onError });
      await manager.createRoom("Kite");

      room.emit("serverError", { code: "SERVER_UPDATING", message: "the server is updating" });
      expect(onError).not.toHaveBeenCalled();
      room.emit("leave", closeCode);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SERVER_UPDATING", detail: "server-moving-private" }),
      );
      // Nothing to reclaim: the room is gone, and the new build is a fresh join away.
      expect(manager.connectionState).toBe("offline");
      expect(client.reconnect).not.toHaveBeenCalled();
    },
  );

  it("forgets a drain notice from a room it left, so the next room's drop still reconnects", async () => {
    const first = fakeColyseusClient();
    const second = fakeColyseusClient();
    let call = 0;
    const manager = new ColyseusNetworkManager("http://test", () => (call++ === 0 ? first.client : second.client));
    const onError = vi.fn();
    manager.subscribe({ onError });

    await manager.createRoom("Kite");
    first.room.emit("serverError", { code: "SERVER_UPDATING", message: "the server is updating" });
    await manager.leaveRoom();

    await manager.createRoom("Kite");
    second.room.emit("leave", 1006);
    expect(onError).not.toHaveBeenCalledWith(expect.objectContaining({ code: "SERVER_UPDATING" }));
    expect(manager.connectionState).toBe("reconnecting");
  });

  it("says a public room was moved on, so the player finds a race again", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });
    await manager.quickMatch("Kite");
    room.pushState({ access: "public" });

    room.emit("serverError", { code: "SERVER_UPDATING", message: "the server is updating" });
    room.emit("leave", 4001);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SERVER_UPDATING", detail: "server-moving-public" }),
    );
  });

  it("tells a joiner the room is racing when the server says so", async () => {
    const { client } = fakeColyseusClient();
    client.joinById.mockRejectedValue(new Error("ROOM_CLOSED: this room is already racing"));
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });

    await expect(manager.joinRoom("ABC234", "Late")).rejects.toMatchObject({ code: "ROOM_CLOSED" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "ROOM_CLOSED" }));
  });

  it("presents the stored seat when reclaiming it", async () => {
    const { client } = fakeColyseusClient();
    window.sessionStorage.setItem(
      "floor-fifty.session",
      JSON.stringify({
        roomCode: "ABC234",
        playerId: "p1",
        reconnectionToken: "stored-token",
      }),
    );
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await manager.reconnect();

    expect(client.reconnect).toHaveBeenCalledWith("stored-token");
    expect(manager.connectionState).toBe("connected");
  });

  it("refuses to reconnect with nothing stored", async () => {
    const { client } = fakeColyseusClient();
    // Another case in this file may have left a seat behind; this one is about
    // an empty store, so it starts from one.
    window.sessionStorage.clear();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await expect(manager.reconnect()).rejects.toThrow(/no session/);
    expect(client.reconnect).not.toHaveBeenCalled();
  });

  it("carries the room's content and ruleset revisions onto every snapshot", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    room.pushState({ contentRevision: "a".repeat(64), rulesetRevision: "b".repeat(64) });

    expect(manager.latestSnapshot()!.contentRevision).toBe("a".repeat(64));
    expect(manager.latestSnapshot()!.rulesetRevision).toBe("b".repeat(64));
  });

  it("reports a refused version as the error the recovery view already renders", async () => {
    const { client } = fakeColyseusClient();
    client.create.mockRejectedValue(
      Object.assign(new Error("unsupported protocol version 2; this server speaks version 3"), {
        code: 4002,
      }),
    );
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });

    await expect(manager.createRoom("Kite")).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "VERSION_MISMATCH" }),
    );
    expect(manager.connectionState).toBe("offline");
  });

  it.each([
    ["SERVER_UPDATING: the server is updating; try again in a minute", "SERVER_UPDATING"],
    ["SERVER_BUSY: the server is full; try again in a minute", "SERVER_BUSY"],
    ["RATE_LIMITED: too many requests; slow down", "RATE_LIMITED"],
    ["VERSION_MISMATCH: this client's rules are out of date (a against b)", "VERSION_MISMATCH"],
    ["unsupported protocol version 17; this server speaks version 18", "VERSION_MISMATCH"],
    ['room "ABC234" is locked', "ROOM_FULL"],
    ['room "ABC234" not found', "INVALID_ROOM"],
    ['room "ABC234" has been disposed.', "ROOM_CLOSED"],
    // Audit S7: nothing that is not about a room's code may read as a wrong code. The player, who may have typed
    // none (Find a race, Create room), is told the server could not be reached.
    ["Failed to fetch", "UNREACHABLE"],
    ["NetworkError when attempting to fetch resource.", "UNREACHABLE"],
    ["Bad Gateway", "UNREACHABLE"],
    ["failed to connect", "UNREACHABLE"],
    ["something nobody planned for", "UNREACHABLE"],
  ])("reads the refusal %j as %s", async (message, code) => {
    const { client } = fakeColyseusClient();
    client.create.mockRejectedValue(new Error(message));
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const onError = vi.fn();
    manager.subscribe({ onError });

    await expect(manager.createRoom("Kite")).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it("sends its build with every join", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite").catch(() => undefined);
    await manager.joinRoom("ABC234", "Kite").catch(() => undefined);
    await manager.quickMatch("Kite").catch(() => undefined);
    const facts = { buildId: CLIENT_BUILD.buildId, rulesetRevision: CLIENT_BUILD.rulesetRevision };
    expect(client.create).toHaveBeenCalledWith("race", expect.objectContaining(facts));
    expect(client.joinById).toHaveBeenCalledWith("ABC234", expect.objectContaining(facts));
    expect(client.joinOrCreate).toHaveBeenCalledWith("race", expect.objectContaining(facts));
  });

  it("probes the room, measures the round trip, and reports the room's slack", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const pongs: { id: number; rttMs: number; slack: number | null }[] = [];
    manager.subscribe({ onPong: (pong) => pongs.push(pong) });
    await manager.createRoom("Kite");
    expect(manager.roundTripMs()).toBeUndefined();

    const id = manager.sendPing(123.5)!;
    expect(room.sent.at(-1)).toEqual({ type: "ping", payload: { id, tick: 123.5 } });

    room.emit("pong", { id, slack: 2.25 });
    expect(pongs).toHaveLength(1);
    expect(pongs[0]).toMatchObject({ id, slack: 2.25 });
    expect(pongs[0]!.rttMs).toBeGreaterThanOrEqual(0);
    expect(manager.roundTripMs()).toBe(pongs[0]!.rttMs);

    // An answer to a probe it never sent, or one already answered, is ignored.
    room.emit("pong", { id, slack: 9 });
    room.emit("pong", { id: 999, slack: 9 });
    expect(pongs).toHaveLength(1);
    manager.dispose();
  });

  it("keeps probing once a second while seated, so a race starts knowing its round trip", async () => {
    const { client, room } = fakeColyseusClient();
    vi.useFakeTimers();
    try {
      const manager = new ColyseusNetworkManager("http://test", () => client);
      await manager.createRoom("Kite");
      await vi.advanceTimersByTimeAsync(3_100);
      const probes = room.sent.filter((message) => message.type === "ping");
      expect(probes.length).toBeGreaterThanOrEqual(2);
      expect(probes.every((probe) => (probe.payload as { tick: number }).tick === -1)).toBe(true);

      await manager.leaveRoom();
      const after = room.sent.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(room.sent.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not probe a room it is not connected to", () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    expect(manager.sendPing(10)).toBeUndefined();
  });

  it("does not try to reconnect to a room it chose to leave", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const states: string[] = [];
    const errors: unknown[] = [];
    manager.subscribe({
      onConnectionState: (state) => states.push(state),
      onError: (error) => errors.push(error),
    });
    await manager.createRoom("Kite");

    vi.useFakeTimers();
    try {
      await manager.leaveRoom();
      await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_TICKS * TICK_MS + 1_000);
    } finally {
      vi.useRealTimers();
    }

    expect(client.reconnect).not.toHaveBeenCalled();
    expect(states).not.toContain("reconnecting");
    expect(errors).toEqual([]);
  });

  it("treats a consented close from the server as the room ending, not a drop", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const errors: unknown[] = [];
    manager.subscribe({ onError: (error) => errors.push(error) });
    await manager.createRoom("Kite");

    room.emit("leave", 4000);

    expect(client.reconnect).not.toHaveBeenCalled();
    expect(manager.connectionState).toBe("offline");
    expect(errors.at(-1)).toMatchObject({ code: "ROOM_CLOSED" });
  });

  it("treats a server shutdown as the room ending, not a drop", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    const errors: unknown[] = [];
    manager.subscribe({ onError: (error) => errors.push(error) });
    await manager.createRoom("Kite");

    // Colyseus 0.18 closes every socket with 4001 when the process shuts down.
    room.emit("leave", 4001);

    expect(client.reconnect).not.toHaveBeenCalled();
    expect(manager.connectionState).toBe("offline");
    expect(errors.at(-1)).toMatchObject({ code: "ROOM_CLOSED" });
  });

  it("detaches every listener when it leaves", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    await manager.leaveRoom();

    expect(room.removeAllListeners).toHaveBeenCalled();
    expect(manager.latestSnapshot()).toBeUndefined();
    expect(manager.connectionState).toBe("offline");
    expect(window.sessionStorage.getItem("floor-fifty.session")).toBeNull();
  });
});

describe("recovery across a page load", () => {
  const stored = { roomCode: "ABC234", playerId: "p1", reconnectionToken: "stored-token" };

  it("resumes a stored seat once, at boot", async () => {
    window.sessionStorage.setItem("floor-fifty.session", JSON.stringify(stored));
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await expect(manager.resume()).resolves.toBe("resumed");
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(client.reconnect).toHaveBeenCalledWith("stored-token");
    expect(manager.connectionState).toBe("connected");
    window.sessionStorage.clear();
  });

  it("reports nothing to resume when no seat is stored", async () => {
    window.sessionStorage.clear();
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await expect(manager.resume()).resolves.toBe("none");
    expect(client.reconnect).not.toHaveBeenCalled();
  });

  it("forgets an expired seat instead of retrying it", async () => {
    window.sessionStorage.setItem("floor-fifty.session", JSON.stringify(stored));
    const { client } = fakeColyseusClient();
    client.reconnect.mockRejectedValue(new Error("reconnection token invalid or expired"));
    const manager = new ColyseusNetworkManager("http://test", () => client);

    await expect(manager.resume()).resolves.toBe("expired");
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("floor-fifty.session")).toBeNull();
    expect(manager.connectionState).toBe("offline");
  });

  it("numbers commands uniquely across two page loads", async () => {
    // Each load is a fresh module, so each starts its counter from zero.
    const load = async (): Promise<typeof ColyseusNetworkManager> => {
      vi.resetModules();
      return (await import("../../../../apps/client/src/features/net/colyseus-network"))
        .ColyseusNetworkManager;
    };
    const first = fakeColyseusClient();
    const a = new (await load())("http://test", () => first.client);
    await a.createRoom("Kite");
    void a.setReady(true);

    const second = fakeColyseusClient();
    const b = new (await load())("http://test", () => second.client);
    await b.createRoom("Kite");
    void b.setReady(true);

    const idOf = (room: typeof first.room): string =>
      (room.sent.at(-1)!.payload as { requestId: string }).requestId;
    expect(idOf(first.room)).not.toBe(idOf(second.room));
    expect(idOf(first.room).length).toBeLessThanOrEqual(64);
  });

  it("rejects a command whose answer was lost when the room is left", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.setReady(true);
    await manager.leaveRoom();

    await expect(pending).rejects.toThrow(/left the room/);
  });

  it("rejects a command sent to a room that a reconnect replaced", async () => {
    const { client, room } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.setReady(true);
    client.reconnect.mockResolvedValue(room);
    await manager.reconnect();

    await expect(pending).rejects.toThrow(/connection was replaced/);
  });

  it("rejects pending commands on dispose", async () => {
    const { client } = fakeColyseusClient();
    const manager = new ColyseusNetworkManager("http://test", () => client);
    await manager.createRoom("Kite");

    const pending = manager.setReady(true);
    manager.dispose();

    await expect(pending).rejects.toThrow(/closed/);
  });
});


describe("session intent owns asynchronous room work", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  it.each(["leave", "replacement", "dispose"])("does not adopt an old reconnect after %s", async (intent) => {
    const first = fakeColyseusClient();
    const obsolete = fakeColyseusClient({ announceSeat: false });
    const next = fakeColyseusClient();
    next.room.roomId = "NEW234";
    const handshake = deferred<typeof obsolete.room>();
    first.client.reconnect.mockReturnValue(handshake.promise);
    const manager = new ColyseusNetworkManager("http://test", () => first.client);
    const close = vi.spyOn(obsolete.room, "leave");
    try {
      await manager.createRoom("Kite");
      const reconnect = manager.reconnect();
      if (intent === "dispose") manager.dispose();
      else await manager.leaveRoom();
      if (intent === "replacement") {
        first.client.create.mockResolvedValue(next.room);
        await manager.createRoom("New");
      }
      handshake.resolve(obsolete.room);
      await reconnect;
      expect(manager.connectionState).toBe(intent === "replacement" ? "connected" : "offline");
      expect(manager.roomCode).toBe(intent === "replacement" ? "NEW234" : undefined);
      expect(close).toHaveBeenCalledWith(true);
      obsolete.room.emit("seated", { playerId: "old", roomCode: "ABC234" });
      expect(manager.roomCode).toBe(intent === "replacement" ? "NEW234" : undefined);
    } finally { manager.dispose(); window.sessionStorage.clear(); }
  });

  it.each(["create", "join", "quick", "resume"])("ignores obsolete %s success and failure without losing replacement storage or listeners", async (kind) => {
    for (const failure of [false, true]) {
      window.sessionStorage.clear();
      const first = fakeColyseusClient();
      const obsolete = fakeColyseusClient({ announceSeat: false });
      const next = fakeColyseusClient();
      next.room.roomId = "NEW234";
      const handshake = deferred<typeof obsolete.room>();
      const manager = new ColyseusNetworkManager("http://test", () => first.client);
      const errors = vi.fn();
      manager.subscribe({ onError: errors });
      try {
        if (kind === "resume") await manager.createRoom("Old");
        const method = kind === "create" ? first.client.create : kind === "join" ? first.client.joinById : kind === "quick" ? first.client.joinOrCreate : first.client.reconnect;
        method.mockReturnValueOnce(handshake.promise);
        const old = kind === "create" ? manager.createRoom("Old") : kind === "join" ? manager.joinRoom("ABC234", "Old") : kind === "quick" ? manager.quickMatch("Old") : manager.resume();
        // Attach a handler before rejection, preserving the public failure contract.
        const settled = old.catch(() => "cancelled");
        first.client.create.mockResolvedValue(next.room);
        await manager.createRoom("New");
        const stored = window.sessionStorage.getItem("floor-fifty.session");
        if (failure) handshake.reject(new Error("old handshake failed"));
        else handshake.resolve(obsolete.room);
        const outcome = await settled;
        expect(outcome).not.toBe("resumed");
        expect(outcome).not.toBe("expired");
        if (kind === "resume") expect(outcome).toBe("cancelled");
        expect(manager.roomCode).toBe("NEW234");
        expect(manager.connectionState).toBe("connected");
        expect(window.sessionStorage.getItem("floor-fifty.session")).toBe(stored);
        expect(errors).not.toHaveBeenCalled();
        const snapshots = vi.fn();
        manager.subscribe({ onSnapshot: snapshots });
        next.room.pushState();
        expect(snapshots).toHaveBeenCalledOnce();
      } finally { manager.dispose(); window.sessionStorage.clear(); }
    }
  });

  it("detaches and forgets synchronously while the SDK leave is pending", async () => {
    const first = fakeColyseusClient();
    const next = fakeColyseusClient();
    next.room.roomId = "NEW234";
    const closing = deferred<number>();
    const manager = new ColyseusNetworkManager("http://test", () => first.client);
    try {
      await manager.createRoom("Old");
      vi.spyOn(first.room, "leave").mockReturnValue(closing.promise);
      const leave = manager.leaveRoom();
      expect(manager.connectionState).toBe("offline");
      expect(manager.roomCode).toBeUndefined();
      first.client.create.mockResolvedValue(next.room);
      await manager.createRoom("New");
      const stored = window.sessionStorage.getItem("floor-fifty.session");
      closing.resolve(4000);
      await leave;
      expect(manager.connectionState).toBe("connected");
      expect(manager.roomCode).toBe("NEW234");
      expect(window.sessionStorage.getItem("floor-fifty.session")).toBe(stored);
      next.room.pushState();
      expect(manager.latestSnapshot()).toBeDefined();
    } finally { manager.dispose(); window.sessionStorage.clear(); }
  });

  it("cancels a reconnect backoff before a replacement intent and its deadline", async () => {
    vi.useFakeTimers();
    const first = fakeColyseusClient();
    const next = fakeColyseusClient();
    next.room.roomId = "NEW234";
    first.client.reconnect.mockRejectedValue(new Error("offline"));
    const manager = new ColyseusNetworkManager("http://test", () => first.client);
    const errors = vi.fn();
    manager.subscribe({ onError: errors });
    try {
      await manager.createRoom("Old");
      first.room.emit("leave", 1006);
      await vi.advanceTimersByTimeAsync(1);
      const attempts = first.client.reconnect.mock.calls.length;
      first.client.create.mockResolvedValue(next.room);
      await manager.createRoom("New");
      // A real server answers the client's pings; the fake does not, and a socket silent for
      // SILENT_SOCKET_MS is dropped on purpose (audit S16). So the new room keeps talking.
      for (let second = 0; second < (RECONNECT_GRACE_TICKS * TICK_MS + 3_000) / 1_000; second += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
        next.room.pushState();
      }
      expect(first.client.reconnect).toHaveBeenCalledTimes(attempts);
      expect(manager.roomCode).toBe("NEW234");
      expect(manager.connectionState).toBe("connected");
      expect(errors).not.toHaveBeenCalled();
    } finally { manager.dispose(); vi.useRealTimers(); window.sessionStorage.clear(); }
  });
});


it("ignores callbacks already queued by a retired room, including command replies and close", async () => {
  const first = fakeColyseusClient();
  const next = fakeColyseusClient();
  next.room.roomId = "NEW234";
  const callbacks = new Map<string, (payload: never) => void>();
  const register = first.room.onMessage.bind(first.room);
  vi.spyOn(first.room, "onMessage").mockImplementation((type, handler) => { callbacks.set(type, handler); register(type, handler); });
  let oldState!: () => void;
  let oldClose!: (code: number) => void;
  vi.spyOn(first.room, "onStateChange").mockImplementation((handler) => { oldState = handler; });
  vi.spyOn(first.room, "onLeave").mockImplementation((handler) => { oldClose = handler; });
  const manager = new ColyseusNetworkManager("http://test", () => first.client);
  try {
    await manager.createRoom("Old");
    first.client.create.mockResolvedValue(next.room);
    await manager.createRoom("New");
    const errors = vi.fn();
    const snapshots = vi.fn();
    manager.subscribe({ onError: errors, onSnapshot: snapshots });
    const stored = window.sessionStorage.getItem("floor-fifty.session");
    const pending = manager.setReady(true);
    const requestId = (next.room.sent.at(-1)!.payload as { requestId: string }).requestId;
    callbacks.get("seated")?.({ roomCode: "ABC234", playerId: "old" } as never);
    callbacks.get("serverError")?.({ code: "ROOM_CLOSED", message: "old" } as never);
    callbacks.get("commandResult")?.({ requestId, ok: false, error: { code: "ROOM_CLOSED", message: "old" } } as never);
    callbacks.get("raceEvents")?.([] as never);
    callbacks.get("replay")?.(new Uint8Array([1]) as never);
    oldState();
    oldClose(4000);
    expect(manager.connectionState).toBe("connected");
    expect(manager.roomCode).toBe("NEW234");
    expect(window.sessionStorage.getItem("floor-fifty.session")).toBe(stored);
    expect(errors).not.toHaveBeenCalled();
    expect(snapshots).not.toHaveBeenCalled();
    expect(manager.latestReplay()).toBeUndefined();
    next.room.emit("commandResult", { requestId, ok: true });
    await pending;
  } finally { manager.dispose(); window.sessionStorage.clear(); }
});


it("disposes the transport without surrendering the reload seat", async () => {
  const { client, room } = fakeColyseusClient();
  const manager = new ColyseusNetworkManager("http://test", () => client);
  const leave = vi.spyOn(room, "leave");
  await manager.createRoom("Kite");
  const stored = window.sessionStorage.getItem("floor-fifty.session");
  manager.dispose();
  expect(window.sessionStorage.getItem("floor-fifty.session")).toBe(stored);
  expect(room.connection.close).toHaveBeenCalledOnce();
  expect(leave).not.toHaveBeenCalled();
  window.sessionStorage.clear();
});
