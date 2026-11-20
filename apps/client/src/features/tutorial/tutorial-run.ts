/**
 * The tutorial, stepped here with no server (launch polish spec §3.1.4).
 *
 * The same `RaceSimulation` a room runs, on fixed ticks paced by the render
 * clock. Nothing is sent anywhere. Pausing freezes it, because here -- unlike
 * a networked race -- nothing else is running.
 *
 * The race starts as a room's does: the player waits on the starting floor
 * until their first input, which starts the bounce.
 *
 * The last step has an edge of the tutorial's own (`TutorialScript.edgeY`).
 * When it catches her the run shows "OUT!", stands still for `CAUGHT_TICKS`,
 * and puts her back where the step began: the tutorial never ends on a catch.
 */

import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, raceEventId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, createRaceState, floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { RevisionHash, TutorialContent } from "@floor-fifty/shared/content/game-content";
import { TutorialScript } from "@floor-fifty/shared/level/tutorial";
import { liveFloors, progressOf } from "@floor-fifty/shared/simulation/endless";
import { respawnPlayer } from "@floor-fifty/shared/simulation/players";
import { createRaceSimulation, type RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { InputIntent } from "../platform/input";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import * as m from "../../paraglide/messages.js";

/**
 * The most ticks one frame may catch up. A long frame -- a hidden tab, a
 * breakpoint -- would otherwise replay seconds of play in one burst; the
 * tutorial has no room to keep pace with, so it simply loses that time.
 */
const MAX_STEPS_PER_FRAME = 5;

type Revisions = { contentRevision: RevisionHash; rulesetRevision: RevisionHash };

/**
 * A race state as the snapshot a room would broadcast of it, so the view
 * draws the tutorial exactly as it draws a race.
 *
 * Field for field what the server's `projectRace` writes: derived values for
 * presentation (`progress`), simulation state for prediction, and authority
 * (standings, the winner, credited floors) as decided.
 */
export function raceToSnapshot(state: RaceState, events: readonly RaceEvent[], revisions: Revisions): RoomSnapshot {
  const players = Object.values(state.players);
  return {
    tick: state.tick,
    phase: state.phase,
    seed: state.seed,
    roomSeed: state.roomSeed,
    round: state.round,
    // The tutorial's stage is no catalogued stage, so it has no course revision.
    courseRevision: "",
    tuning: state.tuning,
    contentRevision: revisions.contentRevision,
    rulesetRevision: revisions.rulesetRevision,
    floorCount: state.course.floorCount,
    lapCount: state.lapCount,
    modeId: state.modeId,
    clockSeconds: state.clockSeconds,
    hostId: state.hostId,
    access: state.access,
    ...(state.countdownEndsAtTick === undefined ? {} : { countdownEndsAtTick: state.countdownEndsAtTick }),
    ...(state.raceStartedAtTick === undefined ? {} : { raceStartedAtTick: state.raceStartedAtTick }),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      characterId: player.characterId,
      colour: player.colour,
      deviceClass: player.deviceClass,
      cpu: player.cpu,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      grounded: player.grounded,
      awaitingInput: player.awaitingInput,
      lastAckedSequence: player.lastSequence,
      facingRight: player.facingRight,
      lap: player.lap,
      progress: progressOf(state, player),
      ready: player.ready,
      status: player.status,
      bestFloor: player.bestFloor,
      floorEdgeY: player.floorEdgeY,
      ...(player.edgeWaitTicks === undefined ? {} : { edgeWaitTicks: player.edgeWaitTicks }),
      ...(player.bestFloorAtTick === undefined ? {} : { bestFloorAtTick: player.bestFloorAtTick }),
      ...(player.finishedAtTick === undefined ? {} : { finishedAtTick: player.finishedAtTick }),
      ...(player.holdUntilTick === undefined ? {} : { holdUntilTick: player.holdUntilTick }),
    })),
    // An endless course's window only, as the room projects it (race-options spec §5.4).
    platforms: liveFloors(state).map((floor) => ({
      id: floor.id,
      x: floorX(state, floor),
      y: floor.y,
      direction: state.movingFloors[floor.id]?.direction ?? floor.direction,
      collectedBy: players.filter((player) => player.visitedFloorIds.includes(floor.id)).map((player) => player.id),
    })),
    events,
    standings: [...state.standings],
    ...(state.winnerId === undefined ? {} : { winnerId: state.winnerId }),
  };
}

