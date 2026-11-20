/**
 * One race room, on Colyseus.
 *
 * The room owns the clock and the authority: it steps the race 60 times a
 * second, decides every phase change, and publishes the result. It is the
 * adapter between Colyseus and the parts that hold the rules, each of which
 * is plain code with its own tests:
 *
 * - `lobby-rules.ts`: readiness, the countdown, the lap count, starting and
 *   starting over.
 * - `seat-registry.ts`: which session is which player, the `seated` message
 *   each is owed, and seats held for a reconnect.
 * - `command-ledger.ts`: every command is answered exactly once.
 * - `input-meter.ts` and `input-queue.ts`: how much input a seat may send, and
 *   the tick each frame takes effect on.
 * - `race-projection.ts`: the race copied into the schema clients receive.
 *
 * The race itself (`RaceState`) is kept apart from the schema. The schema is
 * a synchronized view; the race is what the simulation steps, and it holds
 * fields no client needs (the visited set, ghost deadlines, the frozen tuning).
 * Projecting once per tick into a view is cheaper to reason about than making
 * the simulation read a wire format.
 */

import { CloseCode, Room, type Client, type Presence } from "@colyseus/core";
import {
  DEFAULT_MODE_ID,
  IDLE_WARNING_TICKS,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  PATCH_RATE_MS,
  RECONNECT_GRACE_TICKS,
  ROOM_IDLE_TICKS,
  SNAPSHOT_HZ,
  TICK_HZ,
  TICK_MS,
  UNARRIVED_ROOM_TICKS,
} from "@floor-fifty/shared/common/constants";
import type { LapCount, PlayerId, PlayerName } from "@floor-fifty/shared/common/ids";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import { defaultRacerName, nameIsBlocked } from "@floor-fifty/shared/common/names";
import {
  SERVER_MESSAGES,
  type IdleWarning,
  type InputFrame,
  type RaceEvent,
  type RoomAccess,
} from "@floor-fifty/shared/common/protocol";
import { parseJoinOptions } from "@floor-fifty/shared/common/schemas";
import type { RaceState } from "@floor-fifty/shared/common/state";
import {
  createPlayerState,
  createRaceState,
} from "@floor-fifty/shared/common/state";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { SimulationInvariantError } from "@floor-fifty/shared/simulation/planck/consequences";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { ContentStore } from "../content/content-store";
import { SERVER_BUILD } from "../build-facts";
import { forgetRoom, liveRooms, registerRoom } from "./live-rooms";
import { DEV_BUILD_ID, type BuildFacts } from "@floor-fifty/shared/common/build";
import {
  rulesetMismatchMessage,
  serverBusyMessage,
  serverUpdatingMessage,
  versionVerdict,
} from "@floor-fifty/shared/common/refusals";
import { applyCharacterFallback } from "./character-rules";
import { nextFreeColour } from "@floor-fifty/shared/common/seats";
import { projectRace } from "./race-projection";
import { raceTuning } from "./race-tuning";
import { advanceSelect, enterSelect, type SelectContext } from "./select-rules";
import { abandonedByPeople, graceSeconds, holdClocks, type ClockName } from "./clock-hold";
import { RaceRoomState } from "./race-room-state";
import { CommandLedger } from "./command-ledger";
import { InputMeter } from "./input-meter";
import { InputQueue } from "./input-queue";
import { deflateReplaySync } from "./replay-compression";
import { ReplayRecorder } from "./replay-recorder";
import { registerRoomHandlers } from "./race-room-commands";
import type { Replay } from "@floor-fifty/shared/replay/replay";
import { AccessBook } from "./room-access";
import { createCpuController, cpuSeed, type CpuController } from "@floor-fifty/shared/cpu/controller";
import { PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { cpuCount, fillCpus, leavesLobbyShort, startClockRanOut } from "./cpu-rules";
import { RoomTelemetry, allocateRoomSerial, type InputOutcome } from "./room-telemetry";
import { SeatRegistry } from "./seat-registry";
import { startTickScheduler, type TickScheduler } from "./tick-scheduler";
import { claimRoomCode, createCourseSeed, releaseRoomCode } from "./room-code";
import { claimRoomFor, releaseRoomOf } from "./room-owners";
import { CommandMeter } from "./command-meter";
import { currentRoomOwner } from "../gate/room-owner-context";
import {
  acceptsInput,
  countdownElapsed,
  evaluateQuickMatch,
  evaluateReadiness,
  isPreRace,
  nextHost,
  nextRace,
  setReady,
  startRace,
} from "./lobby-rules";

/**
 * Where a room's telemetry goes.
 *
 * A process concern, so the host decides: the production and development
 * entry points attach a sink, and a test attaches none and hears nothing.
 */
export type RoomTelemetryConfig = {
  /** Anomaly lines, and summary lines when `summaries` is set. */
  log?: (line: string) => void;
  /** A summary line per room every ten seconds. */
  summaries?: boolean;
  /** Each tick's cost in ms, for the process's once-a-minute `ticks` line. */
  tickCost?: (ms: number) => void;
};

export type RaceRoomOptions = {
  contentStore: ContentStore;
  fixedSeed?: number;
  telemetry?: RoomTelemetryConfig;
  /** Whether the process is draining for a deploy; a draining server seats nobody new (release readiness §5.4). */
  isDraining?: () => boolean;
  /** `MAX_ROOMS`: the most rooms this process holds; one more is refused as SERVER_BUSY (§6.1). */
  maxRooms?: number;
  /** Ticks a lobby, select or results room may sit with no command before it closes (audit B1). */
  roomIdleTicks?: number;
  /** Rooms one address may have open, by who created them; unset is no limit (audit B1). */
  maxRoomsPerAddress?: number;
};

export type JoinOptionsPayload = {
  name?: unknown;
  protocolVersion?: unknown;
  access?: unknown;
  colour?: unknown;
  deviceClass?: unknown;
  quickMatch?: unknown;
};

/**
 * What a failure says out loud.
 *
 * Seed, tick, content revision, ruleset revision and the invariant's name --
 * enough to reproduce the race, and nothing that identifies a person. Player
 * names, room codes, reconnection tokens, addresses and raw input are all
 * absent by construction rather than by redaction.
 */
export type SimulationDiagnostic = {
  invariant: string;
  seed: number;
  tick: number;
  contentRevision: string;
  rulesetRevision: string;
};

/** Room ticks between patches: the snapshot rate, on the room's own clock. */
const PATCH_EVERY_TICKS = TICK_HZ / SNAPSHOT_HZ;

/**
 * The most ticks a room catches up after its process stalls: half a second.
 *
 * Time a room drops rather than replays moves its whole timeline back against
 * the wall clock, and every client steering by it finds its clock suddenly
 * ahead and snaps. Measured: a 538 ms stall with a five-tick cap dropped
 * 450 ms, and every client snapped twice and ran inputs late. Half a second of
 * a four-racer room is about ten milliseconds of stepping, which is a far
 * smaller hitch than the one it prevents; past it the stall is not a hiccup.
 */
const MAX_CATCH_UP_TICKS = TICK_HZ / 2;

export class RaceRoom extends Room<{ state: RaceRoomState }> {
  static readonly ROOM_NAME = "race";

  /** Injected by `defineRaceRoom`; a room never reaches for a global. */
  static options: RaceRoomOptions | undefined;

  /** Set by the host process to receive diagnostics. Absent in tests by default. */
  static onSimulationFailure: ((diagnostic: SimulationDiagnostic) => void) | undefined;

  /**
   * The content this room runs on, for its whole life.
   *
   * Read from the store once, at creation, and never re-read, so a reload
   * reaches menus and later rooms and cannot move the floors under a race.
   */
  declare content: GameContent;

  override maxClients = MAX_PLAYERS;
  /** The outer guard behind the command and input budgets (audit B2); Colyseus's own default is none. */
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  // Room-command wiring (race-room-commands.ts); not room API.
  race!: RaceState;
  private simulation!: RaceSimulation;
  private fixedSeed: number | undefined;
  private nextPlayerNumber = 0;
  /** Drives `stepOnce` on its own deadline grid. Absent once stopped. */
  private scheduler: TickScheduler | undefined;
  /** When the last tick ran, for the fractional tick a ping is measured against. */
  private lastStepAt: number | undefined;
  /** When each seat last pinged, so a probe cannot become a flood. */
  // Room-command wiring (race-room-commands.ts); not room API.
  readonly lastPingAt = new Map<string, number>();
  private pendingEvents: RaceEvent[] = [];
  /** Set once an invariant fails; a stopped room advances no further. */
  private halted = false;
  /** The clocks the browser suite has asked this room to hold (`clock-hold.ts`); none in a real room. */
  private held: ReadonlySet<ClockName> = new Set();
  /** Whether the matchmaker currently lists this room; undefined until the first `syncListing`. */
  private listed: boolean | undefined;
  /** When the room first looked empty, in room ticks; unset while occupied. */
  private emptySinceTick: number | undefined;
  /** Who sits where, whom to tell, and whose seat is held for a reconnect. */
  // Room-command wiring (race-room-commands.ts); not room API.
  readonly seats = new SeatRegistry();

  /** Every seat's stamped frames, held until their tick. */
  private readonly inputQueue = new InputQueue();
  /** Each CPU's hands for the race in progress, built at GO; empty outside a race. */
  private readonly cpus = new Map<PlayerId, { controller: CpuController; sequence: number }>();
  /** Each seat's input budget; a frame over it is dropped. */
  private readonly inputMeter = new InputMeter();
  /** Each seat's command budget; a command over it is dropped unanswered (audit B2). */
  // Room-command wiring (race-room-commands.ts); not room API.
  readonly commandMeter = new CommandMeter();
  /** Every correlated command's answer, so a resent command is answered, not re-run. */
  // Room-command wiring (race-room-commands.ts); not room API.
  readonly ledger = new CommandLedger();
  /** Records the race from GO to the finish (race-options spec §6.2). */
  private readonly recorder = new ReplayRecorder();
  /** The finished race's replay, deflated, until race again (race-options spec §6.4). */
  // Room-command wiring (race-room-commands.ts); not room API.
  replayBytes: Uint8Array | undefined;
  /** The replay waiting for the next patch, which it follows. */
  private replayAfterPatch: Uint8Array | undefined;
  /** The connections already sent this race's replay on request (audit B2); a new race starts it empty. */
  private replayServed = new WeakSet<Client>();

  /** Says whether `client` may be sent the replay on request, and counts it sent: one per connection per race. */
  // Room-command wiring (race-room-commands.ts); not room API.
  claimReplayFor(client: Client): boolean {
    if (this.replayServed.has(client)) return false;
    this.replayServed.add(client);
    return true;
  }
  /** What each seat may pick, from its join report and any later `reportAccess`. */
  // Room-command wiring (race-room-commands.ts); not room API.
  access!: AccessBook;

  /**
   * This room's clock, physics and input measurements.
   *
   * Created with the room and read by the debug endpoint and by tests. It
   * observes; nothing the room decides reads it back.
   */
  telemetry!: RoomTelemetry;

  /** Read-only view for tests and the driver; callers must not mutate it. */
  get raceState(): RaceState {
    return this.race;
  }

  /** Exposed so a test can assert the patch rate rather than trust it. */
  get patchRateMs(): number {
    return PATCH_RATE_MS;
  }

  // ── Lifecycle ──

  override async onCreate(createOptions: JoinOptionsPayload = {}): Promise<void> {
    const options = RaceRoom.options;
    if (options === undefined) throw new Error("RaceRoom was defined without options");
    // Only Colyseus knows whether a Find a race opens a room, so the cap is
    // here rather than in the gate; a Find a race at the cap still fills a
    // listed room (release readiness §6.1). Checked before a code is claimed.
    if (liveRooms.size >= (options.maxRooms ?? Number.POSITIVE_INFINITY)) {
      options.telemetry?.log?.(JSON.stringify({ event: "refused", limit: "busy" }));
      throw new Error(serverBusyMessage());
    }
    // Counted by the address that asked for this room (`gate/room-owner-context.ts`),
    // before anything awaits, so two requests arriving together cannot both pass.
    const owner = currentRoomOwner();
    if (owner !== undefined && options.maxRoomsPerAddress !== undefined) {
      if (!claimRoomFor(owner, options.maxRoomsPerAddress)) {
        options.telemetry?.log?.(JSON.stringify({ event: "refused", limit: "address-rooms" }));
        throw new Error(serverBusyMessage());
      }
      this.ownedBy = owner;
    }

    // The player-visible code *is* the room id, so `joinById` is join-by-code
    // and there is no second lookup to keep in step with this one.
    this.roomId = await claimRoomCode(this.presence as Presence);
    this.codeClaimed = true;
    registerRoom(this);

    this.content = options.contentStore.current();
    this.fixedSeed = options.fixedSeed;
    this.telemetry = new RoomTelemetry({
      serial: allocateRoomSerial(),
      ...(options.telemetry?.log === undefined ? {} : { log: options.telemetry.log }),
      summaries: options.telemetry?.summaries ?? false,
      ...(options.telemetry?.tickCost === undefined ? {} : { tickCost: options.telemetry.tickCost }),
    });

    this.setState(new RaceRoomState());
    // No patch timer. Patches go out from the tick loop every third tick, so
    // each carries the tick just computed and consecutive ticks are evenly
    // spaced: a timer of its own sent whatever tick was newest at an unrelated
    // moment, up to a whole tick stale and 64 ms apart at the 99th percentile.
    this.setPatchRate(null);
    this.autoDispose = false;

    this.access = new AccessBook(this.content.content);
    const tuning = resolveTuning(this.content.content.baseTuning);
    const hostId = this.allocatePlayerId();
    // The room seed seeds the roulette. The lobby stands on the first
    // catalogued stage's course, so the state is valid before any stage is
    // chosen; the stage reveal rebuilds it from the chosen one (spec §4.5).
    const roomSeed = this.fixedSeed ?? createCourseSeed();
    const first = this.content.content.stages[0];
    const modeId = this.content.content.modes[0]?.id ?? DEFAULT_MODE_ID;
    const firstCourse = first === undefined ? undefined : this.stageCourse(first.id, modeId);
    // Read only here, from the creating client: a room is public exactly when
    // it was opened by Find a race. Anything but `true` is private.
    const access: RoomAccess = createOptions.quickMatch === true ? "public" : "private";
    this.race = createRaceState({
      seed: firstCourse?.seed ?? roomSeed,
      roomSeed,
      access,
      lapCount: 1,
      modeId,
      tuning: firstCourse?.tuning ?? tuning,
      players: [{ id: hostId, name: "…" as PlayerName }],
    });
    // The host's real name arrives with their join; the seat exists first so
    // `createRaceState`'s "a race needs at least one player" rule holds.
    delete this.race.players[hostId];
    this.nextPlayerNumber = 0;

    this.simulation = createRaceSimulation(this.race);
    this.project();

    this.registerHandlers();

    this.scheduler = startTickScheduler({
      tickMs: TICK_MS,
      maxCatchUp: MAX_CATCH_UP_TICKS,
      onTick: () => this.stepOnce(),
      onCallback: (ticks, droppedMs) => this.telemetry.callback(ticks, droppedMs),
    });
  }

  /**
   * Logs a join this room refused by its reason alone, and returns the error to
   * throw (audit S23). Never an address, a name or a code.
   */
  private refused(limit: string, message: string): Error {
    RaceRoom.options?.telemetry?.log?.(JSON.stringify({ event: "refused", limit }));
    return new Error(message);
  }

  override onAuth(_client: Client, options: JoinOptionsPayload): true {
    // Validated before a seat exists: a bad name or an unspeakable protocol
    // version is refused rather than seated and then removed.
    const join = parseJoinOptions(options);
    // A draining server seats nobody new; a reconnection never comes through
    // here, so a held seat is still given back (release readiness §5.4).
    if (this.draining || RaceRoom.options?.isDraining?.() === true) {
      throw this.refused("draining", serverUpdatingMessage());
    }
    // The same protocol on another ruleset is this check's to refuse; a
    // protocol difference never reaches it (`matchmake-version-gate.ts`).
    // A join that carries no ruleset is from a test or a tool, and is judged
    // on its protocol alone.
    if (join.rulesetRevision !== undefined) {
      const server: BuildFacts = {
        buildId: SERVER_BUILD.buildId,
        protocolVersion: SERVER_BUILD.protocolVersion,
        rulesetRevision: this.content.rulesetRevision,
      };
      const clientBuild = join.buildId ?? DEV_BUILD_ID;
      const verdict = versionVerdict(
        { buildId: clientBuild, protocolVersion: join.protocolVersion, rulesetRevision: join.rulesetRevision },
        server,
      );
      if (verdict === "VERSION_MISMATCH") {
        throw this.refused("ruleset", rulesetMismatchMessage(join.rulesetRevision, server.rulesetRevision));
      }
      if (verdict === "SERVER_UPDATING") throw this.refused("updating", serverUpdatingMessage());
      if (verdict === "skew") this.telemetry.buildSkew(clientBuild, server.buildId);
    }
    // Nobody joins after the lobby: a room in select is closed as a racing room
    // is (select spec §5.4). The message keeps the client's /racing|closed/.
    if (!isPreRace(this.race)) {
      throw this.refused("closed", "ROOM_CLOSED: this room is already racing");
    }
    // CPUs hold no client, so Colyseus's own count cannot see them; a seat a
    // CPU took after this join was reserved is still taken (Review focus 1).
    if (this.occupancy() >= MAX_PLAYERS) {
      throw this.refused("full", "ROOM_FULL: this room is full");
    }
    return true;
  }

  override onJoin(client: Client, options: JoinOptionsPayload): void {
    // Again here: a join reserved before the host's last CPU, or before the
    // start clock filled the room, reaches this after the seat went.
    if (this.occupancy() >= MAX_PLAYERS) throw this.refused("full", "ROOM_FULL: this room is full");
    const { name: typed, access, colour, deviceClass } = parseJoinOptions(options);
    // A public room checks every seat against the authored list, a friend's
    // included; a blocked name becomes a racer name with no error shown.
    const name =
      this.race.access === "public" && nameIsBlocked(typed, this.content.content.blockedNames)
        ? asPlayerName(defaultRacerName())
        : typed;
    const playerId = this.allocatePlayerId();

    this.race.players[playerId] = createPlayerState(
      playerId,
      name,
      this.race.course,
      this.race.tuning,
    );
    // The colour the device remembers, when nobody holds it; else the first
    // free one (select spec §6.7). A room seats four, so one is always free.
    // Given at the join, so the seat's first appearance is already its colour.
    const held = new Set(Object.values(this.race.players).filter((player) => player.id !== playerId).map((player) => player.colour));
    this.race.players[playerId]!.colour = colour !== undefined && !held.has(colour) ? colour : (nextFreeColour(held) ?? "scarlet");
    this.race.players[playerId]!.deviceClass = deviceClass ?? "desktop";
    // The report is cut to the catalog; a seat that sent none has the open set.
    applyCharacterFallback(this.race, playerId, this.access.set(playerId, access));
    if (this.seats.size === 0) this.race.hostId = playerId;
    // Seating queues the `seated` message; it goes out on the next tick (see `SeatRegistry`).
    this.seats.seat(client.sessionId, playerId, client);
    this.inputMeter.fill(playerId);
    this.emptySinceTick = undefined;
    this.noteActivity();

    this.syncLock();
    this.evaluate();
    this.project();
  }

  /**
   * A seat that lost its connection.
   *
   * A consented leave is final and frees the seat now. An unexpected drop
   * holds it for the grace period, because the alternative -- freeing it
   * immediately -- means a player whose train went through a tunnel comes back
   * to a race they are no longer in.
   *
   * The player is ghosted before the wait rather than after it, so the lobby
   * shows the drop at once and a countdown that depended on their readiness is
   * cancelled rather than running out under them.
   *
   * Colyseus 0.18 calls this for both: a room with no `onDrop` gets every
   * leave here, with the close code rather than a `consented` flag.
   */
  override async onLeave(client: Client, code?: number): Promise<void> {
    const playerId = this.seats.playerOf(client.sessionId);
    if (playerId === undefined) return;

    if (code === CloseCode.CONSENTED) {
      this.removePlayer(client.sessionId, playerId);
      return;
    }

    // The hold is taken before the ghost is shown. Both happen in the same
    // synchronous run -- nothing awaits between them -- so a client that has
    // seen the drop can rely on the seat already being reserved for it.
    const reconnection = this.allowReconnection(client, graceSeconds(this.held));
    // Rejecting the deferred runs Colyseus's own cleanup: the reserved seat and
    // the reconnection token both go.
    this.seats.hold(client.sessionId, () => reconnection.reject(false));

    const player = this.race.players[playerId];
    if (player !== undefined && player.status === "connected") {
      player.status = "ghost";
      player.ghostDeadlineTick = this.race.tick + RECONNECT_GRACE_TICKS;
      player.ready = false;
    }
    this.evaluate();
    this.project();

    try {
      // 0.18 resolves the hold with the client that came back. The old one is
      // marked reconnected and drops anything sent through it, so the seat and
      // its `seated` announcement must go to the new one.
      const returnedClient = await reconnection;
      const returned = this.race.players[playerId];
      if (returned !== undefined && returned.status === "ghost") {
        returned.status = "connected";
        delete returned.ghostDeadlineTick;
      }
      // Announced again, as for a fresh join: the client registers its
      // `seated` handler only once its `reconnect` promise resolves.
      this.seats.seat(returnedClient.sessionId, playerId, returnedClient);
      this.inputMeter.fill(playerId);
      // The page that came back numbers on from what was acknowledged, holds
      // nothing, and has nothing of the old page's waiting (audit S13).
      this.inputQueue.resume(playerId, returned?.lastSequence ?? 0);
      this.project();
    } catch {
      // The deadline passed. `expireGhosts` has already decided what the seat
      // became; there is nothing to undo here.
    } finally {
      this.seats.endHold(client.sessionId);
    }
  }

  override onDispose(): void {
    forgetRoom(this);
    if (this.ownedBy !== undefined) releaseRoomOf(this.ownedBy);
    this.ownedBy = undefined;
    this.stopClock();
    // A room refused at the cap (or that failed partway through onCreate) is
    // disposed by Colyseus without ever having built these, and claimed no
    // code; tearing it down must not throw.
    const built = this as unknown as { telemetry?: RoomTelemetry; simulation?: RaceSimulation };
    built.telemetry?.dispose();
    built.simulation?.dispose();
    if (this.codeClaimed) void releaseRoomCode(this.presence as Presence, this.roomId);
  }

  /** The address counted for this room, given back when it closes (`room-owners.ts`). */
  private ownedBy: string | undefined;

  /** Set once this room holds its code, so only a room that claimed one releases it. */
  private codeClaimed = false;

  /**
   * Stops the room's own clock, for good.
   *
   * A test that delivers ticks by hand calls this first, so no tick it did not
   * ask for can land between two of its assertions.
   */
  stopClock(): void {
    this.scheduler?.stop();
    this.scheduler = undefined;
  }

  /**
   * Holds `names`, and lets go of every other clock (`clock-hold.ts`). Called
   * only by the test driver, so a browser spec can keep a screen up for as long
   * as it needs on a machine that cannot be hurried.
   */
  holdClocks(names: readonly ClockName[]): void {
    this.held = new Set(names);
  }

  /** The clocks held now, in the order they were asked for. */
  heldClocks(): ClockName[] {
    return [...this.held];
  }

  // ── The tick ──

  /** One tick of room time. Exposed so a test can drive it without a timer. */
  stepOnce(): void {
    // A halted room is stopped, not paused: it publishes nothing further and
    // answers no command, because the race it was running no longer exists.
    // Its clock still runs so that ghosts expire: a stopped race must still
    // let go of the seats it holds, or the room never closes.
    if (this.halted) {
      this.race = { ...this.race, tick: this.race.tick + 1 };
      this.expireGhosts();
      this.closeIfIdle();
      return;
    }

    this.telemetry.tickStarted();
    this.lastStepAt = performance.now();
    this.race = { ...this.race, tick: this.race.tick + 1 };
    // A hold is for a room someone is looking at. Once the people who were
    // seated have all dropped, nobody is, and a hold left armed by a spec that
    // ended would keep the ghosts' deadlines receding for good: the room would
    // never close. (A room nobody has joined yet has no one to have dropped.)
    if (this.held.size > 0 && abandonedByPeople(this.race)) this.held = new Set();
    // Before any deadline is looked at, so a held clock is never found elapsed.
    holdClocks(this.race, this.held);
    this.closeIfIdle();

    if (countdownElapsed(this.race)) this.beginRacing();
    if (this.race.phase === "select") advanceSelect(this.race, this.selectContext);
    // A public lobby's clocks run on the room's clock, so they are looked at
    // every tick rather than only when a player acts.
    if (this.race.phase === "lobby" && this.race.access === "public") this.evaluate();

    this.expireGhosts();

    // Every tick, whatever the phase, so a frame queued during the countdown is
    // already in force on the first racing tick.
    const inputs = this.inputQueue.take(this.race.tick);

    let stepMs = 0;
    if (this.race.phase === "racing") {
      const stepStarted = performance.now();
      try {
        this.recorder.beforeStep(this.race, inputs);
        const result = this.simulation.step(this.race, inputs);
        this.race = result.state;
        this.pendingEvents.push(...result.events);
        const replay = this.recorder.afterStep(this.race);
        if (replay !== undefined) this.deliverReplay(replay);
      } catch (error) {
        if (error instanceof SimulationInvariantError) {
          this.reportSimulationFailure(error);
          return;
        }
        throw error;
      }
      stepMs = performance.now() - stepStarted;
      this.telemetry.physics(this.simulation.stats());
      this.driveCpus();
    }

    this.inputMeter.refill(this.seats.seatedPlayers());
    const projectStarted = performance.now();
    this.project();
    const projectMs = performance.now() - projectStarted;
    this.flushEvents();
    if (this.race.tick % PATCH_EVERY_TICKS === 0) this.broadcastPatch();
    this.seats.announce(this.roomId);
    this.telemetry.tickFinished({ stepMs, projectMs });
  }

  /** Ticks a lobby, select or results room may sit with no command before it closes (audit B1). */
  get idleTicks(): number {
    return RaceRoom.options?.roomIdleTicks ?? ROOM_IDLE_TICKS;
  }

  /** The tick of the last command or join, which is what keeps a quiet room open. */
  private lastActivityTick = 0;
  private closingForIdle = false;
  /** The `lastActivityTick` the warning was last sent for, so one quiet stretch warns once. */
  private warnedAt: number | undefined;

  /** A seat did something: the room is in use, and its idle deadline starts again. */
  // Room-command wiring (race-room-commands.ts); not room API.
  noteActivity(): void {
    this.lastActivityTick = this.race?.tick ?? 0;
    // Something kept a warned room open: say so, so no screen goes on saying it closes.
    if (this.warnedAt !== undefined) {
      this.warnedAt = undefined;
      const kept: IdleWarning = { closesInSeconds: null };
      this.broadcast(SERVER_MESSAGES.idleWarning, kept);
    }
  }

  /**
   * Closes a room nobody is using (audit B1). Only a room that waits on its
   * players is subject: a lobby, select or results, or a halted race that will
   * never move again. A countdown or a race runs on its own clock, so its time
   * does not count, and results start their own deadline when the race ends.
   * A room whose clocks are held by the test driver is being looked at.
   */
  private closeIfIdle(): void {
    const waiting =
      this.halted ||
      this.race.phase === "lobby" ||
      this.race.phase === "select" ||
      this.race.phase === "finished";
    if (!waiting || this.held.size > 0) {
      this.lastActivityTick = this.race.tick;
      return;
    }
    if (this.closingForIdle) return;
    const idle = this.race.tick - this.lastActivityTick;
    // A lead before the deadline, once for each stretch of quiet (a command moves
    // `lastActivityTick` and so arms it again).
    const lead = Math.min(IDLE_WARNING_TICKS, Math.floor(this.idleTicks / 2));
    if (idle >= this.idleTicks - lead && idle < this.idleTicks && this.warnedAt !== this.lastActivityTick) {
      this.warnedAt = this.lastActivityTick;
      const warning: IdleWarning = { closesInSeconds: Math.round((this.idleTicks - idle) / TICK_HZ) };
      this.broadcast(SERVER_MESSAGES.idleWarning, warning);
    }
    if (idle < this.idleTicks) return;
    this.closingForIdle = true;
    RaceRoom.options?.telemetry?.log?.(JSON.stringify({ event: "closed", reason: "idle" }));
    this.broadcast(SERVER_MESSAGES.serverError, {
      code: "ROOM_CLOSED",
      message: "ROOM_CLOSED: this room closed because nobody was using it",
    });
    void this.disconnect();
  }

  /** The countdown reached zero: the race begins, and the physics world is rebuilt for it. */
  private beginRacing(): void {
    // Every `?` body was resolved when select opened (`enterSelect`).
    this.race = startRace(this.race);
    this.simulation.restore(this.race);
    // Fresh hands every race, on a stream of this room, round and colour.
    this.cpus.clear();
    for (const player of Object.values(this.race.players)) {
      if (!player.cpu) continue;
      this.cpus.set(player.id, {
        controller: createCpuController(player.id, PERSONALITIES[player.colour], cpuSeed(this.race.roomSeed, this.race.round, player.colour)),
        sequence: 0,
      });
    }
    // The replay starts from exactly the state the world was rebuilt around.
    this.replayBytes = undefined;
    this.recorder.start(this.race, {
      rulesetRevision: this.content.rulesetRevision,
      courseRevision: this.content.courseRevisions[this.race.stageId ?? ""] ?? "",
      contentRevision: this.content.contentRevision,
    });
  }

  /**
   * Resolves expired ghosts.
   *
   * Before a race an expired ghost frees their slot outright. Once a race is
   * under way the seat becomes a DNS instead, because the results screen has
   * to be able to say that they started and did not finish.
   */
  private expireGhosts(): void {
    for (const player of Object.values(this.race.players)) {
      if (player.status !== "ghost") continue;
      if (player.ghostDeadlineTick === undefined) continue;
      if (this.race.tick < player.ghostDeadlineTick) continue;

      const sessionId = this.seats.sessionOf(player.id);
      // The hold ends with the grace: whatever the seat becomes, a token
      // presented after this tick is refused.
      if (sessionId !== undefined) this.seats.closeHold(sessionId);

      if (isPreRace(this.race)) {
        if (sessionId !== undefined) this.removePlayer(sessionId, player.id);
        else delete this.race.players[player.id];
        continue;
      }
      player.status = "dns";
      delete player.ghostDeadlineTick;
    }

    this.closeIfAbandoned();
  }

  /**
   * Closes a room nobody can return to.
   *
   * Before a race an expired ghost frees their seat, so an abandoned lobby
   * empties itself. Once a race is under way the seat becomes a DNS and stays,
   * to keep the results honest -- which means a racing room whose players all
   * walked away would otherwise hold its seats and keep stepping its
   * simulation for the life of the process.
   */
  private closeIfAbandoned(): void {
    if (this.clients.length > 0) {
      this.emptySinceTick = undefined;
      return;
    }

    if (this.seats.size === 0) {
      if (this.seats.everSeated) {
        void this.disposeRoom();
        return;
      }
      // A room whose first client has not arrived yet is not abandoned: the
      // matchmaker has already reserved that seat and the socket is on its
      // way, so closing now refuses the join this room exists for. A tick can
      // run in that window, which is why this is not a race the harness can
      // paper over -- it was a room disposing itself mid-connection.
      this.emptySinceTick ??= this.race.tick;
      if (this.race.tick - this.emptySinceTick < UNARRIVED_ROOM_TICKS) return;
      void this.disposeRoom();
      return;
    }

    this.emptySinceTick = undefined;
    const recoverable = Object.values(this.race.players).some(
      (player) => player.status === "ghost",
    );
    if (!recoverable) void this.disposeRoom();
  }

  /**
   * Sends the events this tick produced, after the patch that explains them.
   *
   * `afterNextPatch` is the whole mechanism: a landing cue that arrived before
   * the state showing the floor credited would play against a world that had
   * not happened yet. Clients de-duplicate on the stable event id, which the
   * simulation derives from the tick, so a batch delivered twice is harmless
   * and a batch delivered early is not.
   */
  /**
   * Sends the finished race's replay to every seat, after the patch that
   * shows the finish, and keeps it for a seat that reloads (race-options spec
   * §6.4). Deflated here, synchronously, on the tick the race ends.
   */
  private deliverReplay(replay: Replay): void {
    this.replayBytes = deflateReplaySync(replay);
    this.replayServed = new WeakSet();
    // Sent by `broadcastPatch`, after the patch that shows the finish. Not
    // `broadcastBytes(…, { afterNextPatch: true })`: Colyseus 0.16 queues that
    // under a name its own dequeue cannot run, and the patch throws.
    this.replayAfterPatch = this.replayBytes;
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    this.broadcast(SERVER_MESSAGES.raceEvents, batch, { afterNextPatch: true });
  }

  /**
   * Sends the pending patch, timed.
   *
   * Overridden only to measure it: encoding four racers and twenty floors is
   * cheap until it is not, and a slow patch is invisible from anywhere else.
   */
  override broadcastPatch(): boolean {
    const started = performance.now();
    const changed = super.broadcastPatch();
    this.telemetry?.patchSent(performance.now() - started);
    if (this.replayAfterPatch !== undefined) {
      const bytes = this.replayAfterPatch;
      this.replayAfterPatch = undefined;
      this.broadcastBytes(SERVER_MESSAGES.replay, bytes, {});
    }
    return changed;
  }

  // Room-command wiring (race-room-commands.ts); not room API.
  project(): void {
    projectRace(this.state, this.race, this.content);
    this.syncListing();
    // A draining room that has come back to its lobby (Race again) has
    // finished its race: it closes now rather than start another.
    if (this.draining && (this.race.phase === "lobby" || this.race.phase === "select")) this.closeForDrain();
  }

  /** Set by `beginDrain`; the room seats nobody new and closes once no race is running. */
  private draining = false;
  private closingForDrain = false;

  /**
   * A deploy is under way (release readiness §5.4). The room leaves the
   * matchmaker's list at once. A lobby or select room is told and closed now,
   * so its players can carry on with the new build. A countdown, race or
   * results runs to its end, and the room closes when it would go back to its
   * lobby. The process's own cap closes anything still open.
   */
  beginDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.syncListing();
    if (this.race.phase === "lobby" || this.race.phase === "select") this.closeForDrain();
  }

  private closeForDrain(): void {
    if (this.closingForDrain) return;
    this.closingForDrain = true;
    this.broadcast(SERVER_MESSAGES.serverError, { code: "SERVER_UPDATING", message: serverUpdatingMessage() });
    void this.disconnect();
  }

  /**
   * Lists the room for matching exactly when it is public and in the lobby
   * (quick-match spec §4.2). Colyseus's `private` flag is "not offered by
   * `joinOrCreate`"; `lock` keeps meaning "full", so a stranger is kept from a
   * racing room by this, and a friend with the code is still told the real
   * reason by `onAuth`. A no-op while the answer has not changed.
   */
  private syncListing(): void {
    const listed = !this.draining && this.race.access === "public" && this.race.phase === "lobby";
    if (listed === this.listed) return;
    this.listed = listed;
    void this.setPrivate(!listed);
  }

  private reportSimulationFailure(error: SimulationInvariantError): void {
    // Stop first. A room that keeps advancing past a violated invariant
    // publishes a standing nobody can explain, which is worse than a room that
    // says it broke.
    this.halted = true;
    // A halted race keeps no replay (race-options spec §6.2).
    this.recorder.clear();
    this.replayBytes = undefined;
    this.replayAfterPatch = undefined;
    this.clock.clear();
    this.telemetry.invariant(error.invariant);

    RaceRoom.onSimulationFailure?.({
      invariant: error.invariant,
      seed: error.seed,
      tick: error.tick,
      contentRevision: this.content.contentRevision,
      rulesetRevision: this.content.rulesetRevision,
    });

    this.broadcast(SERVER_MESSAGES.serverError, {
      code: "SIMULATION_FAILURE",
      message: "This race could not continue. Nothing about it was recorded.",
    });
  }

  // ── Messages ──

  /**
   * Registers every message a client may originate. The table and its
   * handlers live in `race-room-commands.ts`; the method stays because a
   * test spies on it to fail a room late in creation.
   */
  private registerHandlers(): void {
    registerRoomHandlers(this);
  }

  // ── Select ──

  /** A stage's frozen course: its seed, and base → stage → mode tuning (race-options spec §3.2). */
  private stageCourse(stageId: string, modeId: string): { seed: number; tuning: ResolvedTuning } {
    // `race` is absent while the room is being created; the lobby then stands on the default clock.
    return raceTuning(this.content.content, stageId, modeId, this.race?.clockSeconds);
  }

  /** The clocks the room's mode offers; none on a finite mode (survival spec §5). */
  // Room-command wiring (race-room-commands.ts); not room API.
  offeredClocks(): readonly number[] {
    return this.content.content.modes.find((mode) => mode.id === this.race.modeId)?.clocks ?? [];
  }

  /** The lap counts the room's mode offers; one lap if the mode is unknown. */
  // Room-command wiring (race-room-commands.ts); not room API.
  offeredLaps(): readonly LapCount[] {
    return this.content.content.modes.find((mode) => mode.id === this.race.modeId)?.laps ?? [1];
  }

  private readonly selectContext: SelectContext = {
    accessOf: (id) => this.access.of(id),
    stageCourse: (id) => this.stageCourse(id, this.race.modeId),
  };

  /** The clocks, then readiness, and select opened the moment the lobby's last seat readies. */
  // Room-command wiring (race-room-commands.ts); not room API.
  evaluate(): void {
    // A public lobby's start clock fills the empty seats before it readies everyone (spec D-C3).
    if (startClockRanOut(this.race) && this.occupancy() < MAX_PLAYERS) this.fillWithCpus();
    evaluateQuickMatch(this.race);
    // Any other way out of a public lobby fills it too, so no public race is short.
    if (leavesLobbyShort(this.race)) this.fillWithCpus();
    evaluateReadiness(this.race);
    enterSelect(this.race, this.selectContext);
  }

  /**
   * A finished room goes back to a fresh lobby.
   *
   * Everything the room owns beyond the race itself starts over too: queued
   * input, undelivered events, the physics world, and the seats of the
   * racers who did not make the new roster.
   */
  // Room-command wiring (race-room-commands.ts); not room API.
  raceAgain(): void {
    this.race = nextRace(this.race);

    this.inputQueue.reset();
    this.cpus.clear();
    this.recorder.clear();
    this.replayBytes = undefined;
    this.replayAfterPatch = undefined;
    this.pendingEvents = [];
    this.simulation.restore(this.race);

    const dropped = this.seats.keepOnly((playerId) => this.race.players[playerId] !== undefined);
    for (const { sessionId, playerId } of dropped) this.forgetSeat(sessionId, playerId);
    this.rehomeHost();
    this.syncLock();
    this.evaluate();
    this.project();
  }

  /**
   * Accepts one input frame for a player, and says what became of it.
   *
   * Input is taken from the countdown on, so a player holding a direction
   * through GO moves on the first racing tick exactly as they would locally;
   * it is refused in the lobby and once a race has finished.
   *
   * `metered` is false only for the test driver and the room's own CPUs, which supply frames faster
   * than a human hand could. Everything else about the path is identical --
   * phase, ownership, sequence and stamping are all still enforced -- so a
   * driven race is a real race rather than a simulation of one.
   */
  submitInput(
    playerId: PlayerId,
    input: InputFrame,
    metered: boolean,
  ): { outcome: InputOutcome; slack?: number } {
    if (!acceptsInput(this.race)) {
      return { outcome: "rejected-phase" };
    }

    if (metered && !this.inputMeter.spend(playerId)) return { outcome: "rejected-rate" };

    const result = this.inputQueue.submit(playerId, input, this.race.tick);
    if (!result.ok) {
      return {
        outcome:
          result.reason === "lead"
            ? "rejected-lead"
            : result.reason === "full"
              ? "rejected-full"
              : "rejected-sequence",
      };
    }
    return { outcome: result.slack < 0 ? "late" : "accepted", slack: result.slack };
  }

  /**
   * Each CPU decides on the state just stepped, and its frame takes effect
   * next tick: the same path, stamp and refusals as the test room driver's,
   * so the replay records a CPU as it records a person.
   */
  private driveCpus(): void {
    if (this.race.phase !== "racing") return;
    for (const [playerId, cpu] of this.cpus) {
      cpu.sequence += 1;
      const intent = cpu.controller.next(this.race, cpu.sequence);
      if (intent !== undefined) this.submitInput(playerId, { ...intent, tick: this.race.tick + 1 }, false);
    }
  }

  /**
   * The room's tick right now, fractional.
   *
   * The last tick run plus how far toward the next one the clock has got. A
   * ping's slack is measured against this rather than against the whole tick,
   * because a probe that arrives just before a tick and one that arrives just
   * after it are nearly a tick apart in how early they really were.
   */
  // Room-command wiring (race-room-commands.ts); not room API.
  nowTicks(now: number): number {
    const since = this.lastStepAt === undefined ? 0 : (now - this.lastStepAt) / TICK_MS;
    return this.race.tick + Math.min(1, Math.max(0, since));
  }

  // ── Seats leaving ──

  /**
   * Frees a seat and forgets everything the room held for it: queued input,
   * input budget, ping timing and command history. Every way a seat comes
   * free goes through here, so none of them can leave a piece behind.
   */
  private forgetSeat(sessionId: string, playerId: PlayerId): void {
    this.seats.release(sessionId);
    this.inputQueue.forget(playerId);
    this.inputMeter.forget(playerId);
    this.commandMeter.forget(playerId);
    this.lastPingAt.delete(sessionId);
    this.ledger.forget(sessionId);
    this.access.forget(playerId);
  }

  private removePlayer(sessionId: string, playerId: PlayerId): void {
    this.forgetSeat(sessionId, playerId);
    const player = this.race.players[playerId];
    if ((this.race.phase === "racing" || this.race.phase === "finished") && player !== undefined) {
      // On the results too (audit S12): `winnerId` and the standings keep a
      // leaver's id, so deleting their row left the others with no winner and
      // every place after it shown one too high. Race again prunes the DNS.
      // Mid-race, a racer who leaves did not finish, and the results have to
      // be able to say so -- the same reason an expired ghost becomes a DNS.
      // Deleting them instead left their body in the physics world with no
      // player behind it, and the next tick's body-count invariant halted the
      // race for everyone still in it.
      player.status = "dns";
      player.ready = false;
      delete player.ghostDeadlineTick;
    } else {
      delete this.race.players[playerId];
      // A seat that leaves during select loses its pick, and loading stops
      // waiting for it (select spec §5.4).
      if (this.race.select !== undefined) {
        delete this.race.select.picks[playerId];
        this.race.select.loaded = this.race.select.loaded.filter((id) => id !== playerId);
      }
    }

    this.rehomeHost();
    // A lock only ever means "full". Colyseus refuses a locked room with its own
    // "locked" message, which a joiner can only read as "full", so a racing room
    // is refused by `onAuth` on its phase instead. Any free seat therefore
    // reopens the room, whatever its phase (`raceAgain` does the same when it
    // prunes). The countdown falling back to the lobby frees no seat, so it
    // needs no unlock of its own.
    this.syncLock();
    this.evaluate();
    this.project();

    if (this.seats.size === 0) void this.disposeRoom();
  }

  private async disposeRoom(): Promise<void> {
    this.autoDispose = true;
    await this.disconnect();
  }

  // ── Helpers ──

  /** Seats taken: people (held seats included) and CPUs. What "full" means (CPU players spec §3.2). */
  private occupancy(): number {
    return this.seats.size + cpuCount(this.race);
  }

  /** Locks a full room and unlocks one with a free seat; a lock only ever means "full". */
  // Room-command wiring (race-room-commands.ts); not room API.
  syncLock(): void {
    if (this.occupancy() >= MAX_PLAYERS) this.lock();
    else this.unlock();
  }

  /** What a CPU may wear: every character in the catalogue, earned and paid alike. */
  // Room-command wiring (race-room-commands.ts); not room API.
  cpuCharacters(): readonly string[] {
    return this.content.content.characters.map((character) => character.id);
  }

  // Room-command wiring (race-room-commands.ts); not room API.
  fillWithCpus(): void {
    fillCpus(this.race, () => this.allocatePlayerId(), this.cpuCharacters());
    this.syncLock();
  }

  /**
   * Hands the host role on when the host no longer holds a seat: they left,
   * or "race again" dropped them as a DNS. `nextHost` picks a connected
   * player over one who has dropped.
   */
  private rehomeHost(): void {
    if (this.seats.sessionOf(this.race.hostId) !== undefined) return;
    const next = nextHost(this.race, this.seats.playerIds());
    if (next !== undefined) this.race.hostId = next;
  }

  // Room-command wiring (race-room-commands.ts); not room API.
  allocatePlayerId(): PlayerId {
    this.nextPlayerNumber += 1;
    return asPlayerId(`${this.roomId}-p${this.nextPlayerNumber}`);
  }

  // ── Test driver ──

  /** Marks a player ready without a client, for the test driver. */
  forceReady(playerId: PlayerId, ready: boolean): void {
    setReady(this.race, playerId, ready);
    this.project();
  }

  /** Ends a race without fabricating a result, for tests only. */
  finishForTest(): void {
    this.race = { ...this.race, phase: "finished" };
    this.project();
  }

  /** Every player currently seated, for the test driver's steering. */
  seatedPlayerIds(): PlayerId[] {
    return this.seats.playerIds();
  }
}

/** Registers the room type and injects what it needs, with no global reach. */
export function defineRaceRoom(
  gameServer: { define(name: string, handler: typeof RaceRoom): { sortBy(options: { clients: -1 }): unknown } },
  options: RaceRoomOptions,
): void {
  RaceRoom.options = options;
  // The fullest open public room first, so a small population gathers in one
  // room instead of spreading over several (quick-match spec §4.1).
  gameServer.define(RaceRoom.ROOM_NAME, RaceRoom).sortBy({ clients: -1 });
}
