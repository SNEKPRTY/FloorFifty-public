/**
 * A replay played on this device (race-options spec §7.2), as `TutorialRun`
 * plays the tutorial: the shared simulation stepped here, projected with
 * `raceToSnapshot`, drawn by the race's own scene.
 *
 * Each event's ID is re-keyed per playthrough. The audio engine never forgets
 * an event ID, and the replay re-emits the live race's, so without it every
 * cue would be silent -- and after Restart, or a second Watch replay, silent
 * again. Playthroughs are numbered across the page, not per run.
 *
 * Seeking re-simulates. A world restored mid-race is not the world that raced
 * there (`restore` drops the solver's warm-start caches, and the race drifts
 * within a second), so a seek back starts again from GO and steps forward,
 * a budget of milliseconds a frame, holding the last drawn frame meanwhile.
 * What a seek steps over is not heard, and a rewind is a new playthrough.
 */

import * as m from "../../paraglide/messages.js";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { REPLAY_INFLATE_MAX_BYTES, unpackReplay } from "@floor-fifty/shared/replay/compression";
import type { Replay } from "@floor-fifty/shared/replay/replay";
import { createReplayStepper, type ReplayStepper } from "@floor-fifty/shared/replay/stepper";
import { raceToSnapshot } from "../tutorial/tutorial-run";
import { streamCompression } from "./replay-compression";

/** The most ticks one frame may step: at 2× a frame steps two or more, and a slow device plays late rather than stalling. */
export const MAX_STEPS_PER_FRAME = 8;
/** How long one frame may spend stepping toward a seek; at least one step is always taken. */
export const SEEK_BUDGET_MS = 8;
/** Why a replay cannot be played, in the player's language when it is refused. */
export const VERSION_MISMATCH = (): string => m.replay_version_mismatch();

export type ReplaySpeed = 0.5 | 1 | 2;
/** Why, as the words' message rather than its text, so a language switch re-words it. */
export type ReplayRefusal = { message: () => string };
export type ReplayFrame = {
  snapshot: RoomSnapshot;
  /** This frame's events, re-keyed `replay:{playthrough}:{id}`. */
  events: readonly RaceEvent[];
  /** True on the first check that disagreed, and never again for this viewer. */
  driftedNow: boolean;
  finished: boolean;
  /** Still stepping toward a seek: `snapshot` is the frame drawn before it. */
  seeking: boolean;
};

/** Whether this client's content can play `replay` exactly (spec §7.2, step 1). */
export function checkReplay(replay: Replay, content: GameContent): ReplayRefusal | undefined {
  const { header } = replay;
  const same =
    header.rulesetRevision === content.rulesetRevision &&
    header.courseRevision === content.courseRevisions[header.stageId] &&
    content.content.modes.some((mode) => mode.id === header.modeId);
  return same ? undefined : { message: VERSION_MISMATCH };
}

/** The last playthrough number handed out on this page. */
let playthroughs = 0;

/** Replay simulations alive on this page, for the leak counters (spec §10.1). */
let liveSteppers = 0;
export function liveReplaySimulations(): number {
  return liveSteppers;
}

export class ReplayRun {
  /**
   * Inflates (capped, unlockables spec §6.4), decodes and checks; anything it
   * cannot play exactly is a refusal, not an error.
   */
  static async open(bytes: Uint8Array, content: GameContent): Promise<ReplayRun | ReplayRefusal> {
    let replay: Replay;
    try {
      replay = await unpackReplay(bytes, streamCompression, { maxInflatedBytes: REPLAY_INFLATE_MAX_BYTES });
    } catch {
      return { message: VERSION_MISMATCH };
    }
    return checkReplay(replay, content) ?? new ReplayRun(replay, content);
  }

  speed: ReplaySpeed = 1;
  playthrough = ++playthroughs;
  private stepper: ReplayStepper;
  private accumulated = 0;
  private paused = false;
  private drifted = false;
  /** Steps taken since GO: 0 is GO itself, `length` the finish. */
  private steps = 0;
  /** The position a seek is stepping toward. */
  private target: number | undefined;
  /** The last frame drawn, held while a seek catches up. */
  private shown: RoomSnapshot | undefined;

