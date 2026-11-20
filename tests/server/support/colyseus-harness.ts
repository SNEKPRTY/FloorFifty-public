/**
 * Colyseus integration harness.
 *
 * Real rooms, real clients, real schema patches -- `@colyseus/testing` boots
 * an in-process server rather than mocking a room's methods, which is the
 * difference between testing the protocol and testing a spy.
 *
 * Only time is substituted. The room's simulation interval is cleared and
 * ticks are delivered by hand, so a thirty-second reconnect window is tested
 * in milliseconds and no test depends on timer scheduling.
 */

import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import type { Client } from "@colyseus/core";
import { COUNTDOWN_TICKS, PROTOCOL_VERSION, REVEAL_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { asRevision, type GameContent } from "@floor-fifty/shared/content/game-content";
import { pickKindOf } from "@floor-fifty/shared/room/select";
import { createClimbController, type ClimbController } from "@floor-fifty/shared/level/steering";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { SimulationInvariantError } from "@floor-fifty/shared/simulation/planck/consequences";
import { createAppConfig } from "../../../apps/server/src/colyseus-app";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import type { RaceRoom, RoomTelemetryConfig } from "../../../apps/server/src/rooms/race-room";
import type { RaceRoomState } from "../../../apps/server/src/rooms/race-room-state";
import { ROOM_CODE_CHANNEL } from "../../../apps/server/src/rooms/room-code";
import type { SeatColour } from "@floor-fifty/shared/common/seats";

export type HarnessClient = {
  roomId: string;
  sessionId: string;
  /** The player id the room sent on `seated`. */
  sessionPlayerId: PlayerId;
  /** Issued at join; the only credential a reconnect may present. */
  reconnectionToken: string;
  state: RaceRoomState;
  waitForNextPatch(): Promise<void>;
  send(type: string, payload?: unknown): void;
  /** Sends `pickCharacter`, steps the room once, and settles. */
  pickCharacter(characterId: string): Promise<void>;
  /** Sends `pickStage`, steps the room once, and settles. */
  pickStage(stageId: string): Promise<void>;
  /** Sends `pickSong`, steps the room once, and settles. */
  pickSong(songId: string): Promise<void>;
  /** Sends `pickSeed`, steps the room once, and settles. */
  pickSeed(seed: "random" | "classic" | number): Promise<void>;
  /** Sends `lockIn`, steps the room once, and settles. */
  lockIn(): Promise<void>;
  /** Sends `loaded`, steps the room once, and settles. */
  loaded(): Promise<void>;
  /** Every message of a type received so far, in arrival order. */
  messages(type: string): unknown[];
  leave(consented?: boolean): Promise<void>;
};

export type ColyseusHarness = {
  server: ColyseusTestServer;
  room: RaceRoom;
  /** The store the server was built on, so a test can replace its content. */
  contentStore: ContentStore;
  create(name: string, over?: { access?: AccessSets; colour?: SeatColour; deviceClass?: string; buildId?: string; rulesetRevision?: string }): Promise<HarnessClient>;
  /**
   * `joinOrCreate` with `quickMatch: true`, as Find a race does. The first room
   * a harness makes is its `room`; a second public room is the test's to step
   * (its own clock is stopped so it cannot tick unasked).
   */
  quickMatch(name: string, over?: { access?: AccessSets; colour?: SeatColour; deviceClass?: string; buildId?: string; rulesetRevision?: string }): Promise<HarnessClient>;
  joinById(
    code: string,
    name: string,
    over?: { protocolVersion?: number; access?: AccessSets; colour?: SeatColour; deviceClass?: string; buildId?: string; rulesetRevision?: string },
  ): Promise<HarnessClient>;
  advanceTicks(count: number): Promise<void>;
  setReady(client: HarnessClient, ready: boolean): Promise<void>;
  /** Every connected seat locks in every pick step, the reveals run out, and every connected seat loads. */
  passSelect(): Promise<void>;
  /** Readies every seat, passes select, and runs the countdown. */
  startRace(): Promise<void>;
  leave(client: HarnessClient): Promise<void>;
  /** A connection lost rather than given up: the seat is held, not freed. */
  drop(client: HarnessClient): Promise<void>;
  /** Reclaims a held seat with the token its join issued. */
  reconnect(token: string): Promise<HarnessClient>;
  waitForDisposal(): Promise<void>;
  forceDispose(): Promise<void>;
  claimedCodes(): Promise<string[]>;
  spyOnSimulationDispose(): () => boolean;
  /** Records whether a patch or an event batch arrived first, in arrival order. */
  observeOrder(client: HarnessClient, record: (kind: "patch" | "events") => void): Promise<void>;
  /** Ticks the room while the reference controller climbs, so landings happen. */
  driveTicks(count: number): Promise<void>;
  /** Drives until at least one landing event has been delivered. */
  driveUntilFirstLanding(): Promise<void>;
  /** Drives until the room finishes the race, or gives up loudly. */
  driveUntilFinished(): Promise<void>;
  /** A seat taken directly, to observe what an arrival after the start receives. */
  seatLateArrivalForTest(code: string, name: string): LateSeat;
  /** Replaces the simulation with one that violates an invariant on its next step. */
  breakTheSimulation(): void;
  close(): Promise<void>;
};

/** A seat taken outside a real connection, for what-it-receives assertions. */
export type LateSeat = {
  playerId: PlayerId;
  sessionId: string;
  messages(type: string): unknown[];
};

/** The slice of the SDK room this harness uses. */
type SdkRoom = {
  roomId: string;
  sessionId: string;
  reconnectionToken: string;
  /** The 0.18 SDK's own reconnect loop, which `wrap` turns off. */
  reconnection: { enabled: boolean };
  state: RaceRoomState;
  onMessage(type: string, handler: (payload: unknown) => void): unknown;
  onStateChange(handler: () => void): unknown;
  onLeave(handler: () => void): unknown;
  send(type: string, payload?: unknown): void;
  leave(consented?: boolean): Promise<number>;
  waitForNextPatch(): Promise<void>;
};

/**
 * A revision pair for a snapshot built outside a room.
 *
 * Every snapshot carries the content identity its room froze. A unit test that
 * projects a bare `RaceState` has no room, so it says so with a value that is
 * obviously a fixture.
 */
export const TEST_REVISIONS = {
  contentRevision: asRevision("c".repeat(64)),
  rulesetRevision: asRevision("d".repeat(64)),
  courseRevisions: {},
} as const;

/**
 * Content identical to the shipped artifact but for one gravity value.
 *
 * `marker` distinguishes two otherwise identical fixtures, which is what lets
 * a test say which content a room actually froze. The revisions are fixtures
 * rather than real digests: nothing at runtime recomputes them.
 */
export function contentWithGravity(gravity: number, marker: string): GameContent {
  return {
    ...GENERATED_CONTENT,
    contentRevision: asRevision(marker.repeat(64).slice(0, 64)),
    rulesetRevision: asRevision(marker.repeat(64).slice(0, 64)),
    content: {
      ...GENERATED_CONTENT.content,
      baseTuning: resolveTuning({ GRAVITY: gravity }),
    },
  };
}

/** Every `.ts` or `.svelte` file under a directory, concatenated, for boundary guards. */
export async function readAllSources(root: string): Promise<string> {
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const entries = await readdir(root, { withFileTypes: true });
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return readAllSources(path);
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".svelte")) return "";
      return readFile(path, "utf8");
    }),
  );
  return parts.join("\n");
}