export class TutorialRun {
  readonly playerId: PlayerId = asPlayerId("tutorial");
  readonly script: TutorialScript;
  private state: RaceState;
  private readonly simulation: RaceSimulation;
  /** Elapsed time not yet stepped, always under one tick after a frame. */
  private accumulated = 0;
  private sequence = 0;
  private paused = false;
  /** The events of the ticks the last `advance` stepped, and only those. */
  private events: RaceEvent[] = [];
  /** The state the last step began from, which a catch puts her back in. */
  private stepStart: RaceState | undefined;

  constructor(
    private readonly options: {
      /** The course only: the stage it is drawn on is the screen's business. */
      tutorial: Pick<TutorialContent, "seed" | "steps">;
      tuning: ResolvedTuning;
      revisions: Revisions;
      /** The player's held input, read once per tick. */
      sample: () => InputIntent;
      /** The body to draw the racer in: the device's remembered character. Cosmetic only. */
      characterId?: string;
      /** The colour to draw the racer in: the device's remembered colour. Cosmetic only. */
      colour?: SeatColour;
    },
  ) {
    const start = createRaceState({
      seed: options.tutorial.seed,
      lapCount: 1,
      tuning: options.tuning,
      // Worded as the ready room words the player's own seat, in the language
      // active when the run starts: the tutorial has no typed name to show.
      players: [{ id: this.playerId, name: asPlayerName(m.ready_seat_you()) }],
    });
    if (options.characterId !== undefined) start.players[this.playerId]!.characterId = options.characterId;
    if (options.colour !== undefined) start.players[this.playerId]!.colour = options.colour;
    this.state = { ...start, phase: "racing", raceStartedAtTick: 0 };
    this.simulation = createRaceSimulation(this.state);
    this.simulation.restore(this.state);
    this.script = new TutorialScript(
      options.tutorial.steps.map((step) => step.kind),
      this.state.course,
    );
  }

  /**
   * The last step's edge: its height, and how fast it is rising now (0 while
   * the step stands frozen, caught or cleared). Undefined on every other step.
   */
  get edge(): { y: number; rise: number } | undefined {
    const y = this.script.edgeY;
    if (y === undefined) return undefined;
    return { y, rise: this.script.phase === "active" ? this.state.tuning.TUTORIAL_EDGE_RISE : 0 };
  }

  /**
   * True while "OUT!" shows: the edge has caught her and the step is about to start again.
   * A skip leaves the script's phase at `caught` but ends the tutorial, so `done` is read
   * too: "OUT!" must not stay up behind the end card. (`advance` steps nothing once done,
   * so the racer stays where she was.)
   */
  get out(): boolean {
    return !this.script.done && this.script.phase === "caught";
  }

  /** Freezes the run. Time spent paused is dropped rather than caught up. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.accumulated = 0;
  }

  /**
   * Steps as many whole ticks as `elapsedMs` covers, at most
   * `MAX_STEPS_PER_FRAME`, and returns the state as a snapshot. A finished
   * tutorial stops stepping; its last picture stays.
   */
  advance(elapsedMs: number): RoomSnapshot {
    this.events = [];
    if (!this.paused && !this.script.done) {
      this.accumulated += elapsedMs;
      // Whole ticks counted, not subtracted one by one: `TICK_MS` is not an
      // integer, and five subtractions leave a hair under the fifth tick. The
      // epsilon forgives that hair in the division too.
      const due = Math.floor(this.accumulated / TICK_MS + 1e-6);
      const steps = Math.min(due, MAX_STEPS_PER_FRAME);
      // Past the cap the rest is dropped, not carried into the next frame.
      this.accumulated = steps === due ? Math.max(0, this.accumulated - steps * TICK_MS) : 0;
      for (let index = 0; index < steps; index += 1) this.step();
    }
    return this.withEdge(raceToSnapshot(this.state, this.events, this.options.revisions));
  }

