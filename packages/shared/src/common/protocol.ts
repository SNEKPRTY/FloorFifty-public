/**
 * The wire contract.
 *
 * Every type here is serializable and carries no authority a client could
 * claim: a client sends intent (`InputFrame`, readiness, lap selection) and the
 * server sends outcome (`RoomSnapshot`, `RaceEvent`).
 */

import type { RevisionHash } from "../content/game-content";
import type { LapCount, PlayerId, RaceEventId } from "./ids";
import type { ResolvedTuning } from "./tuning";
import type { SeatColour } from "./seats";
import type { SelectSnapshot } from "../room/select";

/**
 * What a player is holding, as the simulation reads it.
 *
 * The simulation needs only intent and a sequence to tell a new frame from a
 * held one. When that intent takes effect is the room's business, not the
 * simulation's, which is why the tick lives on the wire frame below and not
 * here.
 */
export type HeldInput = {
  sequence: number;
  left: boolean;
  right: boolean;
  fastFall: boolean;
  reset: boolean;
};

/**
 * One frame of player intent, as it crosses the wire.
 *
 * `tick` is the room tick the frame takes effect on. The client stamps the tick
 * it predicted the frame on, and the room holds the frame until that tick, so
 * both sides apply the same intent on the same tick. A frame that arrives
 * after its tick takes effect on the next tick the room steps: late, never
 * rewound, and never rejected for it. The server decides what it means.
 */
export type InputFrame = HeldInput & { tick: number };

/**
 * A clock probe, client to server.
 *
 * `tick` is the client's predicted tick, fractional, at the moment it sent the
 * probe, or -1 before it has one. The answer says how early that is.
 */
export type Ping = { id: number; tick: number };

/**
 * The answer to a `Ping`.
 *
 * `slack` is the probe's tick minus the room's own tick at the moment it
 * arrived, in ticks, positive meaning early. `null` when the probe carried no
 * tick. Sent immediately rather than after the next patch, because its whole
 * value is how long it took.
 */
export type Pong = { id: number; slack: number | null };

export type RoomPhase = "lobby" | "select" | "countdown" | "racing" | "finished";
export type PlayerStatus = "connected" | "ghost" | "dns";

/**
 * A seat's device, from its pointer and screen at boot (unlockables spec §3).
 * Not a rule: it never reaches the simulation, a replay's hash or a revision.
 */
export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Whether strangers may be matched into a room (quick-match spec §4.1). Fixed at creation. */
export type RoomAccess = "public" | "private";

export type RaceEventBase = { id: RaceEventId; tick: number };

/** Facts about the race that presentation may react to but never invent. */
export type RaceEvent = RaceEventBase &
  (
    | { type: "floorLanded"; playerId: PlayerId; floorId: string; floorIndex: number }
    | { type: "playerReset"; playerId: PlayerId; reason: "fall" | "manual" }
    | { type: "lapCompleted"; playerId: PlayerId; lap: number }
    | { type: "raceFinished"; winnerId: PlayerId }
    | { type: "playerOut"; playerId: PlayerId }
  );