/** Lets pending socket callbacks run before a test inspects the result. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Lets messages a client has sent reach the room.
 *
 * An input frame is fire-and-forget, so there is no answer to await and no
 * promise to resolve: the frame is in flight when the test asks for ticks. A
 * timer turn reaches the socket's poll phase, where the frame is read, and the
 * immediate turn after it runs once the room has handled what arrived. Two
 * rounds, because a frame can still be in flight when the first one runs.
 */
const drainClientMessages = async (): Promise<void> => {
  for (let round = 0; round < 2; round += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    await settle();
  }
};

/**
 * Waits until the room has answered one command, so a test steps a room that
 * has applied it. Draining a fixed number of loop turns is not enough on a
 * loaded machine: a command still in flight when a batch of ticks runs is
 * applied after them all (a countdown that starts late never ends inside the
 * batch). Every command is answered with its request id (`runCommand`).
 */
export const answered = (client: { messages(type: string): unknown[] }, requestId: string): Promise<void> =>
  waitFor(
    () => client.messages("commandResult").some((result) => (result as { requestId?: string }).requestId === requestId),
    `the room never answered command ${requestId}`,
  );

/** Waits for something the server does on its own schedule, or gives up loudly. */
const waitFor = async (condition: () => boolean, failure: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(failure);
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
  }
};

