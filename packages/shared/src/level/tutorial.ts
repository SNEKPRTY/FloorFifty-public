/**
 * The story's script: what the simulation saw, and the beats of talk it earns.
 *
 * Each move completes on what the simulation did, never on what was pressed:
 * a landing is a `floorLanded` event, a fast fall is the velocity the
 * simulation applied. Here rather than in the client so a `tests/shared`
 * probe can prove every chapter's course lets its moves be done. The file
 * keeps its old name, which the survive rules and the edge tuning still carry.
 *
 * The script never holds the run still. The climb goes on while a line shows
 * and a chip names a control; the only pause is "OUT!" after a catch, on the
 * last chapter's lava, which stands for `CAUGHT_TICKS` and puts her back at
 * the lava cue's floor. The lava begins only once she stands on a floor that
 * holds still: a moving floor carries an idle player off it and the lava has
 * her in mid-fall in under 3 s, whatever the edge's start depth, so the cue
 * would test the floor and not the lava.
 */

import { TICK_HZ } from "../common/constants";
import type { PlayerId } from "../common/ids";
import type { RaceEvent } from "../common/protocol";
import type { RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import type { Course } from "./course";

export const STORY_MOVES = ["move", "land", "fastFall", "landMoving", "survive"] as const;
export type StoryMove = (typeof STORY_MOVES)[number];

/** Floors to climb above where the lava cue began (first-race spec §1). */
export const SURVIVE_FLOORS = 3;
/** How long "OUT!" stands before the lava cue starts again. */
export const CAUGHT_TICKS = Math.round(TICK_HZ * 1.5);
/** A chip stays up this long at its cue, then goes until she has been stuck `CHIP_RETURN_TICKS`. */
export const CHIP_SHOW_TICKS = Math.round(TICK_HZ * 4);
/** Ticks at a cue without the move before its chip comes back (and stays until the move). */
export const CHIP_RETURN_TICKS = Math.round(TICK_HZ * 6);

/** The moves that have a control to name; the others are learned by climbing. */
export const CHIP_KINDS = ["move", "fastFall"] as const satisfies readonly StoryMove[];
export type ChipKind = (typeof CHIP_KINDS)[number];

export type StoryInput = { left: boolean; right: boolean; fastFall: boolean; reset: boolean };

/** One simulated tick, as the script reads it: what was held, and what came of it. */
export type StoryTick = {
  readonly playerId: PlayerId;
  readonly input: StoryInput;
  readonly after: RaceState;
  readonly events: readonly RaceEvent[];
};

/** What the script reads of a cue: the moment it fires at, and the move it asks for. */
export type StoryBeatTrigger = {
  readonly when: "start" | "floor" | "done" | "caught" | "goal";
  readonly floor?: number | undefined;
  readonly of?: StoryMove | undefined;
  readonly teaches?: StoryMove | undefined;
};

/** What the script reads of a chapter. */
export type StoryChapterPlan = { readonly goalFloor: number; readonly beats: readonly StoryBeatTrigger[] };

type FloorLanded = Extract<RaceEvent, { type: "floorLanded" }>;
type EdgeTuning = Pick<ResolvedTuning, "TUTORIAL_EDGE_RISE" | "TUTORIAL_EDGE_START_BELOW">;

/**
 * The highest floor at or below the player's body: the floor she is on, or the
 * one she would land on if she fell straight down. 0 below every floor.
 */
export function floorUnder(state: RaceState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (player === undefined) return 0;
  let under = 0;
  for (const floor of state.course.floors) {
    if (floor.y <= player.y) under = Math.max(under, floor.index);
  }
  return under;
}

/**
 * The lava edge's height `activeTicks` into the cue: it starts
 * `TUTORIAL_EDGE_START_BELOW` under the floor at `startFloorY` and rises
 * `TUTORIAL_EDGE_RISE` a second from the first tick the cue runs.
 */
export function storyEdgeY(startFloorY: number, activeTicks: number, tuning: EdgeTuning): number {
  return startFloorY - tuning.TUTORIAL_EDGE_START_BELOW + tuning.TUTORIAL_EDGE_RISE * (activeTicks / TICK_HZ);
}

/**
 * One chapter's script. It fires beats once each, in order of when they come
 * due, and ends the chapter when she has reached the goal floor with every
 * move the chapter teaches done. `take()` hands the client the beats that have
 * fired since it last asked; the client decides how long each line stands.
 */
export class StoryScript {
  private readonly queue: number[] = [];
  private readonly fired = new Set<number>();
  private readonly did = new Set<StoryMove>();
  private highestFloor = 0;
  private finished = false;

  /** The cue whose move the chip is naming, and the tick it last fired on. */
  private chipBeat: number | undefined;
  private chipTicks = 0;

  /** The lava cue: where it began, and how far the edge has risen. */
  private surviveBeat: number | undefined;
  private surviveFrom = 0;
  private startFloorY = 0;
  private surviveTicks = 0;
  private lavaOn = false;
  private edgeTuning: EdgeTuning | undefined;
  private caughtTicks = 0;
  private caughtOnce = false;
  private startPending = false;
  /** Floors at or above the goal that already re-asked for a missing move. */
  private reasked = -1;

  constructor(
    private readonly chapter: StoryChapterPlan,
    private readonly course: Pick<Course, "floors" | "floorCount">,
  ) {
    this.chapter.beats.forEach((cue, index) => {
      if (cue.when === "start") this.fire(index);
    });
  }

  /** The chapter's moves, in the order its beats teach them. */
  get teaches(): readonly StoryMove[] {
    return this.chapter.beats.flatMap((cue) => (cue.teaches === undefined ? [] : [cue.teaches]));
  }

  /** Every move the chapter teaches is done and she reached the goal floor. */
  get done(): boolean {
    return this.finished;
  }

  /** The beats that fired since the last call, in the order they fired. */
  take(): number[] {
    return this.queue.splice(0);
  }

  hasDone(kind: StoryMove): boolean {
    return this.did.has(kind);
  }

  /** The highest floor she has been credited. */
  get floor(): number {
    return this.highestFloor;
  }

  /**
   * The control the chip names, or undefined while it is down. It is up from
   * its cue for `CHIP_SHOW_TICKS`, down until she has been `CHIP_RETURN_TICKS`
   * at that cue without the move, then up until she makes it. Never for
   * landing, moving floors or the lava.
   */
  get chip(): ChipKind | undefined {
    if (this.chipBeat === undefined || this.finished) return undefined;
    const kind = this.chapter.beats[this.chipBeat]?.teaches;
    if (kind !== "move" && kind !== "fastFall") return undefined;
    if (this.did.has(kind)) return undefined;
    if (this.chipTicks < CHIP_SHOW_TICKS || this.chipTicks >= CHIP_RETURN_TICKS) return kind;
    return undefined;
  }

  /** The lava's edge height while the lava cue runs; undefined before and after it. */
  get edgeY(): number | undefined {
    if (!this.lavaOn || this.edgeTuning === undefined) return undefined;
    return storyEdgeY(this.startFloorY, this.surviveTicks, this.edgeTuning);
  }

  /** True from a catch until the lava cue has started again. */
  get caught(): boolean {
    return this.caughtOnce;
  }

  /** The floor whose landing completes the lava cue. Undefined before it begins. */
  get surviveGoalFloor(): number | undefined {
    return this.lavaOn || this.caughtOnce ? this.surviveFrom + SURVIVE_FLOORS : undefined;
  }

  /**
   * The lava cue began too near the top of the course to climb its floors, so
   * the run must put her at the start. True until `startHandled()`.
   */
  get needsStart(): boolean {
    return this.startPending;
  }

  startHandled(): void {
    this.startPending = false;
  }

  /** Marks the chapter over: the player chose to skip. */
  skip(): void {
    this.finished = true;
    this.lavaOn = false;
    this.caughtOnce = false;
    this.startPending = false;
  }

  /**
   * Reads one tick of "OUT!", with nothing simulated. True on the tick the lava
   * cue must start again, with its edge back at its start.
   */
  observeCaught(): boolean {
    if (!this.caughtOnce) return false;
    this.caughtTicks += 1;
    if (this.caughtTicks < CAUGHT_TICKS) return false;
    this.caughtOnce = false;
    this.caughtTicks = 0;
    this.surviveTicks = 0;
    this.lavaOn = true;
    return true;
  }

  /** True while "OUT!" stands: the run does not step, and `observeCaught` counts it down. */
  get standing(): boolean {
    return this.caughtOnce;
  }

  /** Reads one simulated tick. True when it ended the chapter. */
  observe(tick: StoryTick): boolean {
    if (this.finished) return false;
    const player = tick.after.players[tick.playerId];
    if (player === undefined) return false;
    this.chipTicks += 1;

    const mine = tick.events.filter((event) => "playerId" in event && event.playerId === tick.playerId);
    const landings = mine.filter((event): event is FloorLanded => event.type === "floorLanded");
    for (const landing of landings) this.highestFloor = Math.max(this.highestFloor, landing.floorIndex);

    this.markDone(tick, landings);
    this.fireFloorBeats();
    this.beginSurviveIfDue(tick, landings);
    if (this.lavaOn) this.observeSurvive(tick, landings);
    if (this.caughtOnce) return false;
    return this.endIfReached(tick, landings);
  }

  /** The moves seen this tick. */
  private markDone(tick: StoryTick, landings: readonly FloorLanded[]): void {
    const player = tick.after.players[tick.playerId]!;
    const steered = (tick.input.left && player.vx < 0) || (tick.input.right && player.vx > 0);
    if (steered) this.markKind("move");
    if (landings.some((event) => event.floorIndex >= 1)) this.markKind("land");
    if (tick.input.fastFall && player.vy === tick.after.tuning.FAST_FALL_VELOCITY) this.markKind("fastFall");
    if (landings.some((event) => tick.after.course.floors[event.floorIndex]?.kind === "moving")) this.markKind("landMoving");
  }

  private markKind(kind: StoryMove): void {
    if (this.did.has(kind)) return;
    this.did.add(kind);
    this.chapter.beats.forEach((cue, index) => {
      if (cue.when === "done" && cue.of === kind) this.fire(index);
    });
  }

  private fireFloorBeats(): void {
    this.chapter.beats.forEach((cue, index) => {
      if (cue.when === "floor" && cue.floor !== undefined && this.highestFloor >= cue.floor) this.fire(index);
    });
  }

  private fire(index: number, again = false): void {
    if (this.fired.has(index) && !again) return;
    this.fired.add(index);
    this.queue.push(index);
    const cue = this.chapter.beats[index]!;
    if (cue.teaches !== undefined && cue.teaches !== "survive") {
      this.chipBeat = index;
      this.chipTicks = 0;
    }
    if (cue.teaches === "survive") this.surviveBeat = index;
  }

  /**
   * The lava starts on a landing at or past its cue's floor, on a floor that
   * holds still: a body saved in the air could be falling past the floor under
   * it, and every restart would replay that. A landing is read two ways, as in
   * `observeSurvive`: the credit event, or standing there (a floor she had
   * already visited raises none, and a bounce can leave the floor in the same
   * tick it lands, so `grounded` alone would miss a climber).
   */
  private beginSurviveIfDue(tick: StoryTick, landings: readonly FloorLanded[]): void {
    if (this.lavaOn || this.caughtOnce || this.surviveBeat === undefined || this.did.has("survive")) return;
    const floors = this.course.floors;
    const from = this.chapter.beats[this.surviveBeat]?.floor ?? 0;
    const player = tick.after.players[tick.playerId];
    const under = floorUnder(tick.after, tick.playerId);
    const landed = landings.find(
      (event) => event.floorIndex >= from && floors[event.floorIndex]?.kind === "stationary",
    )?.floorIndex;
    const standing = player?.grounded === true && under >= from && floors[under]?.kind === "stationary" ? under : undefined;
    const at = landed ?? standing;
    if (at === undefined) return;
    this.edgeTuning = tick.after.tuning;
    this.surviveTicks = 0;
    this.surviveFrom = at;
    this.startPending = this.surviveFrom + SURVIVE_FLOORS > this.course.floorCount - 1;
    if (this.startPending) this.surviveFrom = 0;
    this.startFloorY = floors[this.surviveFrom]?.y ?? 0;
    this.lavaOn = true;
  }

  /**
   * One tick of the lava cue. Done on reaching its goal floor, read two ways so
   * neither a first visit nor a return is missed: a landing event or standing
   * on it. Caught when she is wholly below the edge, as in a race, or on a
   * restart press or a fall past the bottom.
   */
  private observeSurvive(tick: StoryTick, landings: readonly FloorLanded[]): void {
    const player = tick.after.players[tick.playerId];
    const edge = this.edgeY;
    if (player === undefined || edge === undefined) return;
    const goal = this.surviveFrom + SURVIVE_FLOORS;
    const landedOnGoal = landings.some((event) => event.floorIndex >= goal);
    if (landedOnGoal || (player.grounded && floorUnder(tick.after, tick.playerId) >= goal)) {
      this.lavaOn = false;
      this.did.add("survive");
      return;
    }
    const reset = tick.events.some((event) => event.type === "playerReset" && event.playerId === tick.playerId);
    // Judged against the edge as it stood before this tick's rise: half a unit's lag at 30 a second.
    if (reset || player.y + tick.after.tuning.PLAYER_HEIGHT / 2 < edge) {
      this.lavaOn = false;
      this.caughtOnce = true;
      this.caughtTicks = 0;
      this.chapter.beats.forEach((cue, index) => {
        if (cue.when === "caught") this.fire(index, true);
      });
      return;
    }
    this.surviveTicks += 1;
  }

  /**
   * She stands at or above the goal floor with every move done: the goal cue
   * plays and the chapter is over. A move still missing (the one a course
   * cannot force) keeps the chapter open, and its reason shows again.
   */
  private endIfReached(tick: StoryTick, landings: readonly FloorLanded[]): boolean {
    const player = tick.after.players[tick.playerId]!;
    const reached =
      this.highestFloor >= this.chapter.goalFloor ||
      (player.grounded && floorUnder(tick.after, tick.playerId) >= this.chapter.goalFloor);
    if (!reached) return false;
    const missing = this.teaches.filter((kind) => !this.did.has(kind));
    if (missing.length > 0) {
      // Once per landing at or past the goal, so a player who is stuck is told again, not nagged every tick.
      const landed = landings.some((event) => event.floorIndex >= this.chapter.goalFloor);
      if (landed && tick.after.tick !== this.reasked) {
        this.reasked = tick.after.tick;
        const index = this.chapter.beats.findIndex((cue) => cue.teaches === missing[0]);
        if (index >= 0) this.fire(index, true);
      }
      return false;
    }
    this.chapter.beats.forEach((cue, index) => {
      if (cue.when === "goal") this.fire(index);
    });
    this.finished = true;
    return true;
  }
}
