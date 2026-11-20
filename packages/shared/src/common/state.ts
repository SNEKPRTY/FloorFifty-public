/**
 * Authoritative race state.
 *
 * `RaceState` is the whole truth of a race and is serializable, so a room can
 * be snapshotted, cloned for a simulation step, or compared byte-for-byte
 * between two deterministic runs.
 */

import { DEFAULT_CHARACTER_ID, DEFAULT_CLOCK_SECONDS, DEFAULT_MODE_ID, MAX_PLAYERS } from "./constants";
import type { LapCount, PlayerId, PlayerName } from "./ids";
import type { DeviceClass, PlayerStatus, RoomAccess, RoomPhase } from "./protocol";
import type { ResolvedTuning } from "./tuning";
import { SEAT_COLOURS, type SeatColour } from "./seats";
import type { Course, Floor } from "../level/course";
import type { SelectState } from "../room/select";
import { createCourse } from "../level/course";

export type PlayerState = {
  id: PlayerId;
  name: PlayerName;
  /**
   * The body this seat races in (a character ID), or `"?"` while the seat has
   * chosen random in the lobby. Cosmetic: nothing in the simulation reads it,
   * which `character-cosmetic.test.ts` proves.
   */
  characterId: string;
  /**
   * The colour this player races in, one of the four and unique in the room
   * (select spec §6.7). Cosmetic, as the character is.
   */
  colour: SeatColour;
  /** The seat's device, decided at boot (unlockables spec §3); never read by the simulation. */
  deviceClass: DeviceClass;
  /**
   * A CPU racer, steered by the room (CPU players spec §3). Always connected
   * and always ready; holds no client. Read once by the simulation, in
   * Survival's start wait, so a CPU's edge starts as it always has: a CPU acts
   * only after its reaction time (5 to 9 ticks), which would otherwise slide
   * its grace. A replay saved before the flag existed reads every seat as a
   * person, which is harmless: such a replay has no wait tunable either.
   */
  cpu: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingRight: boolean;
  /**
   * True on the tick a valid top-side landing resolved.
   *
   * It separates a landing from the lift that any other contact with a floor
   * gives, which is what lets a held fast fall cancel the second without
   * cancelling the first. Nothing on the wire carries it: it is read within a
   * tick and cleared at the start of the next.
   */
  grounded: boolean;
  /**
   * True from the race's start until this player's first input.
   *
   * The race is a continuous auto-bounce, but a racer who has not touched a
   * control yet stands on the starting floor instead of launching on the
   * first tick: nobody is carried up the course before they have played.
   * Any input ends it, and nothing sets it again -- a respawn is mid-play.
   */
  awaitingInput: boolean;
  /** One-based ascent the player is currently climbing. */
  lap: number;
  /** Floors landed on during the current ascent, seeded with the starting floor. */
  visitedFloorIds: string[];
  ready: boolean;
  status: PlayerStatus;
  /** Highest input sequence accepted; anything at or below it is stale. */
  lastSequence: number;
  /** Room tick at which this player's disconnection becomes a DNS. */
  ghostDeadlineTick?: number;
  /** Ticks from race start to this player's finish. */
  finishedAtTick?: number;
  /** The highest floor this racer was ever credited, kept through a fall (race-options spec §5.2, D-O3). */
  bestFloor: number;
  /** Ticks from race start to `bestFloor`'s credit; absent until a floor above 0 is credited. */
  bestFloorAtTick?: number;
  /** Survival's edge: the bottom of this racer's rising view; below it, they are out (survival spec §3). Unread on a finite course. */
  floorEdgeY: number;
  /** Ticks from race start to this racer going out, in Survival; absent while they stand. */
  outAtTick?: number;
  /**
   * Survival: the tick, counted from GO, at which this racer's edge stopped
   * waiting for their first input (first-race spec §2). The grace rests from
   * here. Absent is 0: the edge never waited (a computer racer, a race with
   * no wait, or a racer who pressed before the first tick passed).
   */
  edgeWaitTicks?: number;
  /**
   * The first tick on which a lapping racer is released (race-flow spec §4.1).
   * Absent when not held. Until then it rests at the spawn, still, its body
   * inactive; input is sequenced but moves nothing.
   */
  holdUntilTick?: number;
};

export type MovingFloorState = {
  id: string;
  x: number;
  direction: 1 | -1;
  /** Drawn per floor at generation; carried here so the step needs no course lookup. */
  speed: number;
};

export type RaceState = {
  tick: number;
  phase: RoomPhase;
  /** The course's seed: the chosen stage's frozen one (select spec §4.5). */
  seed: number;
  /** Seeds the roulette, once per room; `seed` is the course's, from the chosen stage. */
  roomSeed: number;
  /** Races this room has started, 0 before the first. Seeds the roulette. */
  round: number;
  /** The stage this race is on, from the stage reveal onward. */
  stageId?: string;
  /** The song this race plays, from the song reveal onward. A new round picks again. */
  songId?: string;
  /** What the roulette landed on in this room's last two selects, newest last; "?" draws around them. */
  recentPicks?: { stage?: readonly string[]; song?: readonly string[] };
  /** The select phase's progress; present only while `phase` is "select". */
  select?: SelectState;
  lapCount: LapCount;
  /** The race option the host chose (race-options spec §3.2). Its tuning is already in `tuning`. */
  modeId: string;
  /** Survival's chosen clock, in seconds (survival spec §5); in `tuning` as `RACE_TIME_LIMIT_TICKS` once a stage is applied. */
  clockSeconds: number;
  /** Resolved once at room creation and frozen for the life of the race. */
  tuning: ResolvedTuning;
  course: Course;
  /** Live horizontal position of every moving floor, keyed by floor id. */
  movingFloors: Record<string, MovingFloorState>;
  /** Survival: floors below this index are freed for good (survival spec §6). 0 on a finite course. */
  freedBelow: number;
  players: Record<PlayerId, PlayerState>;
  hostId: PlayerId;
  /** Whether strangers may be matched into this room; set at creation, never changed. */
  access: RoomAccess;
  /** A public lobby's start clock (quick-match spec §5.1); absent outside it. */
  startsAtTick?: number;
  /** A public lobby's search clock; absent outside it. */
  soloFromTick?: number;
  /** Finish order, appended as players complete their final ascent. */
  standings: PlayerId[];
  countdownEndsAtTick?: number;
  raceStartedAtTick?: number;
  winnerId?: PlayerId;
};