/**
 * Opens a seat, retrying the transport's own refusal.
 *
 * Matchmaking reserves a seat and the socket claims it. On a machine running
 * the whole suite at once, that claim is occasionally refused with "seat
 * reservation expired" -- the reservation is written by matchmaking and read
 * by the transport, and under load the two disagree for a moment. The refusal
 * happens before the room is entered, so nothing was seated and nothing was
 * consumed: a fresh attempt reserves a fresh seat with a fresh session.
 */
const withSeatRetry = async <T>(attempt: () => Promise<T>): Promise<T> => {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (tries >= 2 || !message.includes("seat reservation expired")) throw error;
      await drainClientMessages();
    }
  }
};

/**
 * A port nothing is listening on.
 *
 * `boot` defaults every test server to the same fixed port, and a suite that
 * boots one per test then races the previous server's shutdown: the new client
 * reaches a listener that is already closing and sees the connection reset.
 * Asking the kernel for a free port takes the race out of the suite.
 */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** How long one boot gets before it is given up on: a boot on a free port takes well under a second. */
const BOOT_PATIENCE_MS = 3_000;
/** Ports tried before the harness gives up. */
const BOOT_TRIES = 3;

/**
 * Boots a test server on a port from `portSource`, and on another if that one
 * has gone.
 *
 * `freePort` finds a free port and closes it, and `boot` binds it afterwards.
 * Another vitest worker can bind it in that gap (the pool runs files in
 * parallel threads on one machine), and `boot` then logs EADDRINUSE and never
 * settles, so the hook ran to its 20 s timeout (run #674,
 * race-room-lifecycle.test.ts: "listen EADDRINUSE: address already in use
 * :::55794"). So each try gets `BOOT_PATIENCE_MS`; an EADDRINUSE or no answer
 * in that time takes a fresh port, up to `BOOT_TRIES` ports. Any other
 * failure is a real one and is thrown at once. A try given up on that settles
 * later is shut down, so it does not leave a listener behind.
 */
