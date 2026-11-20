/**
 * The state a client is synchronized with.
 *
 * Decomposed rather than flat, because Colyseus patches per field: a room of
 * four racers and a hundred floors sends only what moved, which is what
 * replaces the snapshot's habit of resending the whole room twenty times a
 * second.
 *
 * Only the server mutates any of this. The Planck `World` is not here and
 * never will be: it is runtime machinery, and these are synchronized views of
 * the authority that owns it.
 *
 * Types are declared with `defineTypes` rather than decorators. The workspace
 * compiles without `experimentalDecorators`, and a migration is the wrong time
 * to change how every class in it is emitted.
 */

import { ArraySchema, MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { DEFAULT_CLOCK_SECONDS } from "@floor-fifty/shared/common/constants";
import { TUNABLES, type TunableName } from "@floor-fifty/shared/common/tuning";

/**
 * Absent, for an optional tick.
 *
 * Ticks are non-negative, so `-1` is unambiguous, and it survives the wire
 * where `NaN` and `undefined` do not. Every reader treats it as "not yet".
 */
export const ABSENT_TICK = -1;

/** Absent, for an optional identifier. */
export const ABSENT_ID = "";

export class TuningState extends Schema {
  declare COURSE_FLOOR_COUNT: number;
  declare FLOOR_WIDTH: number;
  declare FLOOR_HEIGHT: number;
  declare PLAYER_WIDTH: number;
  declare PLAYER_HEIGHT: number;
  declare GRAVITY: number;
  declare BOUNCE_VELOCITY: number;
  declare MAX_MOVE_SPEED: number;
  declare FAST_FALL_VELOCITY: number;
  declare FLOOR_GAP_MIN: number;
  declare FLOOR_GAP_MAX: number;
  declare MOVING_FLOOR_SPEED_MIN: number;
  declare MOVING_FLOOR_SPEED_MAX: number;
  declare DEATH_LINE_MARGIN: number;
  declare LAP_HOLD_TICKS: number;
  declare MOVING_FLOOR_CARRY: number;
  declare RACE_TIME_LIMIT_TICKS: number;
  declare SURVIVAL_VIEW_HEIGHT: number;
  declare SURVIVAL_GRACE_TICKS: number;
  declare SURVIVAL_START_WAIT_TICKS: number;
  declare SURVIVAL_RISE_START: number;
  declare SURVIVAL_RISE_STEP: number;
  declare SURVIVAL_RISE_STEP_TICKS: number;
  declare SURVIVAL_RISE_CAP: number;
  declare SURVIVAL_PUSH_AT: number;
  declare SURVIVAL_PUSH_SPEED: number;
  declare SURVIVAL_BAND_AHEAD_STEP: number;
  declare SURVIVAL_BAND_AHEAD_MAX: number;
  declare SURVIVAL_BAND_BEHIND_STEP: number;
  declare SURVIVAL_BAND_BEHIND_MIN: number;
  declare TUTORIAL_EDGE_RISE: number;
  declare TUTORIAL_EDGE_START_BELOW: number;
  declare DEMAND_RAMP_FROM_FLOOR: number;
  declare DEMAND_RAMP_BAND_FLOORS: number;
  declare MOVING_SHARE_STEP: number;
  declare MOVING_SHARE_MAX: number;
  declare MOVING_SPEED_STEP: number;
  declare MOVING_FLOOR_SPEED_CAP: number;
}

// Derived from the declarations rather than listed twice: a new tunable joins
// the wire without anyone remembering to add it here.
defineTypes(
  TuningState,
  Object.fromEntries((Object.keys(TUNABLES) as TunableName[]).map((name) => [name, "number"])),
);

export class PlayerStateSchema extends Schema {
  declare id: string;
  declare name: string;
  declare characterId: string;
  declare colour: string;
  /** The seat's device (unlockables spec §3). */
  declare deviceClass: string;
  /** A CPU racer (CPU players spec §3). */
  declare cpu: boolean;
  declare x: number;
  declare y: number;
  declare vx: number;
  declare vy: number;
  declare grounded: boolean;
  /** Standing on the starting floor until this player's first input. */
  declare awaitingInput: boolean;
  declare facingRight: boolean;
  declare lap: number;
  /** Fraction of the climb completed, in `[0, 1]` (`progressOf`). */
  declare progress: number;
  declare ready: boolean;
  /** `"connected" | "ghost" | "dns"`. */
  declare status: string;
  /** `ABSENT_TICK` until this player finishes. */
  declare finishedAtTick: number;
  /** `ABSENT_TICK` unless this player is held after a lap. */
  declare holdUntilTick: number;
  /** Highest input sequence authority has consumed, for prediction pruning. */
  declare lastAckedSequence: number;
  /** The highest floor ever credited (race-options spec §5.2). */
  declare bestFloor: number;
  /** `ABSENT_TICK` until a floor above 0 is credited. */
  declare bestFloorAtTick: number;
  /** Survival's edge (survival spec §3); unread on a finite course. */
  declare floorEdgeY: number;
  /** `ABSENT_TICK` unless this racer went out in Survival. */
  declare outAtTick: number;
  /** How long this racer's Survival edge waited for their first input (first-race spec §2); 0 when it never did. */
  declare edgeWaitTicks: number;

  constructor() {
    super();
    this.cpu = false;
    this.bestFloor = 0;
    this.bestFloorAtTick = ABSENT_TICK;
    this.floorEdgeY = 0;
    this.outAtTick = ABSENT_TICK;
    this.edgeWaitTicks = 0;
  }
}

defineTypes(PlayerStateSchema, {
  id: "string",
  name: "string",
  characterId: "string",
  colour: "string",
  deviceClass: "string",
  cpu: "boolean",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  grounded: "boolean",
  awaitingInput: "boolean",
  facingRight: "boolean",
  lap: "number",
  progress: "number",
  ready: "boolean",
  status: "string",
  finishedAtTick: "number",
  holdUntilTick: "number",
  lastAckedSequence: "number",
  bestFloor: "number",
  bestFloorAtTick: "number",
  floorEdgeY: "number",
  outAtTick: "number",
  edgeWaitTicks: "number",
});

export class PlatformStateSchema extends Schema {
  declare id: string;
  declare index: number;
  declare x: number;
  declare y: number;
  /** `1` or `-1`. Phase a client cannot recover from `x` alone. */
  declare direction: number;
  /** Players who have landed on this floor during their current ascent. */
  declare collectedBy: ArraySchema<string>;

  constructor() {
    super();
    this.collectedBy = new ArraySchema<string>();
  }
}

defineTypes(PlatformStateSchema, {
  id: "string",
  index: "number",
  x: "number",
  y: "number",
  direction: "number",
  collectedBy: ["string"],
});

/** One seat's focus in a pick step, whether it has locked in, and its seed choice. */
export class SelectPickSchema extends Schema {
  declare focus: string;
  declare locked: boolean;
  /** `"random"`, `"classic"` or the entered seed's digits (stage seeds spec §3.2). */
  declare seed: string;
}
defineTypes(SelectPickSchema, { focus: "string", locked: "boolean", seed: "string" });

/** The select phase (select spec §5.1); `step` is `ABSENT_ID` outside it. */
export class SelectStateSchema extends Schema {
  declare step: string;
  declare endsAtTick: number;
  declare picks: MapSchema<SelectPickSchema>;
  /** The roulette's stage, and whose pick it was; `ABSENT_ID` until drawn. */
  declare stageId: string;
  declare stagePickedBy: string;
  /** The seed the stage is raced on, and whether it is the authored one (stage seeds spec §3.2); −1 until drawn. */
  declare stageSeed: number;
  declare stageClassic: boolean;
  /** The roulette's song, and whose pick it was; `ABSENT_ID` until drawn. */
  declare songId: string;
  declare songPickedBy: string;
  declare loaded: ArraySchema<string>;
  constructor() {
    super();
    this.step = ABSENT_ID;
    this.endsAtTick = ABSENT_TICK;
    this.picks = new MapSchema<SelectPickSchema>();
    this.stageId = ABSENT_ID;
    this.stagePickedBy = ABSENT_ID;
    this.stageSeed = ABSENT_TICK;
    this.stageClassic = false;
    this.songId = ABSENT_ID;
    this.songPickedBy = ABSENT_ID;
    this.loaded = new ArraySchema<string>();
  }
}
defineTypes(SelectStateSchema, {
  step: "string",
  endsAtTick: "number",
  picks: { map: SelectPickSchema },
  stageId: "string",
  stagePickedBy: "string",
  stageSeed: "number",
  stageClassic: "boolean",
  songId: "string",
  songPickedBy: "string",
  loaded: ["string"],
});

export class RaceRoomState extends Schema {
  declare tick: number;
  /** `"lobby" | "select" | "countdown" | "racing" | "finished"`. */
  declare phase: string;
  declare seed: number;
  declare round: number;
  declare lapCount: number;
  declare floorCount: number;
  declare hostId: string;
  /** `"public" | "private"`: whether strangers may be matched in. Fixed at creation. */
  declare access: string;
  /** A public lobby's start clock; `ABSENT_TICK` outside it. */
  declare startsAtTick: number;
  /** A public lobby's search clock; `ABSENT_TICK` outside it. */
  declare soloFromTick: number;
  declare countdownEndsAtTick: number;
  declare raceStartedAtTick: number;
  declare contentRevision: string;
  declare rulesetRevision: string;
  /** `ABSENT_ID` until someone wins. */
  declare winnerId: string;
  declare tuning: TuningState;
  declare players: MapSchema<PlayerStateSchema>;
  declare platforms: MapSchema<PlatformStateSchema>;
  declare standings: ArraySchema<string>;
  /** The roulette's seed; `seed` is the course's. */
  declare roomSeed: number;
  /** The stage being raced; `ABSENT_ID` until the stage reveal. */
  declare stageId: string;
  /** That stage's course revision; `ABSENT_ID` until then. */
  declare courseRevision: string;
  /** The song being raced; `ABSENT_ID` until the song reveal. */
  declare songId: string;
  declare select: SelectStateSchema;
  /** The race option the host chose (race-options spec §3.2). */
  declare modeId: string;
  /** Survival's chosen clock, in seconds (survival spec §5). */
  declare clockSeconds: number;

  constructor() {
    super();
    this.tick = 0;
    this.phase = "lobby";
    this.seed = 0;
    this.round = 0;
    this.lapCount = 1;
    this.floorCount = 0;
    this.hostId = ABSENT_ID;
    this.access = "private";
    this.startsAtTick = ABSENT_TICK;
    this.soloFromTick = ABSENT_TICK;
    this.countdownEndsAtTick = ABSENT_TICK;
    this.raceStartedAtTick = ABSENT_TICK;
    this.contentRevision = ABSENT_ID;
    this.rulesetRevision = ABSENT_ID;
    this.winnerId = ABSENT_ID;
    this.tuning = new TuningState();
    this.players = new MapSchema<PlayerStateSchema>();
    this.platforms = new MapSchema<PlatformStateSchema>();
    this.standings = new ArraySchema<string>();
    this.roomSeed = 0;
    this.stageId = ABSENT_ID;
    this.courseRevision = ABSENT_ID;
    this.songId = ABSENT_ID;
    this.select = new SelectStateSchema();
    this.modeId = ABSENT_ID;
    this.clockSeconds = DEFAULT_CLOCK_SECONDS;
  }
}

defineTypes(RaceRoomState, {
  tick: "number",
  phase: "string",
  seed: "number",
  round: "number",
  lapCount: "number",
  floorCount: "number",
  hostId: "string",
  access: "string",
  startsAtTick: "number",
  soloFromTick: "number",
  countdownEndsAtTick: "number",
  raceStartedAtTick: "number",
  contentRevision: "string",
  rulesetRevision: "string",
  winnerId: "string",
  tuning: TuningState,
  players: { map: PlayerStateSchema },
  platforms: { map: PlatformStateSchema },
  standings: ["string"],
  roomSeed: "number",
  stageId: "string",
  courseRevision: "string",
  songId: "string",
  select: SelectStateSchema,
  modeId: "string",
  clockSeconds: "number",
});
