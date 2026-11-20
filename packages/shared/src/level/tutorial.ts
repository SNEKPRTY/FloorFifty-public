/**
 * The interactive tutorial's steps (launch polish spec §3.1.4).
 *
 * Each step completes on what the simulation did, never on what was pressed:
 * a landing is a `floorLanded` event, a fast-fall is the velocity the
 * simulation applied. Here rather than in the client so a `tests/shared`
 * probe can prove the authored course lets every step complete.
 *
 * Each step is paced in three phases, so none can be cleared by accident
 * before its prompt has been read:
 *
 * - `frozen`: the step has just begun and the run stands still. A fresh press
 *   of the step's own control, after `MIN_FREEZE_TICKS`, lets it go.
 * - `active`: the run plays, and the step completes on what the simulation did.
 * - `cleared`: the run plays on for `CLEARED_TICKS`, crediting nothing -- the pause
 *   in which the prompt says so -- and then the next step begins frozen.
 *
 * The last step, `survive`, has an edge of the tutorial's own (first-race spec
 * §1) and one more phase, `caught`: the edge has reached her, "OUT!" stands for
 * `CAUGHT_TICKS`, and the step begins again frozen. The tutorial never ends on
 * a catch. It begins only once she stands on a floor that holds still: a
 * moving floor carries an idle player off it and the lava has her in mid-fall
 * in under 3 s, whatever the edge's start depth, so the step would test the
 * floor and not the lava.
 */