export type PlayerSnapshot = {
  id: PlayerId;
  name: string;
  /** The body this seat wears, or "?" while random is chosen in the lobby. */
  characterId: string;
  /** The colour this player races in, unique in the room (select spec §6.7). */
  colour: SeatColour;
  /** The seat's device (unlockables spec §3): what the two-devices condition reads. */
  deviceClass: DeviceClass;
  /** A CPU racer (CPU players spec §3): the ready room's CPU seat, a racer like any other elsewhere. */
  cpu: boolean;
  x: number;
  y: number;
  /** Horizontal velocity, for a client replaying the simulation locally. */
  vx: number;
  /** Vertical velocity. Also what every player's pose is read from. */
  vy: number;
  /**
   * True on the tick a top-side landing resolved.
   *
   * Write-only in the simulation: four places assign it and none read it. It
   * travels so a client's reconstruction can be compared to authority as a
   * plain equality, with no field excused from the comparison.
   */
  grounded: boolean;
  /** Standing on the starting floor until this player's first input. */
  awaitingInput: boolean;
  /**
   * Highest input sequence this player's authority has consumed.
   *
   * A client prunes its unacknowledged buffer against this, which is what
   * bounds replay to the input the server has not yet seen.
   */
  lastAckedSequence: number;
  /** Rendering reads facing from the snapshot so remote players mirror correctly. */
  facingRight: boolean;
  lap: number;
  /**
   * Fraction of the climb completed, in `[0, 1]`: this ascent's floors on a
   * finite course, the best floor against the starting height on an endless one.
   */
  progress: number;
  ready: boolean;
  status: PlayerStatus;
  /** Ticks elapsed from race start to this player's finish, when finished. */
  finishedAtTick?: number;
  /** The first tick on which a lapping racer is released, while held (race-flow spec §4.1). */
  holdUntilTick?: number;
  /** The highest floor credited, kept through a fall (race-options spec §5.2). */
  bestFloor: number;
  /** Ticks from race start to `bestFloor`, once a floor above 0 is credited. */
  bestFloorAtTick?: number;
  /** Survival's edge: the bottom of this racer's rising view (survival spec §3). */
  floorEdgeY: number;
  /** Ticks from race start to this racer going out, in Survival. */
  outAtTick?: number;
  /**
   * Survival: the tick, from GO, at which this racer's edge stopped waiting for
   * their first input (first-race spec §2). Absent when it never waited.
   */
  edgeWaitTicks?: number;
};

export type PlatformSnapshot = {
  id: string;
  x: number;
  y: number;
  /**
   * Travel direction of a moving floor.
   *
   * Phase lives in `state.movingFloors` and a floor mid-span is heading one
   * way or the other with no way to tell from `x`, so a client cannot rebuild
   * motion without it.
   */
  direction: 1 | -1;
  /**
   * Players who have landed on this floor during their current ascent.
   *
   * One snapshot goes to the whole room, so the set travels rather than a
   * per-recipient flag, and each client renders against its own id. It is
   * derived from the server's `visitedFloorIds` and is never accepted from a
   * client.
   */
  collectedBy: readonly PlayerId[];
};

/** One authority broadcast. Everything a client renders derives from this. */
export type RoomSnapshot = {
  tick: number;
  phase: RoomPhase;
  /** The course's seed: the chosen stage's frozen one. */
  seed: number;
  /** The roulette's seed, once per room. */
  roomSeed: number;
  /** Races this room has started, 0 before the first. */
  round: number;
  /** The select phase's step, picks and results; present only in `select`. */
  select?: SelectSnapshot;
  /** The stage being raced, from the stage reveal onward. */
  stageId?: string;
  /** The song this race plays, from the song reveal on. */
  songId?: string;
  /**
   * That stage's `courseRevision`: with `rulesetRevision`, what a replay of
   * this race checks. "" before a stage is chosen.
   */
  courseRevision: string;
  /**
   * The room's resolved tuning.
   *
   * Prediction is only correct while both sides resolve the same numbers. It
   * rides the snapshot rather than a join payload so that a late join and a
   * reconnect cannot miss it.
   */
  tuning: ResolvedTuning;
  /**
   * The content this room froze at creation.
   *
   * Required, never optional: a room that can emit an identity-free snapshot
   * is a room whose content cannot be named in a bug report. It rides the
   * snapshot for the same reason `tuning` does -- one channel a late join and
   * a reconnect cannot miss -- and the bandwidth objection does not hold,
   * because fourteen tunables already ride every broadcast.
   *
   * The client compares it against its own cache and refetches `/content` on
   * a mismatch, which is what makes the revision notification an optimisation
   * rather than the mechanism.
   */
  contentRevision: RevisionHash;
  /**
   * The rules projection inside that content.
   *
   * No consumer yet. It is the identity a prediction or content failure
   * reports, and the successor to `LocalSimulation.agreesOnTuning` once the
   * client resolves part of the ruleset from its own cache.
   */
  rulesetRevision: RevisionHash;
  floorCount: number;
  lapCount: LapCount;
  /** The race option the host chose (race-options spec §3.2). */
  modeId: string;
  /** Survival's chosen clock, in seconds (survival spec §5). */
  clockSeconds: number;
  hostId: PlayerId;
  /** Whether strangers may be matched into this room. */
  access: RoomAccess;
  /**
   * A public lobby's start clock: the tick every connected seat is made ready.
   * Present while two or more racers are connected.
   */
  startsAtTick?: number;
  /**
   * A public lobby's search clock: the tick a lone racer may race alone.
   * Present while exactly one racer is connected.
   */
  soloFromTick?: number;
  countdownEndsAtTick?: number;
  /**
   * Room tick the race began on.
   *
   * Elapsed race time is derived from this and `tick`, so every client shows
   * the same clock however late it connected, and no client measures the race
   * against its own wall time.
   */
  raceStartedAtTick?: number;
  players: readonly PlayerSnapshot[];
  platforms: readonly PlatformSnapshot[];
  /** Events accumulated since the previous snapshot, in tick order. */
  events: readonly RaceEvent[];
  /** Finish order, decided by the server alone. */
  standings: readonly PlayerId[];
  winnerId?: PlayerId;
};