async function bootOnFreePort(bootOn: (port: number) => Promise<ColyseusTestServer>, portSource: () => Promise<number>): Promise<ColyseusTestServer> {
  let failure = "";
  for (let attempt = 1; attempt <= BOOT_TRIES; attempt += 1) {
    const port = await portSource();
    const booting = bootOn(port);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<"timed out">((resolve) => {
      timer = setTimeout(() => resolve("timed out"), BOOT_PATIENCE_MS);
    });
    try {
      const result = await Promise.race([booting, patience]);
      if (result !== "timed out") return result;
      failure = `no answer from a boot on port ${port} within ${BOOT_PATIENCE_MS} ms`;
      void booting.then((late) => late.shutdown(), () => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("EADDRINUSE")) throw error;
      failure = message;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`the test server did not boot in ${BOOT_TRIES} tries; the last: ${failure}`);
}

let requestCounter = 0;
export const nextRequestId = (): string => `req-${(requestCounter += 1)}`;

export async function createColyseusHarness(
  fixedSeed = 4182,
  options: {
    telemetry?: RoomTelemetryConfig;
    content?: typeof GENERATED_CONTENT;
    roomIdleTicks?: number;
    /** Where the server's port comes from: the kernel's free port unless a test says otherwise. */
    portSource?: () => Promise<number>;
  } = {},
): Promise<ColyseusHarness> {
  const contentStore = new ContentStore(options.content ?? GENERATED_CONTENT);
  // Built afresh for each try: a boot that failed has already used its copy.
  const appConfig = () =>
    config(createAppConfig({
      contentStore,
      fixedSeed,
      ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
      ...(options.roomIdleTicks === undefined ? {} : { roomIdleTicks: options.roomIdleTicks }),
    }));
  const server = await bootOnFreePort((port) => boot(appConfig(), port), options.portSource ?? freePort);

  let room: RaceRoom | undefined;
  const clients: HarnessClient[] = [];
  const sdkRooms = new Map<HarnessClient, SdkRoom>();
  /** Clients whose connection has closed: their copy of the state will never advance again. */
  const closedSdkRooms = new Set<SdkRoom>();
  let controller: ClimbController | undefined;
  let sequence = 0;
  let lateSeats = 0;

  /** Wraps an SDK room in the narrow surface the tests use. */
  const wrap = async (sdkRoom: SdkRoom): Promise<HarnessClient> => {
    // As the client adapter does: the 0.18 SDK would otherwise retry a dropped
    // socket by itself, undoing the drop a test asked for.
    sdkRoom.reconnection.enabled = false;
    sdkRoom.onLeave(() => closedSdkRooms.add(sdkRoom));
    const inbox = new Map<string, unknown[]>();
    let playerId = asPlayerId("");
    let leaving: Promise<void> | undefined;

    // `replay` arrives as bytes (race-options spec §6.4).
    for (const type of ["seated", "commandResult", "raceEvents", "serverError", "pong", "replay", "idleWarning"]) {
      sdkRoom.onMessage(type, (payload) => {
        const received = inbox.get(type) ?? [];
        received.push(payload);
        inbox.set(type, received);
        if (type === "seated") playerId = asPlayerId((payload as { playerId: string }).playerId);
      });
    }

    /**
     * Resolves once this client holds state at least as new as the room's.
     *
     * Colyseus sends a patch only when something changed, so waiting for "the
     * next patch" after the change had already arrived would wait forever; and
     * resolving on any patch would let a test read a state the room has moved
     * past -- which it did, about one run in ten. The room's own tick is the
     * one unambiguous thing to wait for.
     */
    const waitForNextPatch = async (): Promise<void> => {
      await waitFor(
        () => (sdkRoom.state as { tick?: number }).tick !== undefined &&
          (sdkRoom.state as { tick: number }).tick >= harness.room.raceState.tick,
        "the client never received the room's latest state",
      );
    };

    /** Sends one command, waits for its answer, steps the room once, and settles. */
    const command = async (type: string, payload: Record<string, unknown>): Promise<void> => {
      const requestId = nextRequestId();
      client.send(type, { requestId, ...payload });
      await answered(client, requestId);
      harness.room.stepOnce();
      await waitForRoomPatch();
      await settle();
    };

    const client: HarnessClient = {
      roomId: sdkRoom.roomId,
      sessionId: sdkRoom.sessionId,
      get sessionPlayerId() {
        return playerId;
      },
      get reconnectionToken() {
        return sdkRoom.reconnectionToken;
      },
      get state() {
        return sdkRoom.state;
      },
      waitForNextPatch,
      send: (type, payload) => sdkRoom.send(type, payload ?? {}),
      async pickCharacter(characterId) {
        await command("pickCharacter", { characterId });
      },
      async pickStage(stageId) {
        await command("pickStage", { stageId });
      },
      async pickSong(songId) {
        await command("pickSong", { songId });
      },
      async pickSeed(seed) {
        await command("pickSeed", { seed });
      },
      async lockIn() {
        await command("lockIn", {});
      },
      async loaded() {
        await command("loaded", {});
      },
      messages: (type) => inbox.get(type) ?? [],
      leave: async (consented = true) => {
        // The client's leave promise is resolved by a close event. A room that
        // already disconnected this session -- an empty room disposing itself,
        // or a deliberate disconnect -- has fired that event, so a second
        // leave would never settle.
        if (leaving !== undefined) return;
        leaving = sdkRoom.leave(consented).then(
          () => undefined,
          () => undefined,
        );
        await leaving;
      },
    };

    await settle();
    clients.push(client);
    sdkRooms.set(client, sdkRoom);
    return client;
  };

  /**
   * Stops the room driving itself.
   *
   * The room's tick scheduler is its own timer, not one registered with the
   * room's clock, so clearing the clock would leave it running and make every
   * tick count non-deterministic. `stopClock` stops it for good.
   */
  const takeOverTheClock = (): void => {
    room?.stopClock();
  };

  /**
   * Waits for the room's next patch, unless the room has disposed itself.
   *
   * A batch of ticks can span a disposal -- the last seat expiring to a DNS is
   * the ordinary way -- and a disposed room has no patch interval left to
   * resolve. Waiting for one would hang rather than report the disappearance
   * the test is actually asserting.
   */
  const waitForRoomPatch = async (): Promise<void> => {
    if (server.getRoomById(harness.room.roomId) === undefined) return;
    // Patches are sent from the tick loop every third tick, so a batch of
    // ticks may end between two of them. Sending one now is what the old
    // patch timer did on its own, and it is what a client would see next.
    const next = harness.room.waitForNextPatch();
    harness.room.broadcastPatch();
    await next;
    await waitForClientsToCatchUp();
  };

  /**
   * Waits until every client still connected to the room holds its latest state.
   *
   * The room has only *sent* the forced patch when `waitForNextPatch` answers;
   * the client has not necessarily *read* it. After a long batch the client has
   * hundreds of earlier patches queued ahead of it (the room sends one every
   * third tick), and the tail of that queue can still be crossing the loopback
   * socket when the harness returns. A test that then read a client's copy saw
   * a state some ticks old, and whether it did came down to how quickly the
   * machine moved bytes between two sockets. Waiting here keeps the promise
   * `advanceTicks` makes: what a client observes is what the room just did.
   *
   * Clients that have left are skipped (their copy is frozen on purpose), as
   * are clients of another room (`quickMatch` can open a second one).
   */
  const waitForClientsToCatchUp = async (): Promise<void> => {
    const roomId = harness.room.roomId;
    const roomTick = harness.room.state.tick;
    await waitFor(
      () =>
        [...sdkRooms.values()].every(
          (sdkRoom) =>
            closedSdkRooms.has(sdkRoom) ||
            sdkRoom.roomId !== roomId ||
            (sdkRoom.state?.tick ?? -1) >= roomTick,
        ),
      "a connected client never received the room's latest state",
    );
  };

  const harness: ColyseusHarness = {
    server,
    contentStore,
    get room() {
      if (room === undefined) throw new Error("no room has been created yet");
      return room;
    },
    async create(name, over = {}) {
      const sdkRoom = await withSeatRetry(() =>
        server.sdk.create("race", {
          name,
          protocolVersion: PROTOCOL_VERSION,
          ...(over.access === undefined ? {} : { access: over.access }),
          ...(over.colour === undefined ? {} : { colour: over.colour }),
          ...(over.deviceClass === undefined ? {} : { deviceClass: over.deviceClass }),
          ...(over.buildId === undefined ? {} : { buildId: over.buildId }),
          ...(over.rulesetRevision === undefined ? {} : { rulesetRevision: over.rulesetRevision }),
        }),
      );
      room = server.getRoomById(sdkRoom.roomId) as unknown as RaceRoom;
      takeOverTheClock();
      const client = await wrap(sdkRoom as never);
      // One tick flushes the deferred `seated` message, so `sessionPlayerId`
      // is already populated when the caller inspects the client.
      await harness.advanceTicks(1);
      return client;
    },
    async quickMatch(name, over = {}) {
      const sdkRoom = await withSeatRetry(() =>
        server.sdk.joinOrCreate("race", {
          name,
          protocolVersion: PROTOCOL_VERSION,
          quickMatch: true,
          ...(over.access === undefined ? {} : { access: over.access }),
          ...(over.colour === undefined ? {} : { colour: over.colour }),
          ...(over.deviceClass === undefined ? {} : { deviceClass: over.deviceClass }),
          ...(over.buildId === undefined ? {} : { buildId: over.buildId }),
          ...(over.rulesetRevision === undefined ? {} : { rulesetRevision: over.rulesetRevision }),
        }),
      );
      const joined = server.getRoomById(sdkRoom.roomId) as unknown as RaceRoom;
      if (room === undefined) {
        room = joined;
        takeOverTheClock();
      } else if (joined !== room) {
        joined.stopClock();
      }
      const client = await wrap(sdkRoom as never);
      await harness.advanceTicks(1);
      return client;
    },
    async joinById(code, name, over = {}) {
      const sdkRoom = await withSeatRetry(() =>
        server.sdk.joinById(code, {
          name,
          protocolVersion: over.protocolVersion ?? PROTOCOL_VERSION,
          ...(over.access === undefined ? {} : { access: over.access }),
          ...(over.colour === undefined ? {} : { colour: over.colour }),
          ...(over.deviceClass === undefined ? {} : { deviceClass: over.deviceClass }),
          ...(over.buildId === undefined ? {} : { buildId: over.buildId }),
          ...(over.rulesetRevision === undefined ? {} : { rulesetRevision: over.rulesetRevision }),
        }),
      );
      const client = await wrap(sdkRoom as never);
      await harness.advanceTicks(1);
      return client;
    },
    async advanceTicks(count) {
      // A message a test sent is in flight; the room applies it on arrival, so
      // draining first models the frame reaching the server before the next
      // tick rather than two ticks later.
      await drainClientMessages();
      for (let tick = 0; tick < count; tick += 1) harness.room.stepOnce();
      // A patch is what a client observes; forcing one keeps a test from
      // asserting against state the wire has not carried yet.
      await waitForRoomPatch();
      await settle();
    },
    async setReady(client, ready) {
      const requestId = nextRequestId();
      client.send("setReady", { requestId, ready });
      await answered(client, requestId);
      harness.room.stepOnce();
      await waitForRoomPatch();
    },
    async passSelect() {
      // Only seats still connected can answer; a dropped or departed one is
      // waited on by nobody.
      const connected = () =>
        clients.filter((client) => harness.room.raceState.players[client.sessionPlayerId]?.status === "connected");
      for (let guard = 0; guard < 16 && harness.room.raceState.phase === "select"; guard += 1) {
        const step = harness.room.raceState.select!.step;
        if (step === "loading") {
          for (const client of connected()) await client.loaded();
        } else if (pickKindOf(step) !== undefined) {
          for (const client of connected()) await client.lockIn();
        } else {
          await harness.advanceTicks(REVEAL_TICKS + 1);
        }
      }
    },
    async startRace() {
      for (const client of clients) await harness.setReady(client, true);
      await harness.passSelect();
      await harness.advanceTicks(COUNTDOWN_TICKS + 1);
    },
    async leave(client) {
      await client.leave(true);
      await settle();
    },
    async drop(client) {
      const playerId = client.sessionPlayerId;
      // Not consented: the connection closes without a leave message, which is
      // what a tunnel or a crash looks like from the server's side.
      await client.leave(false);
      // A reconnect is only accepted once the room has observed the drop and
      // taken the seat into its own hands, so wait for the ghost it projects
      // rather than for a guess about how many turns that takes.
      await waitFor(
        () => harness.room.raceState.players[playerId]?.status === "ghost",
        "the room never ghosted the dropped player",
      );
    },
    async reconnect(token) {
      const sdkRoom = await withSeatRetry(() => server.sdk.reconnect(token));
      const client = await wrap(sdkRoom as never);
      // One tick flushes the deferred `seated` message, exactly as it does for
      // a fresh join, so `sessionPlayerId` is populated on return.
      await harness.advanceTicks(1);
      return client;
    },
    async waitForDisposal() {
      const deadline = Date.now() + 2_000;
      while (server.getRoomById(harness.room.roomId) !== undefined) {
        if (Date.now() > deadline) throw new Error("the room did not dispose");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async forceDispose() {
      await harness.room.disconnect();
      await settle();
    },
    async claimedCodes() {
      // The presence is the server's own, and it is the same instance the
      // matchmaker hands every room; the field is protected, not private, so
      // this read is a cast rather than a leak. Nothing in production reaches
      // for it.
      const presence = (server.server as unknown as { presence: ColyseusHarnessPresence }).presence;
      return presence.smembers(ROOM_CODE_CHANNEL);
    },
    spyOnSimulationDispose() {
      let disposed = false;
      const simulation = (harness.room as unknown as { simulation: { dispose(): void } }).simulation;
      const original = simulation.dispose.bind(simulation);
      simulation.dispose = () => {
        disposed = true;
        original();
      };
      return () => disposed;
    },
    async observeOrder(client, record) {
      const sdkRoom = sdkRooms.get(client);
      if (sdkRoom === undefined) throw new Error("that client was not created by this harness");
      sdkRoom.onStateChange(() => record("patch"));
      sdkRoom.onMessage("raceEvents", () => record("events"));
      await settle();
    },
    async driveTicks(count) {
      // The driver supplies frames faster than a human hand could, which is
      // what the unmetered input path exists for; every other rule still
      // applies, so a driven race is a real race.
      const playerId = harness.room.seatedPlayerIds()[0];
      if (playerId === undefined) throw new Error("no player is seated to drive");
      controller ??= createClimbController(playerId);
      for (let tick = 0; tick < count; tick += 1) {
        // A batch can span the finish: the race stops accepting frames the
        // moment it ends, and the caller asked for ticks, not for an error.
        if (harness.room.raceState.phase !== "racing") break;
        sequence += 1;
        const input = controller.next(harness.room.raceState, sequence);
        if (input !== undefined) {
          harness.room.submitInput(
            playerId,
            { ...input, tick: harness.room.raceState.tick + 1 },
            false,
          );
        }
        harness.room.stepOnce();
      }
      await waitForRoomPatch();
      await settle();
    },
    async driveUntilFirstLanding() {
      for (let batch = 0; batch < 40; batch += 1) {
        await harness.driveTicks(15);
        const batches = (clients[0]?.messages("raceEvents") ?? []) as RaceEvent[][];
        if (batches.flat().some((event) => event.type === "floorLanded")) return;
      }
      throw new Error("no landing event was delivered within the ceiling");
    },
    async driveUntilFinished() {
      const ceiling = TICK_HZ * 600;
      let driven = 0;
      while (harness.room.raceState.phase !== "finished") {
        if (driven >= ceiling) throw new Error("the race did not finish within the ceiling");
        await harness.driveTicks(120);
        driven += 120;
      }
    },
    seatLateArrivalForTest(code, name) {
      const room = harness.room;
      if (room.roomId !== code) throw new Error("that code belongs to another room");
      // A racing room refuses a real join -- Task 15 pins that rule -- so the
      // late seat is taken directly: `onJoin` is what a seat is, and what it
      // receives is what the room sends to the seats that exist.
      const sessionId = `late-${(lateSeats += 1)}`;
      const inbox = new Map<string, unknown[]>();
      const bare = {
        sessionId,
        send: (type: string, payload: unknown) => {
          const received = inbox.get(type) ?? [];
          received.push(payload);
          inbox.set(type, received);
        },
      } as unknown as Client;
      room.onJoin(bare, { name, protocolVersion: PROTOCOL_VERSION });
      return {
        playerId: room.seatedPlayerIds().at(-1) as PlayerId,
        sessionId,
        messages: (type) => inbox.get(type) ?? [],
      };
    },
    breakTheSimulation() {
      const room = harness.room;
      const seed = room.raceState.seed;
      const tick = room.raceState.tick;
      (room as unknown as { simulation: RaceSimulation }).simulation = {
        step() {
          throw new SimulationInvariantError("test-injected", seed, tick);
        },
        stats: () => ({
          steps: 0,
          facts: { top: 0, side: 0, underside: 0, foot: 0 },
          contacts: 0,
          bodies: 0,
        }),
        restore() {},
        dispose() {},
      };
    },
    async close() {
      for (const client of clients) {
        // A client the room disconnected first has no close event left to
        // resolve its leave promise, so the closing leave is bounded rather
        // than awaited forever. Nothing is asserted after this point.
        await Promise.race([
          client.leave(true).catch(() => undefined),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 250).unref();
          }),
        ]);
      }
      await server.shutdown();
    },
  };

  return harness;
}

/** The slice of Presence this harness reads. */
type ColyseusHarnessPresence = { smembers(key: string): Promise<string[]> };