  private constructor(
    readonly replay: Replay,
    private readonly content: GameContent,
  ) {
    this.stepper = createReplayStepper(replay);
    liveSteppers += 1;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** The tick shown now. */
  get tick(): number {
    return this.stepper.state.tick;
  }

  /** Every step from GO to the finish. */
  get length(): number {
    return this.replay.finalTick - this.replay.header.go.tick + 1;
  }

  /** Steps taken since GO. */
  get position(): number {
    return this.steps;
  }

  get seeking(): boolean {
    return this.target !== undefined;
  }

  /**
   * Moves to `position` steps from GO, over the next frames: forward from
   * here, or back from GO. Paused stays paused.
   */
  seek(position: number): void {
    const target = Math.min(this.length, Math.max(0, Math.round(position)));
    if (target < this.steps) this.rewind();
    this.target = target === this.steps ? undefined : target;
    this.accumulated = 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulated = 0;
  }

  /**
   * Advances by `elapsedMs × speed × scale`, stepping at most
   * `MAX_STEPS_PER_FRAME` ticks; or, during a seek, as far toward it as
   * `budgetMs` allows.
   */
  advance(elapsedMs: number, scale = 1, budgetMs = SEEK_BUDGET_MS): ReplayFrame {
    if (this.target !== undefined) return this.seekFrame(budgetMs);
    const events: RaceEvent[] = [];
    let driftedNow = false;
    if (!this.paused && !this.stepper.done) {
      this.accumulated += elapsedMs * this.speed * scale;
      const due = Math.min(MAX_STEPS_PER_FRAME, Math.floor(this.accumulated / TICK_MS + 1e-6));
      // Time past the cap is dropped, as the tutorial drops it.
      this.accumulated = due === MAX_STEPS_PER_FRAME ? 0 : this.accumulated - due * TICK_MS;
      for (let i = 0; i < due && !this.stepper.done; i += 1) {
        if (this.stepOnce(events)) driftedNow = true;
      }
    }
    return { snapshot: this.project(events), events, driftedNow, finished: this.stepper.done, seeking: false };
  }

  private seekFrame(budgetMs: number): ReplayFrame {
    const target = this.target!;
    let driftedNow = false;
    const started = performance.now();
    do {
      if (this.steps >= target || this.stepper.done) break;
      // Stepped over, not heard: the events are dropped.
      if (this.stepOnce(undefined)) driftedNow = true;
    } while (performance.now() - started < budgetMs);
    if (this.steps < target && !this.stepper.done) {
      const snapshot = this.shown ?? this.project([]);
      return { snapshot, events: [], driftedNow, finished: false, seeking: true };
    }
    this.target = undefined;
    return { snapshot: this.project([]), events: [], driftedNow, finished: this.stepper.done, seeking: false };
  }

  /** One step; its events, re-keyed, into `events` when given. True on the first drift. */
  private stepOnce(events: RaceEvent[] | undefined): boolean {
    const step = this.stepper.step();
    this.steps += 1;
    if (events !== undefined) {
      for (const event of step.events) {
        events.push({ ...event, id: `replay:${this.playthrough}:${event.id}` as RaceEvent["id"] });
      }
    }
    if (step.check !== undefined && step.check.actual !== step.check.expected && !this.drifted) {
      this.drifted = true;
      return true;
    }
    return false;
  }

  private project(events: readonly RaceEvent[]): RoomSnapshot {
    this.shown = raceToSnapshot(this.stepper.state, events, {
      contentRevision: this.content.contentRevision,
      rulesetRevision: this.content.rulesetRevision,
    });
    return this.shown;
  }

  /** 0 at GO, 1 at the finish. */
  progress(): number {
    return Math.min(1, (this.target ?? this.steps) / this.length);
  }

  /** Back to GO, as a new playthrough: its events are keyed afresh, so its cues sound again. */
  restart(): void {
    this.rewind();
    this.target = undefined;
    this.accumulated = 0;
  }

  private rewind(): void {
    this.stepper.dispose();
    this.stepper = createReplayStepper(this.replay);
    this.playthrough = ++playthroughs;
    this.steps = 0;
  }

  private disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stepper.dispose();
    liveSteppers -= 1;
  }
}