/** Failures a client is expected to render as a recoverable state. */
export type ServerErrorCode =
  | "INVALID_ROOM"
  | "ROOM_FULL"
  | "VERSION_MISMATCH"
  | "ROOM_CLOSED"
  | "NOT_HOST"
  | "MALFORMED_MESSAGE"
  | "RATE_LIMITED"
  | "STILL_SEARCHING"
  | "SIMULATION_FAILURE"
  /** A draining or newer-than-this server (release readiness §5.4, D-G7). */
  | "SERVER_UPDATING"
  /** At `MAX_ROOMS` (release readiness §6.1). */
  | "SERVER_BUSY"
  /** Raised by the client alone: nothing answered (offline, down, a 502). Never sent by a server (audit S7). */
  | "UNREACHABLE";

export type ServerError = { code: ServerErrorCode; message: string };

/**
 * Message names.
 *
 * Read by the room that registers the handlers and by the adapter that sends
 * them, so a typo is a compile error rather than a message nothing answers.
 * Creation and joining are absent: they are matchmaking calls, not messages.
 */
export const CLIENT_MESSAGES = {
  input: "input",
  ping: "ping",
  setReady: "setReady",
  setLapCount: "setLapCount",
  /** The host's Survival clock (survival spec §5). */
  setClock: "setClock",
  setMode: "setMode",
  pickCharacter: "pickCharacter",
  pickColour: "pickColour",
  reportAccess: "reportAccess",
  pickStage: "pickStage",
  pickSong: "pickSong",
  /** The seat's seed choice in the stage step (stage seeds spec §3.1). */
  pickSeed: "pickSeed",
  lockIn: "lockIn",
  loaded: "loaded",
  raceAgain: "raceAgain",
  /** Asks again for the finished race's replay, after a reload (race-options spec §6.4). */
  getReplay: "getReplay",
  /** The host seats a CPU in the next open seat (CPU players spec §3.1). */
  addCpu: "addCpu",
  /** The host frees a CPU's seat. */
  removeCpu: "removeCpu",
  /** "Keep room open": any seat answers the idle warning (audit B1). */
  stillHere: "stillHere",
} as const;

export const SERVER_MESSAGES = {
  commandResult: "commandResult",
  pong: "pong",
  raceEvents: "raceEvents",
  serverError: "serverError",
  /** Binary, unlike the rest: the finished race's deflated replay (race-options spec §6.4). */
  replay: "replay",
  /** A room nobody is using closes soon; any command keeps it open (audit B1). */
  idleWarning: "idleWarning",
} as const;

/** What the room says when it is about to close for want of anyone using it. */
export type IdleWarning = {
  /** Seconds until the room closes, or null once something has kept it open. */
  closesInSeconds: number | null;
};

/**
 * The answer to a correlated command.
 *
 * `requestId` is the client's own string and grants no authority: the server
 * uses it to address an answer and for nothing else.
 */
export type CommandResult =
  | { requestId: string; ok: true }
  | { requestId: string; ok: false; error: ServerError };
