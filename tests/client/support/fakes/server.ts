import { vi } from "vitest";
import type { Client } from "@colyseus/sdk";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { RaceRoomStateView } from "../../../../apps/client/src/features/net/colyseus-network";

/**
 * A schema state as the Colyseus client would hold it.
 *
 * Shaped like `RaceRoomStateView` rather than importing the server's classes:
 * the adapter reads it structurally, so a plain object with real `Map`s for
 * players and platforms is exactly what it sees on the wire.
 */
export function fakeSchemaState(overrides: Partial<RaceRoomStateView> = {}): RaceRoomStateView {
  const players = new Map<string, Record<string, unknown>>([
    [
      "p1",
      {
        id: "p1",
        name: "Kite",
        characterId: "ninja",
        colour: "scarlet",
        x: 120,
        y: 240,
        vx: 12,
        vy: -60,
        grounded: true,
        awaitingInput: false,
        facingRight: true,
        lap: 1,
        progress: 0.25,
        ready: false,
        status: "connected",
        finishedAtTick: -1,
        holdUntilTick: -1,
        lastAckedSequence: 7,
      },
    ],
  ]);
  const platforms = new Map<string, Record<string, unknown>>([
    ["floor-0", { id: "floor-0", index: 0, x: 300, y: 400, direction: 1, collectedBy: ["p1"] }],
  ]);

  return {
    tick: 42,
    phase: "racing",
    seed: 4182,
    round: 0,
    lapCount: 1,
    modeId: "floors-20",
    floorCount: 1,
    hostId: "p1",
    access: "private",
    startsAtTick: -1,
    soloFromTick: -1,
    countdownEndsAtTick: -1,
    raceStartedAtTick: 0,
    contentRevision: "a".repeat(64),
    rulesetRevision: "b".repeat(64),
    roomSeed: 4182,
    stageId: "",
    courseRevision: "",
    songId: "",
    select: {
      step: "",
      endsAtTick: -1,
      picks: new Map<string, { focus: string; locked: boolean; seed: string }>(),
      stageId: "",
      stagePickedBy: "",
      stageSeed: -1,
      stageClassic: false,
      songId: "",
      songPickedBy: "",
      loaded: [],
    },
    winnerId: "",
    tuning: { ...resolveTuning(), GRAVITY: -275 },
    players,
    platforms,
    standings: [],
    ...overrides,
  };
}

/** What a Colyseus room looks like from the adapter's side, plus the recording. */
export type FakeColyseusRoom = {
  roomId: string;
  sessionId: string;
  reconnectionToken: string;
  /** The 0.18 SDK's own reconnect loop; the adapter must turn it off. */
  reconnection: { enabled: boolean };
  state: unknown;
  connection: { isOpen: boolean; close: ReturnType<typeof vi.fn> };
  sent: { type: string; payload: unknown }[];
  send(type: string, payload?: unknown): void;
  onMessage(type: string, handler: (payload: never) => void): void;
  onStateChange(handler: () => void): void;
  onLeave(handler: (code: number) => void): void;
  leave(consented?: boolean): Promise<number>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  /** Fires a registered message listener, or the leave listener for `"leave"`. */
  emit(type: string, payload?: unknown): void;
  /** Fires every state listener with a fresh state, optionally changed. */
  pushState(overrides?: Partial<RaceRoomStateView>): void;
};

/** The SDK client, with the three calls the adapter makes under test. */
export type FakeColyseusClient = Client & {
  create: ReturnType<typeof vi.fn>;
  joinById: ReturnType<typeof vi.fn>;
  joinOrCreate: ReturnType<typeof vi.fn>;
  reconnect: ReturnType<typeof vi.fn>;
};

/**
 * A Colyseus client and room that record rather than connect.
 *
 * `seated` is delivered as soon as its handler is registered, because the
 * server defers that message to the first tick after a join and a test should
 * not have to step a clock to learn its own identity. Set announceSeat false
 * to exercise the gap between the handshake and that deferred message.
 */
export function fakeColyseusClient(options: { announceSeat?: boolean } = {}): {
  client: FakeColyseusClient;
  room: FakeColyseusRoom;
} {
  const messageHandlers = new Map<string, (payload: never) => void>();
  const stateHandlers: (() => void)[] = [];
  const leaveHandlers: ((code: number) => void)[] = [];
  let state: RaceRoomStateView = fakeSchemaState();

  const room: FakeColyseusRoom = {
    roomId: "ABC234",
    sessionId: "s1",
    reconnectionToken: "reconnection-token-1",
    reconnection: { enabled: true },
    connection: { isOpen: true, close: vi.fn() },
    get state() {
      return state;
    },
    sent: [],
    send(type, payload) {
      room.sent.push({ type, payload });
    },
    onMessage(type, handler) {
      messageHandlers.set(type, handler);
      if (type === "seated" && options.announceSeat !== false) handler({ playerId: "p1", roomCode: room.roomId } as never);
    },
    onStateChange(handler) {
      stateHandlers.push(handler);
    },
    onLeave(handler) {
      leaveHandlers.push(handler);
    },
    // The SDK's own order: a consented leave invokes every `onLeave` handler
    // with 4000 before the promise resolves, and a handler that reads that as
    // a drop starts reconnecting to a seat the server has already freed.
    async leave(consented = true) {
      const code = consented ? 4000 : 1006;
      for (const handler of [...leaveHandlers]) handler(code);
      return code;
    },
    removeAllListeners: vi.fn(() => {
      messageHandlers.clear();
      stateHandlers.length = 0;
      leaveHandlers.length = 0;
    }),
    emit(type, payload) {
      if (type === "leave") {
        for (const handler of [...leaveHandlers]) handler(payload as number);
        return;
      }
      messageHandlers.get(type)?.(payload as never);
    },
    pushState(overrides = {}) {
      state = fakeSchemaState(overrides);
      for (const handler of [...stateHandlers]) handler();
    },
  };

  const client = {
    create: vi.fn(async () => room),
    joinById: vi.fn(async () => room),
    joinOrCreate: vi.fn(async () => room),
    reconnect: vi.fn(async () => room),
  } as unknown as FakeColyseusClient;

  return { client, room };
}