export type RaceConfig = {
  seed: number;
  /** The roulette's seed; defaults to `seed`. */
  roomSeed?: number;
  lapCount: LapCount;
  /** The race option; the default mode unless given. */
  modeId?: string;
  /** Survival's clock, in seconds; the default unless given. */
  clockSeconds?: number;
  tuning: ResolvedTuning;
  /** Whether strangers may be matched in; private unless given. */
  access?: RoomAccess;
  players: readonly { id: PlayerId; name: PlayerName }[];
};

/** Where a player stands when an ascent begins: centred on the starting floor. */
export function spawnPosition(course: Course, tuning: ResolvedTuning): { x: number; y: number } {
  const floor = course.floors[0]!;
  return {
    x: floor.x,
    y: floor.y + tuning.FLOOR_HEIGHT / 2 + tuning.PLAYER_HEIGHT / 2,
  };
}

/** Builds a player seated at the start of an ascent with the starting floor already visited. */
export function createPlayerState(
  id: PlayerId,
  name: PlayerName,
  course: Course,
  tuning: ResolvedTuning,
  colour: SeatColour = "scarlet",
  deviceClass: DeviceClass = "desktop",
): PlayerState {
  const spawn = spawnPosition(course, tuning);
  return {
    id,
    name,
    characterId: DEFAULT_CHARACTER_ID,
    colour,
    deviceClass,
    cpu: false,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    // At rest until the player's first input, which starts the bounce
    // (`applyInputs`); a respawn enters an ascent already bouncing.
    vy: 0,
    facingRight: true,
    grounded: true,
    awaitingInput: true,
    lap: 1,
    // The fixed starting floor counts as landed at spawn, so an ascent needs
    // `COURSE_FLOOR_COUNT - 1` further landings and a player never has to
    // return to the ground to finish.
    visitedFloorIds: [course.floors[0]!.id],
    bestFloor: 0,
    floorEdgeY: course.deathLineY,
    ready: false,
    status: "connected",
    lastSequence: 0,
  };
}

/** Initial horizontal state for every moving floor in a course. */
export function createMovingFloorStates(course: Course): Record<string, MovingFloorState> {
  const states: Record<string, MovingFloorState> = {};
  for (const floor of course.floors) {
    if (floor.kind === "moving") {
      states[floor.id] = {
        id: floor.id,
        x: floor.x,
        direction: floor.direction,
        speed: floor.speed,
      };
    }
  }
  return states;
}

/** Current horizontal position of a floor: generated for a stationary one, live for a moving one. */
export function floorX(state: RaceState, floor: Floor): number {
  return state.movingFloors[floor.id]?.x ?? floor.x;
}

/** Creates a race in `lobby`, ready to be ticked by whichever host owns the clock. */
export function createRaceState(config: RaceConfig): RaceState {
  if (config.players.length === 0) {
    throw new Error("a race needs at least one player");
  }
  if (config.players.length > MAX_PLAYERS) {
    throw new Error(`a room seats at most ${MAX_PLAYERS} players`);
  }

  const course = createCourse(config.seed, config.tuning);
  const players: Record<PlayerId, PlayerState> = {};
  for (const [index, player] of config.players.entries()) {
    players[player.id] = createPlayerState(player.id, player.name, course, config.tuning, SEAT_COLOURS[index % SEAT_COLOURS.length]!);
  }

  return {
    tick: 0,
    phase: "lobby",
    seed: config.seed,
    roomSeed: config.roomSeed ?? config.seed,
    round: 0,
    lapCount: config.lapCount,
    modeId: config.modeId ?? DEFAULT_MODE_ID,
    clockSeconds: config.clockSeconds ?? DEFAULT_CLOCK_SECONDS,
    tuning: config.tuning,
    course,
    movingFloors: createMovingFloorStates(course),
    freedBelow: 0,
    players,
    hostId: config.players[0]!.id,
    access: config.access ?? "private",
    standings: [],
  };
}

/**
 * Deep-copies the mutable parts of a race.
 *
 * `course` and `tuning` are immutable by construction and shared by reference;
 * everything a step may write is copied, so a step never mutates its input.
 */
export function cloneRaceState(state: RaceState): RaceState {
  const players: Record<PlayerId, PlayerState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id as PlayerId] = { ...player, visitedFloorIds: [...player.visitedFloorIds] };
  }

  // The spread-then-copy keeps the object shape growth relies on; a plain rebuild made late Infinite steps ~1.65x slower (audit remediation D-R9).
  const movingFloors: Record<string, MovingFloorState> = { ...state.movingFloors };
  for (const id in movingFloors) movingFloors[id] = { ...movingFloors[id]! };

  const select =
    state.select === undefined
      ? {}
      : {
          select: {
            ...state.select,
            picks: Object.fromEntries(
              Object.entries(state.select.picks).map(([id, pick]) => [id, { ...pick }]),
            ) as SelectState["picks"],
            loaded: [...state.select.loaded],
          },
        };

  return { ...state, players, movingFloors, standings: [...state.standings], ...select };
}
