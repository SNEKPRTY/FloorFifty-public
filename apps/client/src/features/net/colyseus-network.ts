/**
 * The Colyseus implementation of the network port.
 *
 * It carries intent out and authority in, and owns the reconnection token that
 * makes a reload survivable. It computes nothing about the race: every value a
 * screen renders came off the wire.
 *
 * `schemaToSnapshot` is the seam that lets the rest of the client stay exactly
 * as it was. Colyseus's schema objects are mutable and are patched in place,
 * which is right for a transport and wrong for a renderer that compares a
 * sample against the one before it and for a prediction that rebuilds a race
 * from a fixed moment. Projecting to a plain `RoomSnapshot` is an
 * anti-corruption boundary, not a second protocol: `RoomSnapshot` is what
 * every consumer already reads.
 */

import { Client, type Room } from "@colyseus/sdk";
import {
  DEFAULT_CLOCK_SECONDS,
  DEFAULT_MODE_ID,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_TICKS,
  TICK_MS,
} from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type {
  IdleWarning,
  InputFrame,
  PlatformSnapshot,
  PlayerSnapshot,
  RaceEvent,
  RoomSnapshot,
  ServerError,
} from "@floor-fifty/shared/common/protocol";
import {
  CLIENT_MESSAGES,
  DEVICE_CLASSES,
  SERVER_MESSAGES,
  type CommandResult,
  type DeviceClass,
  type Ping,
  type Pong,
} from "@floor-fifty/shared/common/protocol";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { seedChoiceFromWire, type SeedChoice, type SelectSnapshot, type SelectStep } from "@floor-fifty/shared/room/select";
import type { ConnectionState, NetworkError, NetworkListeners, NetworkPort, ResumeOutcome } from "./network";
import { SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";
import { CLIENT_BUILD } from "../../lib/build-facts";

/** Sent with every join, so the room can tell a stale tab from a skewed one (release readiness §4.2). */
const BUILD_JOIN_FACTS = { buildId: CLIENT_BUILD.buildId, rulesetRevision: CLIENT_BUILD.rulesetRevision };

/** Absent, for an optional tick. Mirrors the server's documented sentinel. */
const ABSENT_TICK = -1;
const ABSENT_ID = "";

/**
 * Where the reconnection token lives.
 *
 * Session storage, never local storage and never the URL: it is a bearer
 * credential for one seat, and a URL is copied, shared and logged.
 */
const TOKEN_KEY = "floor-fifty.session";

type StoredSession = { roomCode: string; playerId: string; reconnectionToken: string };

/**
 * What this adapter reads off the schema.
 *
 * Structural rather than an import of the server's classes: the client has no
 * business depending on a server module, and a structural type is also what
 * lets a test hand in a plain object.
 */
export type RaceRoomStateView = {
  tick: number;
  phase: string;
  seed: number;
  round: number;
  lapCount: number;
  modeId: string;
  /** Absent on a patch from before the first projection. */
  clockSeconds?: number;
  floorCount: number;
  hostId: string;
  /** `"public"` or `"private"`; anything else is read as private. */
  access: string;
  startsAtTick: number;
  soloFromTick: number;
  countdownEndsAtTick: number;
  raceStartedAtTick: number;
  contentRevision: string;
  rulesetRevision: string;
  winnerId: string;
  tuning: Record<string, number>;
  players: { values(): Iterable<Record<string, unknown>> };
  platforms: { values(): Iterable<Record<string, unknown>> };
  standings: Iterable<string>;
  roomSeed: number;
  stageId: string;
  courseRevision: string;
  /** The race's song; "" until the song reveal. */
  songId: string;
  /** The select phase; `step` is "" outside it. */
  select: {
    step: string;
    endsAtTick: number;
    picks: { entries(): Iterable<[string, { focus: string; locked: boolean; seed: string }]> };
    stageId: string;
    stagePickedBy: string;
    /** −1 until the roulette lands. */
    stageSeed: number;
    stageClassic: boolean;
    songId: string;
    songPickedBy: string;
    loaded: Iterable<string>;
  };
};

export function schemaToSnapshot(
  state: RaceRoomStateView,
  events: readonly RaceEvent[],
): RoomSnapshot {
  const players: PlayerSnapshot[] = [...state.players.values()].map((row) => {
    const player: PlayerSnapshot = {
      id: asPlayerId(row["id"] as string),
      name: row["name"] as string,
      characterId: row["characterId"] as string,
      colour: SEAT_COLOURS.includes(row["colour"] as SeatColour) ? (row["colour"] as SeatColour) : "scarlet",
      deviceClass: DEVICE_CLASSES.includes(row["deviceClass"] as DeviceClass) ? (row["deviceClass"] as DeviceClass) : "desktop",
      cpu: row["cpu"] === true,
      x: row["x"] as number,
      y: row["y"] as number,
      vx: row["vx"] as number,
      vy: row["vy"] as number,
      grounded: row["grounded"] as boolean,
      awaitingInput: row["awaitingInput"] as boolean,
      lastAckedSequence: row["lastAckedSequence"] as number,
      facingRight: row["facingRight"] as boolean,
      lap: row["lap"] as number,
      progress: row["progress"] as number,
      ready: row["ready"] as boolean,
      status: row["status"] as PlayerSnapshot["status"],
      // Absent from a room older than the race options.
      bestFloor: (row["bestFloor"] as number | undefined) ?? 0,
      // Absent from a room older than Survival (survival spec §3).
      floorEdgeY: (row["floorEdgeY"] as number | undefined) ?? 0,
    };
    if (row["outAtTick"] !== undefined && row["outAtTick"] !== ABSENT_TICK) {
      player.outAtTick = row["outAtTick"] as number;
    }
    // Zero, or absent from a room older than the wait (first-race spec §2), is a racer whose edge never waited.
    if (typeof row["edgeWaitTicks"] === "number" && row["edgeWaitTicks"] > 0) {
      player.edgeWaitTicks = row["edgeWaitTicks"];
    }
    if (row["bestFloorAtTick"] !== undefined && row["bestFloorAtTick"] !== ABSENT_TICK) {
      player.bestFloorAtTick = row["bestFloorAtTick"] as number;
    }
    // Assigned rather than spread, because a spread of an empty-or-one-property
    // object widens the field to `number | undefined` and this project refuses
    // an optional property that may be explicitly undefined.
    if (row["finishedAtTick"] !== ABSENT_TICK) {
      player.finishedAtTick = row["finishedAtTick"] as number;
    }
    // Absent from a room older than the hold, and ABSENT_TICK when not held.
    if (row["holdUntilTick"] !== undefined && row["holdUntilTick"] !== ABSENT_TICK) {
      player.holdUntilTick = row["holdUntilTick"] as number;
    }
    return player;
  });

  const platforms: PlatformSnapshot[] = [...state.platforms.values()].map((row) => ({
    id: row["id"] as string,
    x: row["x"] as number,
    y: row["y"] as number,
    direction: (row["direction"] as number) >= 0 ? 1 : -1,
    collectedBy: [...(row["collectedBy"] as Iterable<string>)].map(asPlayerId),
  }));

  const snapshot: RoomSnapshot = {
    tick: state.tick,
    phase: state.phase as RoomSnapshot["phase"],
    seed: state.seed,
    roomSeed: state.roomSeed,
    round: state.round,
    courseRevision: state.courseRevision,
    tuning: { ...state.tuning } as unknown as ResolvedTuning,
    contentRevision: state.contentRevision as RoomSnapshot["contentRevision"],
    rulesetRevision: state.rulesetRevision as RoomSnapshot["rulesetRevision"],
    floorCount: state.floorCount,
    lapCount: state.lapCount as RoomSnapshot["lapCount"],
    // Absent only on a patch from before the first projection.
    modeId: state.modeId === ABSENT_ID || state.modeId === undefined ? DEFAULT_MODE_ID : state.modeId,
    clockSeconds: state.clockSeconds ?? DEFAULT_CLOCK_SECONDS,
    hostId: asPlayerId(state.hostId),
    access: state.access === "public" ? "public" : "private",
    players,
    platforms,
    events,
    standings: [...state.standings].map(asPlayerId),
  };

  if (state.countdownEndsAtTick !== ABSENT_TICK) {
    snapshot.countdownEndsAtTick = state.countdownEndsAtTick;
  }
  if (state.startsAtTick !== ABSENT_TICK) snapshot.startsAtTick = state.startsAtTick;
  if (state.soloFromTick !== ABSENT_TICK) snapshot.soloFromTick = state.soloFromTick;
  if (state.raceStartedAtTick !== ABSENT_TICK) {
    snapshot.raceStartedAtTick = state.raceStartedAtTick;
  }
  if (state.winnerId !== ABSENT_ID) {
    snapshot.winnerId = asPlayerId(state.winnerId);
  }
  if (state.stageId !== ABSENT_ID) snapshot.stageId = state.stageId;
  if (state.songId !== ABSENT_ID) snapshot.songId = state.songId;
  if (state.select.step !== ABSENT_ID) {
    const select: SelectSnapshot = {
      step: state.select.step as SelectStep,
      endsAtTick: state.select.endsAtTick,
      picks: Object.fromEntries(
        [...state.select.picks.entries()].map(([id, pick]) => [id, { focus: pick.focus, locked: pick.locked, seed: seedChoiceFromWire(pick.seed) }]),
      ),
      loaded: [...state.select.loaded],
    };
    if (state.select.stageId !== ABSENT_ID) {
      select.stage = {
        id: state.select.stageId,
        pickedBy: asPlayerId(state.select.stagePickedBy),
        // −1 until the roulette lands (stage seeds spec §3.2).
        ...(state.select.stageSeed >= 0 ? { seed: state.select.stageSeed, classic: state.select.stageClassic } : {}),
      };
    }
    if (state.select.songId !== ABSENT_ID) {
      select.song = { id: state.select.songId, pickedBy: asPlayerId(state.select.songPickedBy) };
    }
    snapshot.select = select;
  }

  return snapshot;
}

export type ColyseusClientFactory = (url: string) => Client;

const defaultFactory: ColyseusClientFactory = (url) => new Client(url);

/**
 * The code a matchmaking refusal means, from the words the library or the room used.
 *
 * A wrong room code is said only for the library's own "not found" answer.
 * Anything else the code does not recognise -- the server down, a 502, the
 * phone offline, the origin refused -- is `UNREACHABLE`, so a player who typed
 * no code is never told theirs is wrong (audit S7).
 */
function refusalCode(error: unknown): ServerError["code"] {
  const message = error instanceof Error ? error.message : String(error);
  // The server's own refusals first (shared `refusals.ts`): "the server is
  // full" must not read as a full room.
  return /server is updating/i.test(message)
    ? "SERVER_UPDATING"
    : /server is full/i.test(message)
      ? "SERVER_BUSY"
      : /too many requests/i.test(message)
        ? "RATE_LIMITED"
        : /protocol version|out of date/i.test(message)
          ? "VERSION_MISMATCH"
          : /full|locked/i.test(message)
            ? "ROOM_FULL"
            : /racing|closed|disposed/i.test(message)
              ? "ROOM_CLOSED"
              : /not found|no rooms found|invalid room/i.test(message)
                ? "INVALID_ROOM"
                : "UNREACHABLE";
}

/**
 * The wait before reconnect attempt `attempt`: 250 ms doubling to a 2 s
 * ceiling. The climbing steps are spread by ±25%, so a server restart does not
 * bring every client back on the same beat (release readiness, appendix C).
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(250 * 2 ** attempt, 2_000);
  return base === 2_000 ? base : base * (0.75 + 0.5 * random());
}

/**
 * A refusal, as the client carries it. The words a player reads are chosen
 * from the code when shown (`features/screen/error-copy.ts`); the server's own message is
 * for its log. A refused seat or command that says the room is closed means
 * its race has started, which the detail keeps.
 */
function forPlayer(error: ServerError): NetworkError {
  return error.code === "ROOM_CLOSED" ? { ...error, detail: "room-racing" } : error;
}

/**
 * A per-page-load prefix for request IDs.
 *
 * The room keeps the last 64 answers per Colyseus session, and a session
 * survives a reconnect. Numbering from `c1` on every load meant a reloaded
 * client's first commands collided with stored answers and did nothing.
 */
const LOAD_TOKEN = (() => {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
})();
let requestCounter = 0;

/**
 * How often the room is probed while seated.
 *
 * Once a second is nothing on the wire and enough that, by the time a race
 * starts, the round trip is known -- which is what lets a race set its input
 * lead on the first tick instead of running its first inputs late while its
 * own probes are still in flight.
 */
const BACKGROUND_PING_MS = 1_000;

/**
 * How long a connected socket may hear nothing from the server before the
 * client treats it as dead and reconnects (audit S16). The client pings every
 * second and the server answers each, so silence this long is a stalled link,
 * not a quiet room. Without it the badge said connected while the race froze,
 * until the system killed the socket, usually after the server's 30 second
 * grace, when the seat was gone. The Owner's number (2026-11-14): 8 seconds.
 */
export const SILENT_SOCKET_MS = 8_000;
/** How often the watchdog looks. */
const SILENT_CHECK_MS = 2_000;

/** Round trips remembered for the estimate. The median of these is the answer. */
const RTT_SAMPLES = 7;

/**
 * Close codes that end a seat rather than interrupt it.
 *
 * 1000 is a clean close. 4000 is Colyseus's "consented": the client left, or
 * the server let it go on purpose. Either way the server has freed the seat
 * and holds no reconnection for it, so trying to reclaim one only produces
 * thirty seconds of "reconnecting" and then a false "you lost your seat".
 * 4001 is a server shutting down (Colyseus 0.18): the process and its rooms
 * are going, so there is no seat left to reclaim either.
 * Everything else -- 1006 above all, a socket that died without a close frame
 * -- is a drop, and a drop is what the grace window exists for.
 */
const NORMAL_CLOSE = 1000;
const CONSENTED_CLOSE = 4000;
const SERVER_SHUTDOWN_CLOSE = 4001;

export class ColyseusNetworkManager implements NetworkPort {
  private room: Room | undefined;
  private session: StoredSession | undefined;
  private snapshot: RoomSnapshot | undefined;
  /** The latest replay the room sent, until the next race counts down or the room is left. */
  private replay: Uint8Array | undefined;
  /** The last finished snapshot, with the replay's lifetime. */
  private finished: RoomSnapshot | undefined;
  private snapshotReceivedAt: number | undefined;
  /** What this device may pick; rides in the join options and in `reportAccess`. */
  private access: AccessSets | undefined;
  /**
   * The access this room last heard, as JSON: the join options count as a
   * report. An unlock earned mid-round is sent once the room is back in the
   * lobby, so it counts in the next round.
   */
  private reportedAccess: string | undefined;
  private state: ConnectionState = "offline";
  private readonly subscribers = new Set<Partial<NetworkListeners>>();
  private readonly pending = new Map<string, { resolve(): void; reject(error: unknown): void }>();
  /** Events awaiting the state change that explains them. */
  private pendingEvents: RaceEvent[] = [];
  private detach: (() => void) | undefined;
  /** One user intent owns all its handshakes, retries and room callbacks. */
  private generation = 0;
  private disposed = false;
  private cancelRetry: (() => void) | undefined;

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private invalidate(reason = "the connection was replaced"): number {
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.detach?.();
    this.detach = undefined;
    this.rejectPending(reason);
    this.pendingEvents = [];
    return this.generation;
  }

  private beginJoin(): number {
    const previous = this.room;
    const generation = this.invalidate();
    this.forget();
    this.snapshot = undefined;
    this.replay = undefined;
    this.finished = undefined;
    if (previous !== undefined) void previous.leave(true).catch(() => undefined);
    if (this.current(generation)) this.setState("connecting");
    return generation;
  }

  private adoptIfCurrent(room: Room, generation: number): boolean {
    if (!this.current(generation)) {
      void room.leave(true).catch(() => undefined);
      return false;
    }
    this.adopt(room, generation);
    return true;
  }
  private pingId = 0;
  /** When each outstanding probe was sent, by id. */
  private readonly pingsSent = new Map<number, number>();
  private readonly roundTrips: number[] = [];
  private lastPingAt = Number.NEGATIVE_INFINITY;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  /** Every byte the room sockets have delivered, across reconnects. */
  private bytesIn = 0;

  constructor(
    private readonly url: string,
    private readonly createClient: ColyseusClientFactory = defaultFactory,
  ) {
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.handleBrowserOffline);
    }
  }

  /**
   * The browser knows the network is gone before the socket does.
   *
   * Closing the transport is what makes the server see a drop and start
   * holding the seat; without it a socket can look open until the operating
   * system notices, and the thirty-second window -- which the player needs to
   * come back inside -- starts late or never. Socket.IO did this for us; here
   * it is the adapter's job.
   */
  private readonly handleBrowserOffline = (): void => {
    if (this.session === undefined) return;
    this.setState("reconnecting");
    this.room?.connection?.close();
  };

  get connectionState(): ConnectionState {
    return this.state;
  }
  get localPlayerId(): string | undefined {
    return this.session?.playerId;
  }
  get roomCode(): string | undefined {
    return this.session?.roomCode;
  }

  latestSnapshot(): RoomSnapshot | undefined {
    return this.snapshot;
  }

  latestReplay(): Uint8Array | undefined {
    return this.replay;
  }

  latestFinished(): RoomSnapshot | undefined {
    return this.finished;
  }

  latestSnapshotReceivedAt(): number | undefined {
    return this.snapshotReceivedAt;
  }

  wireBytesIn(): number {
    return this.bytesIn;
  }

  roundTripMs(): number | undefined {
    if (this.roundTrips.length === 0) return undefined;
    const sorted = [...this.roundTrips].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  subscribe(listeners: Partial<NetworkListeners>): () => void {
    this.subscribers.add(listeners);
    return () => this.subscribers.delete(listeners);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.subscribers]) listener.onConnectionState?.(state);
  }

  private publish(): void {
    const room = this.room;
    if (room === undefined) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.snapshot = schemaToSnapshot(room.state as unknown as RaceRoomStateView, events);
    this.snapshotReceivedAt = performance.now();
    // A replay is the last race's: the next one counting down retires it.
    if (this.snapshot.phase === "countdown" || this.snapshot.phase === "racing") {
      this.replay = undefined;
      this.finished = undefined;
    }
    if (this.snapshot.phase === "finished") this.finished = this.snapshot;
    for (const listener of [...this.subscribers]) listener.onSnapshot?.(this.snapshot);
    this.reportAccessIfStale();
  }

  /**
   * Attaches every listener to one room instance.
   *
   * Reconnecting produces a *new* room object, so the previous one's listeners
   * would otherwise keep a dead schema alive and publish from it.
   */
  private adopt(room: Room, generation: number): void {
    const current = (): boolean => this.current(generation) && this.room === room;
    // When this socket last delivered anything at all (audit S16).
    let heardAt = performance.now();
    const heard = (): void => {
      heardAt = performance.now();
    };
    if (this.room !== undefined) this.rejectPending("the connection was replaced");
    this.detach?.();
    this.room = room;
    // A drain notice belongs to the room that sent it, never to this one.
    this.movedOn = undefined;
    // The 0.18 SDK retries a dropped socket by itself and reports `onDrop`
    // meanwhile. Ours reconnects from `onLeave` with the stored token, which
    // also survives a reload, so the SDK's loop stays off.
    room.reconnection.enabled = false;

    room.onMessage("seated", (payload: { playerId: string; roomCode: string }) => {
      if (!current()) return;
      this.remember(payload, room.reconnectionToken);
    });

    room.onMessage(SERVER_MESSAGES.commandResult, (result: CommandResult) => {
      if (!current()) return;
      const waiting = this.pending.get(result.requestId);
      if (waiting === undefined) return;
      this.pending.delete(result.requestId);
      if (result.ok) {
        waiting.resolve();
        return;
      }
      const refusal = forPlayer(result.error);
      for (const listener of [...this.subscribers]) listener.onError?.(refusal);
      waiting.reject(Object.assign(new Error(refusal.message), refusal));
    });

    // Broadcast with `afterNextPatch`, so the state that explains a cue has
    // already been applied by the time this runs. It is published immediately
    // rather than held for the next state change, which may be 50ms away.
    room.onMessage(SERVER_MESSAGES.raceEvents, (batch: RaceEvent[]) => {
      if (!current()) return;
      this.pendingEvents.push(...batch);
      this.publish();
    });

    // Answered at once by the room, never after a patch: the time it took is
    // the measurement.
    room.onMessage(SERVER_MESSAGES.pong, (pong: Pong) => {
      heard();
      if (!current()) return;
      const sentAt = this.pingsSent.get(pong.id);
      if (sentAt === undefined) return;
      this.pingsSent.delete(pong.id);
      const rttMs = performance.now() - sentAt;
      this.roundTrips.push(rttMs);
      if (this.roundTrips.length > RTT_SAMPLES) this.roundTrips.shift();
      for (const listener of [...this.subscribers]) {
        listener.onPong?.({ id: pong.id, rttMs, slack: pong.slack });
      }
    });

    room.onMessage(SERVER_MESSAGES.serverError, (error: ServerError) => {
      if (!current()) return;
      // A draining server says so, then closes the room (release readiness
      // §5.4). Held until the close, so the player hears one thing -- the
      // server is updating -- rather than that and then "the room closed".
      if (error.code === "SERVER_UPDATING") {
        this.movedOn = error;
        return;
      }
      for (const listener of [...this.subscribers]) listener.onError?.(error);
    });

    // A room nobody is using is about to close, or was kept open (audit B1).
    room.onMessage(SERVER_MESSAGES.idleWarning, (warning: IdleWarning) => {
      if (!current()) return;
      for (const listener of [...this.subscribers]) listener.onIdleWarning?.(warning);
    });

    // The finished race's replay, as bytes (race-options spec §6.4). Copied,
    // because the SDK hands a view into its receive buffer.
    room.onMessage(SERVER_MESSAGES.replay, (bytes: Uint8Array) => {
      if (!current()) return;
      const replay = new Uint8Array(bytes);
      this.replay = replay;
      for (const listener of [...this.subscribers]) listener.onReplay?.(replay);
    });

    room.onStateChange(() => {
      heard();
      if (current()) this.publish();
    });

    // Counted off the socket itself, because the SDK decodes a patch before
    // anything here sees it and a decoded schema has no size.
    const socket = (room.connection as unknown as { transport?: { ws?: EventTarget } } | undefined)
      ?.transport?.ws;
    const countBytes = (event: Event): void => {
      if (!current()) return;
      heard();
      const data = (event as MessageEvent).data as unknown;
      if (data instanceof ArrayBuffer) this.bytesIn += data.byteLength;
      else if (ArrayBuffer.isView(data)) this.bytesIn += data.byteLength;
      else if (typeof data === "string") this.bytesIn += data.length;
    };
    socket?.addEventListener?.("message", countBytes);

    room.onLeave((code: number) => {
      if (!current()) return;
      // Explicit leave detaches synchronously; only this owned room can report a close.
      if (this.session === undefined || code === NORMAL_CLOSE) {
        this.setState("offline");
        return;
      }
      // The server moved this room on for a deploy: there is no seat to
      // reclaim, and the next room is a fresh join on the new build.
      // The detail names the way back: Find a race for a public room, Create
      // room for a private one.
      const movedOn = this.movedOn;
      if (movedOn !== undefined) {
        this.movedOn = undefined;
        const detail = this.snapshot?.access === "public" ? "server-moving-public" : "server-moving-private";
        this.forget();
        this.setState("offline");
        for (const listener of [...this.subscribers]) listener.onError?.({ ...movedOn, detail });
        return;
      }
      // The server ended the seat on purpose, or is shutting down. It is not
      // holding it, so there is nothing to reclaim; say so now rather than
      // after thirty seconds.
      if (code === CONSENTED_CLOSE || code === SERVER_SHUTDOWN_CLOSE) {
        this.forget();
        this.setState("offline");
        for (const listener of [...this.subscribers]) {
          listener.onError?.({ code: "ROOM_CLOSED", message: "The room was closed." });
        }
        return;
      }
      this.setState("reconnecting");
      void this.attemptReconnect(this.invalidate());
    });

    // A probe a second while seated, skipped whenever the race is already
    // probing, so the round trip is known before the race needs it.
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!current() || performance.now() - this.lastPingAt < BACKGROUND_PING_MS) return;
      this.sendPing(-1);
    }, BACKGROUND_PING_MS);
    (this.pingTimer as { unref?: () => void }).unref?.();

    // A socket that is open but silent is dropped, so the reconnect starts now
    // and not after the system notices (audit S16). A hidden tab is not held to
    // account: the browser slows its timers and sockets, and what was lost to
    // that is not counted once the tab is back.
    const returned = (): void => {
      if (!document.hidden) heard();
    };
    document.addEventListener("visibilitychange", returned);
    const watchdog = setInterval(() => {
      if (!current() || this.state !== "connected" || document.hidden) return;
      if (performance.now() - heardAt <= SILENT_SOCKET_MS) return;
      // The reconnect starts here, not from `onLeave`: on a stalled link the
      // browser waits for a closing handshake that never comes (about 60 s in
      // Chromium), past the server's 30 s hold on the seat. Moving to a new
      // generation first detaches the old room, so its late close starts nothing.
      const next = this.invalidate();
      room.connection?.close();
      if (this.session === undefined) {
        this.setState("offline");
        return;
      }
      this.setState("reconnecting");
      void this.attemptReconnect(next);
    }, SILENT_CHECK_MS);
    (watchdog as { unref?: () => void }).unref?.();

    this.detach = () => {
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", returned);
      if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      socket?.removeEventListener?.("message", countBytes);
      room.removeAllListeners();
      if (this.room === room) this.room = undefined;
    };
    this.setState("connected");
  }

  private remember(seat: { playerId: string; roomCode: string }, token: string): void {
    this.session = { ...seat, reconnectionToken: token };
    try {
      window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.session));
    } catch {
      // Private browsing and blocked storage both throw; a missing token only
      // costs the player a reconnect, so it must not break the client.
    }
  }

  private forget(): void {
    this.session = undefined;
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // See above.
    }
  }

  /** Settles every command still waiting, so no caller hangs on a lost answer. */
  private rejectPending(reason: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) entry.reject(new Error(reason));
  }

  private command(type: string, payload: Record<string, unknown>): Promise<void> {
    const room = this.room;
    if (room === undefined) return Promise.reject(new Error("not connected to a room"));

    const requestId = `${LOAD_TOKEN}-c${(requestCounter += 1)}`;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      room.send(type, { ...payload, requestId });
    });
  }

  /**
   * Translates a matchmaking refusal into an error the recovery view renders.
   *
   * Colyseus refuses before a room exists, so there is no room to deliver a
   * `serverError` through: the rejection is all there is, and the recovery
   * view already knows what to do with each of these codes. Every one is said
   * in the game's terms: even a version mismatch, whose server message names
   * protocol numbers a player can do nothing with. The reload is the panel's.
   */
  private refused(error: unknown): never {
    const failure = forPlayer({ code: refusalCode(error), message: error instanceof Error ? error.message : String(error) });
    for (const listener of [...this.subscribers]) listener.onError?.(failure);
    this.setState("offline");
    throw Object.assign(new Error(failure.message), failure);
  }

  async createRoom(name: string): Promise<void> {
    const generation = this.beginJoin();
    if (!this.current(generation)) return;
    const client = this.createClient(this.url);
    try {
      this.adoptIfCurrent(await client.create("race", { name, protocolVersion: PROTOCOL_VERSION, ...this.accessOptions(), ...this.colourOptions(), deviceClass: this.deviceClass, ...BUILD_JOIN_FACTS }), generation);
    } catch (error) {
      if (this.current(generation)) this.refused(error);
    }
  }

  async joinRoom(code: string, name: string): Promise<void> {
    const generation = this.beginJoin();
    if (!this.current(generation)) return;
    const client = this.createClient(this.url);
    try {
      this.adoptIfCurrent(await client.joinById(code, { name, protocolVersion: PROTOCOL_VERSION, ...this.accessOptions(), ...this.colourOptions(), deviceClass: this.deviceClass, ...BUILD_JOIN_FACTS }), generation);
    } catch (error) {
      if (this.current(generation)) this.refused(error);
    }
  }

  async quickMatch(name: string): Promise<void> {
    const generation = this.beginJoin();
    if (!this.current(generation)) return;
    const client = this.createClient(this.url);
    const options = {
      name,
      protocolVersion: PROTOCOL_VERSION,
      quickMatch: true,
      ...this.accessOptions(),
      ...this.colourOptions(),
      deviceClass: this.deviceClass,
      ...BUILD_JOIN_FACTS,
    };
    try {
      this.adoptIfCurrent(await this.findOrOpen(client, options, generation), generation);
    } catch (error) {
      if (this.current(generation)) this.refused(error);
    }
  }

  /**
   * `joinOrCreate`, once more if the room it offered closed or filled between
   * being offered and being joined (quick-match spec §4.2). By then the room is
   * unlisted, so the second try finds another room or opens one.
   */
  private async findOrOpen(client: Client, options: Record<string, unknown>, generation: number): Promise<Room> {
    try {
      return await client.joinOrCreate("race", options);
    } catch (error) {
      const code = refusalCode(error);
      if (!this.current(generation) || (code !== "ROOM_CLOSED" && code !== "ROOM_FULL")) throw error;
      return client.joinOrCreate("race", options);
    }
  }

  private colourSource: () => SeatColour | undefined = () => undefined;
  /** This device's class, decided once at boot (unlockables spec §3). */
  private deviceClass: DeviceClass = "desktop";
  /** A draining server's word, held until it closes this room (release readiness §5.4). */
  private movedOn: ServerError | undefined;

  setDeviceClass(deviceClass: DeviceClass): void {
    this.deviceClass = deviceClass;
  }

  setColourSource(source: () => SeatColour | undefined): void {
    this.colourSource = source;
  }

  /** The remembered colour as a join option, read at the moment of joining. */
  private colourOptions(): { colour?: SeatColour } {
    const colour = this.colourSource();
    return colour === undefined ? {} : { colour };
  }

  /** The access report as join options, absent until this device has one; joining is the new room's report. */
  private accessOptions(): { access?: AccessSets } {
    this.reportedAccess = this.access === undefined ? undefined : JSON.stringify(this.access);
    return this.access === undefined ? {} : { access: this.access };
  }

  setAccess(access: AccessSets): void {
    this.access = access;
    this.reportAccessIfStale();
  }

  /** While the room is in the lobby, tells it of an access it has not heard. */
  private reportAccessIfStale(): void {
    const access = this.access;
    if (access === undefined || this.room === undefined || this.snapshot?.phase !== "lobby") return;
    const report = JSON.stringify(access);
    if (report === this.reportedAccess) return;
    this.reportedAccess = report;
    // A refused or lost report is forgotten, so the next lobby snapshot sends it again.
    const generation = this.generation;
    void this.command(CLIENT_MESSAGES.reportAccess, { access }).catch(() => {
      if (this.current(generation) && this.reportedAccess === report) this.reportedAccess = undefined;
    });
  }

  pickCharacter(characterId: string): Promise<void> {
    return this.command(CLIENT_MESSAGES.pickCharacter, { characterId });
  }

  pickColour(colour: SeatColour): Promise<void> {
    return this.command(CLIENT_MESSAGES.pickColour, { colour });
  }

  addCpu(): Promise<void> {
    return this.command(CLIENT_MESSAGES.addCpu, {});
  }

  removeCpu(playerId: string): Promise<void> {
    return this.command(CLIENT_MESSAGES.removeCpu, { playerId });
  }

  pickStage(stageId: string): Promise<void> {
    return this.command(CLIENT_MESSAGES.pickStage, { stageId });
  }

  pickSeed(seed: SeedChoice): Promise<void> {
    return this.command(CLIENT_MESSAGES.pickSeed, { seed });
  }

  pickSong(songId: string): Promise<void> {
    return this.command(CLIENT_MESSAGES.pickSong, { songId });
  }

  lockIn(): Promise<void> {
    return this.command(CLIENT_MESSAGES.lockIn, {});
  }

  loaded(): Promise<void> {
    return this.command(CLIENT_MESSAGES.loaded, {});
  }

  setReady(ready: boolean): Promise<void> {
    return this.command(CLIENT_MESSAGES.setReady, { ready });
  }

  setLapCount(lapCount: 1 | 3): Promise<void> {
    return this.command(CLIENT_MESSAGES.setLapCount, { lapCount });
  }

  setClock(seconds: number): Promise<void> {
    return this.command(CLIENT_MESSAGES.setClock, { seconds });
  }

  setMode(modeId: string): Promise<void> {
    return this.command(CLIENT_MESSAGES.setMode, { modeId });
  }

  /**
   * Sends an input frame.
   *
   * Fire-and-forget: a frame is only meaningful for the tick it belongs to, so
   * waiting for a result would delay the next one. The server drops what it
   * cannot accept and the next patch corrects the client.
   */
  sendInput(input: InputFrame): void {
    this.room?.send(CLIENT_MESSAGES.input, input);
  }

  sendPing(tick: number): number | undefined {
    const room = this.room;
    if (room === undefined || this.state !== "connected") return undefined;
    this.pingId += 1;
    const id = this.pingId;
    this.lastPingAt = performance.now();
    this.pingsSent.set(id, this.lastPingAt);
    // Unanswered probes -- a drop, a reconnect -- are forgotten, not kept.
    if (this.pingsSent.size > 16) this.pingsSent.delete(this.pingsSent.keys().next().value!);
    const ping: Ping = { id, tick: Number.isFinite(tick) ? tick : -1 };
    room.send(CLIENT_MESSAGES.ping, ping);
    return id;
  }

  raceAgain(): Promise<void> {
    return this.command(CLIENT_MESSAGES.raceAgain, {});
  }

  getReplay(): Promise<void> {
    return this.command(CLIENT_MESSAGES.getReplay, {});
  }

  keepRoomOpen(): Promise<void> {
    return this.command(CLIENT_MESSAGES.stillHere, {});
  }

  /** Leaves and forgets the seat, so no later reconnect reclaims it. */
  async leaveRoom(): Promise<void> {
    const room = this.room;
    this.invalidate("you left the room");
    this.forget();
    this.snapshot = undefined;
    this.snapshotReceivedAt = undefined;
    this.replay = undefined;
    this.finished = undefined;
    this.reportedAccess = undefined;
    this.setState("offline");
    await room?.leave(true).catch(() => undefined);
  }

  /** Reclaims a seat; retries call the owned variant without acquiring a new intent. */
  async reconnect(): Promise<void> {
    await this.reconnectOwned(this.invalidate());
  }

  private async reconnectOwned(generation: number): Promise<boolean> {
    if (!this.current(generation)) return false;
    const session = this.session ?? this.readStoredSession();
    if (session === undefined) throw new Error("no session to reconnect with");
    this.session = session;
    this.setState("reconnecting");
    const room = await this.createClient(this.url).reconnect(session.reconnectionToken);
    if (!this.current(generation)) {
      void room.leave(true).catch(() => undefined);
      return false;
    }
    // The SDK rotates this before seated; persist before publishing connected.
    this.remember(session, room.reconnectionToken);
    return this.adoptIfCurrent(room, generation);
  }

  async resume(): Promise<ResumeOutcome> {
    const generation = this.invalidate();
    if (!this.current(generation) || (this.session ?? this.readStoredSession()) === undefined) return "none";
    try {
      return await this.reconnectOwned(generation) ? "resumed" : "cancelled";
    } catch {
      if (!this.current(generation)) return "cancelled";
      this.forget();
      this.setState("offline");
      return "expired";
    }
  }

  private async attemptReconnect(generation: number): Promise<void> {
    const deadline = Date.now() + RECONNECT_GRACE_TICKS * TICK_MS;
    let attempt = 0;
    while (this.current(generation) && Date.now() < deadline) {
      try {
        await this.reconnectOwned(generation);
        return;
      } catch {
        if (!this.current(generation)) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { this.cancelRetry = undefined; resolve(); }, Math.min(reconnectDelay(attempt), deadline - Date.now()));
          this.cancelRetry = () => { clearTimeout(timer); resolve(); };
        });
        attempt += 1;
      }
    }
    if (!this.current(generation)) return;
    this.forget();
    this.setState("offline");
    for (const listener of [...this.subscribers]) {
      listener.onError?.({ code: "ROOM_CLOSED", message: "disconnected past the reconnect grace; seat lost", detail: "seat-lost" });
    }
  }

  private readStoredSession(): StoredSession | undefined {
    try {
      const raw = window.sessionStorage.getItem(TOKEN_KEY);
      return raw === null ? undefined : (JSON.parse(raw) as StoredSession);
    } catch {
      return undefined;
    }
  }


  dispose(): void {
    const room = this.room;
    this.disposed = true;
    this.invalidate("the connection closed");
    // Disposing the page preserves its stored token for the next page load.
    this.session = undefined;
    room?.connection?.close();
    this.subscribers.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleBrowserOffline);
    }
    this.setState("offline");
  }
}
