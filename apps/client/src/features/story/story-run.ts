/**
 * One story chapter, stepped here with no server.
 *
 * The same `RaceSimulation` a room runs, on fixed ticks paced by the render
 * clock, with the player and the chapter's actors (Frog, Oni) as its racers.
 * Nothing is sent anywhere. Pausing stops it, because here -- unlike a
 * networked race -- nothing else is running. The chapter's rules are the
 * director's (`director.ts`); this file paces it and draws it as a room's
 * snapshot, so the view draws the story exactly as it draws a race.
 */

import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { createRaceState, floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { RevisionHash, StoryActor, StoryChapter } from "@floor-fifty/shared/content/game-content";
import { liveFloors, progressOf } from "@floor-fifty/shared/simulation/endless";
import { createRaceSimulation, type RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { InputIntent } from "../platform/input";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { Actors, actorPlayerId } from "./actors";
import { Director, type StoryEvent } from "./director";

/**
 * The most ticks one frame may catch up. A long frame -- a hidden tab, a
 * breakpoint -- would otherwise replay seconds of play in one burst; the
 * story has no room to keep pace with, so it simply loses that time.
 */
const MAX_STEPS_PER_FRAME = 5;

type Revisions = { contentRevision: RevisionHash; rulesetRevision: RevisionHash };

/**
 * A race state as the snapshot a room would broadcast of it, so the view
 * draws the story exactly as it draws a race.
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
    // A chapter's stage need not be a catalogued one, so it has no course revision.
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

/**
 * The player as the story draws them (spec, "The cast": clashes): never as
 * one of the friends beside them, and never in a friend's colour, so the
 * three always tell apart. A friend's character is drawn as the ninja, a
 * friend's colour as violet. Story only; nothing is saved.
 */
export function heroLook(
  look: { readonly characterId: string; readonly colour: SeatColour },
  actors: Readonly<Record<string, StoryActor>>,
): { readonly characterId: string; readonly colour: SeatColour } {
  const friends = Object.values(actors);
  return {
    characterId: friends.some((friend) => friend.characterId === look.characterId) ? "ninja" : look.characterId,
    colour: friends.some((friend) => friend.colour === look.colour) ? "violet" : look.colour,
  };
}

export type StoryRunOptions = {
  readonly chapter: StoryChapter;
  /** The story's actors, by id. */
  readonly actors: Readonly<Record<string, StoryActor>>;
  readonly tuning: ResolvedTuning;
  readonly revisions: Revisions;
  /** The player's held input, read once per tick. */
  readonly sample: () => InputIntent;
  /** The player's name tag, and each actor's, in the language active when the run starts. */
  readonly names: { readonly you: string; readonly actor: (actorId: string) => string };
  /** The body and colour to draw the player in: the device's remembered ones. Cosmetic only. */
  readonly characterId?: string;
  readonly colour?: SeatColour;
};

export class StoryRun {
  readonly playerId: PlayerId = asPlayerId("story");
  readonly director: Director;
  private readonly simulation: RaceSimulation;
  /** Elapsed time not yet stepped, always under one tick after a frame. */
  private accumulated = 0;
  private paused = false;
  /** The race events and story events of the ticks the last `advance` stepped, and only those. */
  private events: RaceEvent[] = [];
  private storyEvents: StoryEvent[] = [];

  constructor(private readonly options: StoryRunOptions) {
    const { chapter } = options;
    const start = createRaceState({
      seed: chapter.seed,
      lapCount: 1,
      tuning: options.tuning,
      players: [
        { id: this.playerId, name: asPlayerName(options.names.you) },
        ...chapter.actors.map((actor) => ({ id: actorPlayerId(actor.id), name: asPlayerName(options.names.actor(actor.id)) })),
      ],
    });
    const you = start.players[this.playerId]!;
    if (options.characterId !== undefined) you.characterId = options.characterId;
    if (options.colour !== undefined) you.colour = options.colour;
    for (const actor of chapter.actors) {
      const racer = start.players[actorPlayerId(actor.id)]!;
      const authored = options.actors[actor.id]!;
      racer.characterId = authored.characterId;
      racer.colour = authored.colour;
      racer.cpu = true;
    }
    // The player's colour is theirs; an actor that would share it keeps its own anyway (a story is not a room).
    const state: RaceState = { ...start, phase: "racing", raceStartedAtTick: 0 };
    this.simulation = createRaceSimulation(state);
    this.simulation.restore(state);
    this.director = new Director(chapter, new Actors(chapter, options.actors, options.names.actor), state, this.simulation, this.playerId);
    this.storyEvents = this.director.take();
  }

  /** The lava's edge: its height, and how fast it is rising now. Undefined in a phase with none. */
  get edge(): { y: number; rise: number } | undefined {
    const edge = this.director.lavaEdge;
    return edge === undefined ? undefined : { y: edge.y, rise: edge.rise };
  }

  /** True while "OUT!" shows. */
  get out(): boolean {
    return this.director.out;
  }

  get state(): RaceState {
    return this.director.race;
  }

  /** Freezes the run. Time spent paused is dropped rather than caught up. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.accumulated = 0;
  }

  /**
   * Steps as many whole ticks as `elapsedMs` covers, at most
   * `MAX_STEPS_PER_FRAME`, and returns the state as a snapshot. A chapter
   * whose goal is reached goes on climbing, input live, while its last lines
   * play; the screen moves on.
   */
  advance(elapsedMs: number): RoomSnapshot {
    this.events = [];
    if (!this.paused) {
      this.accumulated += elapsedMs;
      // Whole ticks counted, not subtracted one by one: `TICK_MS` is not an
      // integer, and five subtractions leave a hair under the fifth tick. The
      // epsilon forgives that hair in the division too.
      const due = Math.floor(this.accumulated / TICK_MS + 1e-6);
      const steps = Math.min(due, MAX_STEPS_PER_FRAME);
      // Past the cap the rest is dropped, not carried into the next frame.
      this.accumulated = steps === due ? Math.max(0, this.accumulated - steps * TICK_MS) : 0;
      for (let index = 0; index < steps; index += 1) this.stepOnce();
    }
    return this.snapshot();
  }

  /** One tick, for tests and bots: the sampled input, stepped. */
  stepOnce(): void {
    const { left, right, fastFall } = this.options.sample();
    this.events.push(...this.director.step({ left, right, fastFall }));
    this.storyEvents.push(...this.director.take());
  }

  /** The story events since the last call. */
  takeStoryEvents(): StoryEvent[] {
    const events = this.storyEvents;
    this.storyEvents = [];
    return events;
  }

  /** The race as a room's snapshot, with the player's edge the story's own lava. */
  snapshot(): RoomSnapshot {
    const snapshot = raceToSnapshot(this.director.race, this.events, this.options.revisions);
    const edge = this.director.lavaEdge;
    if (edge === undefined || edge.under !== "player") return snapshot;
    return {
      ...snapshot,
      players: snapshot.players.map((player) => (player.id === this.playerId ? { ...player, floorEdgeY: edge.y } : player)),
    };
  }

  drainSideContacts(): readonly SideContactObservation[] {
    return this.director.drainSideContacts();
  }

  dispose(): void {
    this.director.drainSideContacts();
    this.simulation.dispose();
  }
}