import { TICK_HZ } from "../common/constants";
import type { PlayerId } from "../common/ids";
import type { RaceEvent } from "../common/protocol";
import type { RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import type { Course } from "./course";

export const TUTORIAL_STEP_KINDS = ["move", "land", "fastFall", "landMoving", "survive"] as const;
export type TutorialStepKind = (typeof TUTORIAL_STEP_KINDS)[number];

export type TutorialPhase = "frozen" | "active" | "cleared" | "caught";

/** The least a step stays frozen: long enough to read its prompt. */
export const MIN_FREEZE_TICKS = Math.round(TICK_HZ * 0.4);
/** How long a cleared step's "Nice." stands before the next step freezes. */
export const CLEARED_TICKS = Math.round(TICK_HZ * 1.1);
/**
 * The most "Nice." stands, waiting for a floor that holds still, so a player is
 * never held on it. Past this the next landing begins the step wherever it is.
 * A hands-off player drops to a still floor within about 3 s of the step
 * before; the rest is for one who keeps climbing the moving floors.
 */
export const CLEARED_MAX_TICKS = Math.round(TICK_HZ * 6);
/** Floors to climb above where the survive step began (first-race spec §1). */
export const SURVIVE_FLOORS = 3;
/** How long "OUT!" stands before the survive step starts again. */
export const CAUGHT_TICKS = Math.round(TICK_HZ * 1.5);

export type TutorialInput = { left: boolean; right: boolean; fastFall: boolean; reset: boolean };

/** One simulated tick, as the script reads it: what was held, and what came of it. */
export type TutorialTick = {
  readonly playerId: PlayerId;
  readonly input: TutorialInput;
  readonly after: RaceState;
  readonly events: readonly RaceEvent[];
};

type FloorLanded = Extract<RaceEvent, { type: "floorLanded" }>;

/** The control that lets a frozen step go: the one the step teaches. */
export function unlocksStep(step: TutorialStepKind, input: TutorialInput): boolean {
  switch (step) {
    case "move":
    case "land":
    case "landMoving":
      return input.left || input.right;
    case "fastFall":
      return input.fastFall;
    case "survive":
      // Not a restart press: that is a catch on this step, not a way in.
      return input.left || input.right || input.fastFall;
  }
}

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
 * The tutorial edge's height `activeTicks` into the step: it starts
 * `TUTORIAL_EDGE_START_BELOW` under the floor at `startFloorY` and rises
 * `TUTORIAL_EDGE_RISE` a second from the first tick the step runs.
 */
export function tutorialEdgeY(startFloorY: number, activeTicks: number, tuning: EdgeTuning): number {
  return startFloorY - tuning.TUTORIAL_EDGE_START_BELOW + tuning.TUTORIAL_EDGE_RISE * (activeTicks / TICK_HZ);
}

/**
 * Walks the authored steps in order. Only the current step is checked, so a
 * player who does a later step early is not credited for it -- the prompt on
 * screen is always the step that is next.
 */
export class TutorialScript {
  private at = 0;
  /** `move` asks for both directions; each is remembered until the step ends. */
  private movedLeft = false;
  private movedRight = false;
  private stage: TutorialPhase = "frozen";
  /** Ticks spent in the current phase. */
  private ticks = 0;
  /**
   * Whether the unlock control was down on the last frozen tick. Only a press
   * seen going down lets a step go, so a key held over from the last step
   * does not.
   */
  private held = false;

  /** The floor the survive step began on (0 when it began too near the top). */
  private surviveFrom = 0;
  /** The height of that floor: the edge is anchored under it. */
  private startFloorY = 0;
  /** Ticks the survive step has run, which is how far its edge has risen. */
  private surviveTicks = 0;
  /** The tuning the edge reads, taken from the tick the step began on. */
  private edgeTuning: EdgeTuning | undefined;
  private caughtOnce = false;
  private startPending = false;

  /**
   * `course` is where the survive step reads floor heights and the course's
   * top from; the script reads tuning from the ticks it observes, as its
   * `fastFall` step does.
   */
  constructor(
    private readonly steps: readonly TutorialStepKind[],
    private readonly course: Pick<Course, "floors" | "floorCount">,
  ) {}

  get index(): number {
    return this.at;
  }

  get current(): TutorialStepKind | undefined {
    return this.steps[this.at];
  }

  /** Where the current step is in its pacing. Meaningless once `done`. */
  get phase(): TutorialPhase {
    return this.stage;
  }

  get done(): boolean {
    return this.at >= this.steps.length;
  }

  /** Marks every step done: the player chose to skip. */
  skip(): void {
    this.at = this.steps.length;
    this.caughtOnce = false;
    this.startPending = false;
  }

  /**
   * The survive step's edge height: where it starts while the step is frozen,
   * rising while it runs, held while "OUT!" shows and once the step is
   * cleared. Undefined on every other step.
   */
  get edgeY(): number | undefined {
    if (this.current !== "survive" || this.edgeTuning === undefined) return undefined;
    return tutorialEdgeY(this.startFloorY, this.surviveTicks, this.edgeTuning);
  }

  /** True from a catch until she lets the restarted step go. */
  get caught(): boolean {
    return this.caughtOnce;
  }

  /** The floor whose landing completes the survive step. Undefined on other steps. */
  get surviveGoalFloor(): number | undefined {
    return this.current === "survive" ? this.surviveFrom + SURVIVE_FLOORS : undefined;
  }

  /**
   * The step began too near the top of the course to climb three more floors,
   * so the run must put her at the start. True until `startHandled()`.
   */
  get needsStart(): boolean {
    return this.startPending;
  }

  /** The run has put her at the start. */
  startHandled(): void {
    this.startPending = false;
  }

  /**
   * Reads one tick of "OUT!", with nothing simulated. True on the tick the
   * step must start again: the script is then frozen, its edge back at its
   * start, and `caught` stays true until she lets the step go.
   */
  observeCaught(): boolean {
    if (this.stage !== "caught") return false;
    this.ticks += 1;
    if (this.ticks < CAUGHT_TICKS) return false;
    this.stage = "frozen";
    this.ticks = 0;
    this.surviveTicks = 0;
    // A key held through the catch must not start the step again: only a
    // press seen going down does, as after any other step.
    this.held = true;
    return true;
  }

  /**
   * Reads one tick's held input while the step is frozen, with nothing
   * simulated. True when it let the step go: that tick is then stepped, so
   * the press that unfroze it also acts.
   */
  observeFrozen(input: TutorialInput): boolean {
    const step = this.current;
    if (step === undefined || this.stage !== "frozen") return false;
    this.ticks += 1;
    const pressed = unlocksStep(step, input);
    const fresh = pressed && !this.held;
    this.held = pressed;
    if (!fresh || this.ticks < MIN_FREEZE_TICKS) return false;
    this.stage = "active";
    this.ticks = 0;
    this.caughtOnce = false;
    return true;
  }

  /**
   * Reads one simulated tick. True when it completed the current step, which
   * then stands cleared for `CLEARED_TICKS` before the next one freezes.
   */
  observe(tick: TutorialTick): boolean {
    const step = this.current;
    if (step === undefined) return false;
    if (this.stage === "cleared") {
      this.ticks += 1;
      if (this.ticks < CLEARED_TICKS) return false;
      // The survive step starts on a landing: a body saved in the air could be
      // falling past the floor under it, and every restart would replay that.
      // It also starts on a floor that holds still, so that each restart puts
      // her on ground the lava, not the floor, has to be survived from; the
      // wait for one is bounded by `CLEARED_MAX_TICKS`.
      const beginsSurvive = this.steps[this.at + 1] === "survive";
      if (beginsSurvive && !this.canBeginSurvive(tick)) return false;
      this.next(tick.input);
      if (beginsSurvive) this.beginSurvive(tick);
      return false;
    }
    if (this.stage !== "active") return false;
    if (step === "survive") return this.observeSurvive(tick);
    if (!this.completes(step, tick)) return false;
    this.stage = "cleared";
    this.ticks = 0;
    return true;
  }

  /** She has landed, and on a floor that holds still (or the wait for one has run out). */
  private canBeginSurvive(tick: TutorialTick): boolean {
    if (tick.after.players[tick.playerId]?.grounded !== true) return false;
    if (this.ticks >= CLEARED_MAX_TICKS) return true;
    return this.course.floors[floorUnder(tick.after, tick.playerId)]?.kind === "stationary";
  }

  /**
   * Anchors the survive step to her body on the tick she landed: the edge
   * starts under the floor she is on, never under the last floor she was
   * credited, which she may have dropped well below.
   */
  private beginSurvive(tick: TutorialTick): void {
    const floors = this.course.floors;
    this.edgeTuning = tick.after.tuning;
    this.surviveTicks = 0;
    this.caughtOnce = false;
    this.surviveFrom = floorUnder(tick.after, tick.playerId);
    this.startPending = this.surviveFrom + SURVIVE_FLOORS > this.course.floorCount - 1;
    if (this.startPending) this.surviveFrom = 0;
    this.startFloorY = floors[this.surviveFrom]?.y ?? 0;
  }

  /**
   * One tick of the survive step. Done on reaching the goal floor, read two
   * ways so neither a first visit nor a return is missed: a landing event (a
   * first credit on that ascent) or standing on it (a floor she had already
   * visited raises none). Caught when she is wholly below the edge, as in a
   * race, or on a restart press or a fall past the bottom.
   */
  private observeSurvive(tick: TutorialTick): boolean {
    const player = tick.after.players[tick.playerId];
    const edge = this.edgeY;
    if (player === undefined || edge === undefined) return false;
    const goal = this.surviveFrom + SURVIVE_FLOORS;
    const landedOnGoal = tick.events.some(
      (event) => event.type === "floorLanded" && event.playerId === tick.playerId && event.floorIndex >= goal,
    );
    if (landedOnGoal || (player.grounded && floorUnder(tick.after, tick.playerId) >= goal)) {
      this.stage = "cleared";
      this.ticks = 0;
      return true;
    }
    const reset = tick.events.some((event) => event.type === "playerReset" && event.playerId === tick.playerId);
    // Judged against the edge as it stood before this tick's rise: half a unit's lag at 30 a second.
    if (reset || player.y + tick.after.tuning.PLAYER_HEIGHT / 2 < edge) {
      this.stage = "caught";
      this.ticks = 0;
      this.caughtOnce = true;
      return false;
    }
    this.surviveTicks += 1;
    return false;
  }

  private next(input: TutorialInput): void {
    this.at += 1;
    this.movedLeft = false;
    this.movedRight = false;
    this.stage = "frozen";
    this.ticks = 0;
    const step = this.current;
    this.held = step !== undefined && unlocksStep(step, input);
  }

  private completes(step: TutorialStepKind, tick: TutorialTick): boolean {
    const player = tick.after.players[tick.playerId];
    if (player === undefined) return false;
    const mine = tick.events.filter((event) => "playerId" in event && event.playerId === tick.playerId);
    const landings = mine.filter((event): event is FloorLanded => event.type === "floorLanded");

    switch (step) {
      case "move":
        if (player.vx < 0) this.movedLeft = true;
        if (player.vx > 0) this.movedRight = true;
        return this.movedLeft && this.movedRight;
      case "land":
        // Floor 0 is the start, which a bounce lands on without steering.
        return landings.some((event) => event.floorIndex >= 1);
      case "fastFall":
        return tick.input.fastFall && player.vy === tick.after.tuning.FAST_FALL_VELOCITY;
      case "landMoving":
        return landings.some((event) => tick.after.course.floors[event.floorIndex]?.kind === "moving");
      case "survive":
        // Read by `observeSurvive`, which also watches for the catch.
        return false;
    }
  }
}