  /** On the last step her edge is the tutorial's own, not the course's death line. */
  private withEdge(snapshot: RoomSnapshot): RoomSnapshot {
    const edge = this.edge;
    if (edge === undefined) return snapshot;
    return {
      ...snapshot,
      players: snapshot.players.map((player) => (player.id === this.playerId ? { ...player, floorEdgeY: edge.y } : player)),
    };
  }

  private sideContacts: SideContactObservation[] = [];
  drainSideContacts(): readonly SideContactObservation[] { const contacts = this.sideContacts; this.sideContacts = []; return contacts; }

  private step(): void {
    // "OUT!" stands still: nothing is simulated, and when it has been seen the
    // step starts again from where it began (a restore, not a rewind: the
    // clock keeps its tick, so no event repeats an id).
    if (this.script.phase === "caught") {
      if (this.script.observeCaught() && this.stepStart !== undefined) {
        this.state = { ...cloneRaceState(this.stepStart), tick: this.state.tick };
        this.simulation.restore(this.state);
        this.sideContacts = [];
      }
      return;
    }
    const intent = this.options.sample();
    // A frozen step holds the picture still until its own control is pressed;
    // the press that lets it go is stepped, so it acts at once.
    if (this.script.phase === "frozen" && !this.script.observeFrozen(intent)) return;
    const frame: HeldInput = { sequence: (this.sequence += 1), ...intent };
    const result = this.simulation.step({ ...this.state, tick: this.state.tick + 1 }, new Map([[this.playerId, frame]]));
    this.state = result.state;
    this.sideContacts.push(...result.sideContacts);
    this.sideContacts = this.sideContacts.filter((contact) => contact.tick >= this.state.tick - 120);
    const events = this.loopAtTheTop(result.events);
    if (events.some((event) => event.type === "playerReset" || event.type === "lapCompleted")) this.sideContacts = [];
    this.events.push(...events);
    this.script.observe({ playerId: this.playerId, input: intent, after: this.state, events });
    this.beginSurviveStep();
  }

  /**
   * On the tick the last step first stands as current, saves where it began.
   * The script began it on a landing, so a restart puts her on a floor. When
   * she was too near the top of the course to climb three more floors, she is
   * first sent to the start, as a fall would.
   */
  private beginSurviveStep(): void {
    if (this.script.current !== "survive" || this.stepStart !== undefined) return;
    if (this.script.needsStart) {
      const state = cloneRaceState(this.state);
      respawnPlayer(state, state.players[this.playerId]!, state.tuning);
      this.state = state;
      this.simulation.restore(state);
      this.sideContacts = [];
      this.script.startHandled();
    }
    this.stepStart = cloneRaceState(this.state);
  }

  /**
   * A player who climbs the whole course before the tutorial is done goes
   * back to the start rather than finishing: the race would otherwise end,
   * and nothing is simulated after a finish. The lap cue marks the top.
   */
  private loopAtTheTop(events: readonly RaceEvent[]): readonly RaceEvent[] {
    const player = this.state.players[this.playerId];
    if (player === undefined || (player.finishedAtTick === undefined && this.state.phase !== "finished")) return events;
    const state = cloneRaceState(this.state);
    const looped = state.players[this.playerId]!;
    delete looped.finishedAtTick;
    delete state.winnerId;
    state.standings = [];
    state.phase = "racing";
    respawnPlayer(state, looped, state.tuning);
    this.state = state;
    this.simulation.restore(state);
    return [
      ...events.filter((event) => event.type !== "raceFinished"),
      {
        id: raceEventId(state.tick, "lapCompleted", this.playerId, "tutorial"),
        tick: state.tick,
        type: "lapCompleted",
        playerId: this.playerId,
        lap: looped.lap,
      },
    ];
  }

  dispose(): void {
    this.sideContacts = [];
    this.simulation.dispose();
  }
}
