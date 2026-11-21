/**
 * One chapter's rules (story mode v2 spec, "How it plays"): the director owns
 * the chapter's race and steps it, and around each step it runs the phases,
 * the moments, the glims and lamps, the lava, the wind and the actors' hands.
 *
 * What the screen needs to know comes out as `StoryEvent`s, a list per tick:
 * the only thing the screen reads besides the race itself. Nothing here ever
 * stops the climb for words; only "OUT!" stands still, and only a catch
 * brings it.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { raceEventId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import type { StoryAction, StoryChapter, StoryLine, StoryMoment, StoryPhase } from "@floor-fifty/shared/content/game-content";
import { respawnPlayer } from "@floor-fifty/shared/simulation/players";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import { Actors, placeOn, type ActorState } from "./actors";
import { Lava, Wind } from "./hazards";
import { carried, chapterGlims, freshPickups, glimPosition, lampPosition, lampSpeed, touches } from "./pickups";
import { STORY_RULES, floorAt, floorTop } from "./rules";

type Point = { readonly x: number; readonly y: number };

/** What happened this tick, for the screen. */
export type StoryEvent =
  | { readonly kind: "say"; readonly moment: number; readonly lines: readonly StoryLine[] }
  | { readonly kind: "glim"; readonly index: number; readonly at: Point; readonly streak: number }
  | { readonly kind: "lampOpen"; readonly floor: number; readonly at: Point }
  | { readonly kind: "lampRattle"; readonly floor: number }
  | { readonly kind: "quake"; readonly strength: number }
  | { readonly kind: "rescue"; readonly actor: string; readonly at: Point }
  | { readonly kind: "safeSpot"; readonly floor: number; readonly at: Point }
  | { readonly kind: "gustWarning"; readonly direction: 1 | -1 }
  | { readonly kind: "gust"; readonly direction: 1 | -1 }
  | { readonly kind: "lavaClose" }
  | { readonly kind: "caught" }
  | { readonly kind: "restored" }
  | { readonly kind: "phase"; readonly index: number; readonly id: string }
  | { readonly kind: "placed"; readonly actor: string; readonly at: Point }
  | { readonly kind: "lookAt"; readonly actor: string; readonly ticks: number }
  | { readonly kind: "done" };

/** The objective the HUD's chip and pointer show. */
export type StoryObjective =
  | { readonly kind: "reach"; readonly floor: number; readonly lampsNeeded: number }
  | { readonly kind: "rescue"; readonly actor: string; readonly floor: number };

type ActorFlags = Pick<ActorState, "ceiling" | "leash" | "parked" | "waiting">;
type Save = { readonly state: RaceState; readonly floor: number; readonly phase: number; readonly flags: readonly ActorFlags[] };

/** Moments that may come again; every other moment comes once. */
const REPEATS: ReadonlySet<string> = new Set(["caught"]);
const REPEATS_AFTER_A_WHILE: ReadonlySet<string> = new Set(["needLamp", "lampSoft"]);

export class Director {
  readonly actors: Actors;
  readonly pickups = freshPickups();
  private state: RaceState;
  private phaseIndex = 0;
  /** The tick the current phase began. */
  private phaseBeganAt = 0;
  private phaseStartFloor = 0;
  private lava: Lava | undefined;
  private wind: Wind | undefined;
  private save!: Save;
  private catchesAtSave = 0;
  private outLeft = 0;
  private readonly fired = new Set<number>();
  private readonly lastFired = new Map<number, number>();
  private lastLandedFloor = -1;
  /** The floor the player last reached, by a credit or a landing on top. */
  private standing = 0;
  private lastRattleTick = -Infinity;
  private lavaCloseTick = -Infinity;
  private glimStreak = 0;
  private lastGlimTick = -Infinity;
  private events: StoryEvent[] = [];
  private sideContacts: SideContactObservation[] = [];
  private sequence = 0;
  /** The tick of the player's first input, from which the chapter's clock runs. */
  private firstInputTick: number | undefined;
  private goalTick: number | undefined;
  /** Catches over the whole chapter. */
  catches = 0;
  /** The wind this tick: the gust blowing, or the one being warned. */
  private windNow: { readonly blowing?: 1 | -1; readonly warned?: 1 | -1 } = {};

  constructor(
    readonly chapter: StoryChapter,
    actors: Actors,
    initial: RaceState,
    private readonly simulation: RaceSimulation,
    readonly playerId: PlayerId,
  ) {
    this.actors = actors;
    this.state = initial;
    // Where everyone starts: the player on the chapter's start floor, each actor on its own or the player's.
    placeOn(this.state, playerId, chapter.startFloor, true);
    this.standing = chapter.startFloor;
    for (const authored of chapter.actors) {
      const actor = actors.find(authored.id)!;
      placeOn(this.state, actor.playerId, authored.floor ?? chapter.startFloor, authored.parked === true);
      if (authored.parked !== true) this.state.players[actor.playerId]!.awaitingInput = true;
    }
    this.simulation.restore(this.state);
    this.fireWhen((when) => when.kind === "start");
    this.startPhase(0);
  }

  get race(): RaceState {
    return this.state;
  }

  get done(): boolean {
    return this.goalTick !== undefined;
  }

  /** True while "OUT!" stands. */
  get out(): boolean {
    return this.outLeft > 0;
  }

  get phase(): StoryPhase {
    return this.chapter.phases[this.phaseIndex]!;
  }

  /** Ticks since the current phase began. */
  get phaseTicks(): number {
    return this.state.tick - this.phaseBeganAt;
  }

  /** The lava's top and how fast it is rising, or undefined in a phase with none. */
  get lavaEdge(): { readonly y: number; readonly rise: number; readonly under: "player" | "actor" } | undefined {
    if (this.lava === undefined) return undefined;
    return { y: this.lava.y, rise: this.out ? 0 : this.lava.rising, under: this.lava.authored.under };
  }

  get objective(): StoryObjective {
    const goal = this.phase.goal;
    if (goal.kind === "reach") return { kind: "reach", floor: goal.floor, lampsNeeded: Math.max(0, (goal.lamps ?? 0) - this.pickups.open.size) };
    const actor = this.actors.find(goal.actor)!;
    return { kind: "rescue", actor: goal.actor, floor: floorAt(this.state, this.state.players[actor.playerId]!.y) };
  }

  /**
   * The floor the player is on: the last one reached, or lower while falling.
   * The top of a bounce rises past the next floor's height, so the body's
   * height alone would count a floor that was never reached.
   */
  get playerFloor(): number {
    return Math.min(this.standing, floorAt(this.state, this.state.players[this.playerId]!.y));
  }

  /** The wind now, for its chip and streaks: blowing, warned, or still; still while "OUT!" stands. */
  get gust(): { readonly blowing?: 1 | -1; readonly warned?: 1 | -1 } {
    return this.wind === undefined || this.out ? {} : this.windNow;
  }

  /** The safe spot saved in this phase, by floor; undefined before the first. */
  get savedFloor(): number | undefined {
    const spots = this.phase.safeSpots ?? [];
    return this.save.phase === this.phaseIndex && spots.includes(this.save.floor) ? this.save.floor : undefined;
  }

  /** Glims carried so far, and the chapter's total. */
  get glims(): { readonly carried: number; readonly total: number } {
    return { carried: carried(this.pickups), total: chapterGlims(this.chapter) };
  }

  /** Milliseconds from the first input to the goal (or to now), catches included. */
  get elapsedMs(): number {
    if (this.firstInputTick === undefined) return 0;
    return ((this.goalTick ?? this.state.tick) - this.firstInputTick) * TICK_MS;
  }

  /** This tick's events, handed over once. */
  take(): StoryEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Ticks the player's input is still held for, while the camera looks at a friend. */
  private holdLeft = 0;

  /** Whether the player's input is held now (the camera is looking away). */
  get holding(): boolean {
    return this.holdLeft > 0;
  }

  drainSideContacts(): readonly SideContactObservation[] {
    const contacts = this.sideContacts;
    this.sideContacts = [];
    return contacts;
  }

  /** One tick: the player's held input in, the race's events out. */
  step(intent: { left: boolean; right: boolean; fastFall: boolean }): readonly RaceEvent[] {
    if (this.outLeft > 0) {
      this.outLeft -= 1;
      if (this.outLeft === 0) this.restore();
      return [];
    }
    const playerFloor = this.playerFloor;
    const frames = this.actors.inputs(this.state, playerFloor, (this.sequence += 1));
    // While the camera looks away at a friend the player stands still: no steering blind (review R5).
    const held = this.holdLeft > 0;
    if (held) this.holdLeft -= 1;
    // The story has no manual reset: "Start chapter again" is in the pause.
    const frame: HeldInput = held
      ? { sequence: this.sequence, left: false, right: false, fastFall: false, reset: false }
      : { sequence: this.sequence, left: intent.left, right: intent.right, fastFall: intent.fastFall, reset: false };
    frames.set(this.playerId, frame);
    const fallSpeed = this.state.players[this.playerId]!.vy;
    const result = this.simulation.step({ ...this.state, tick: this.state.tick + 1 }, frames);
    this.state = result.state;
    this.sideContacts.push(...result.sideContacts);
    this.sideContacts = this.sideContacts.filter((contact) => contact.tick >= this.state.tick - 120);
    const events = this.loopAtTheTop(result.events);
    if (events.some((event) => event.type === "playerReset" || event.type === "lapCompleted")) this.sideContacts = [];
    if (!this.done) this.rules(events, fallSpeed);
    return events;
  }

  private rules(events: readonly RaceEvent[], fallSpeed: number): void {
    const state = this.state;
    const player = state.players[this.playerId]!;
    const going = !player.awaitingInput;
    if (going && this.firstInputTick === undefined) {
      this.firstInputTick = state.tick - 1;
      this.fireWhen((when) => when.kind === "going");
    }

    // The wind, between steps: a change to the player's position, never to the simulation.
    if (this.wind !== undefined) {
      const gust = this.wind.tick(going);
      this.windNow = gust.blowing !== undefined ? { blowing: gust.blowing } : gust.warned !== undefined ? { warned: gust.warned } : {};
      player.x += gust.push;
      if (gust.warning !== undefined) {
        this.events.push({ kind: "gustWarning", direction: gust.warning });
        this.fireWhen((when) => when.kind === "gust");
      }
      if (gust.starts !== undefined) this.events.push({ kind: "gust", direction: gust.starts });
    }
    // The lava never waits for the player: it rises after its grace from the phase's first tick, so standing still is caught too.
    this.lava?.tick(this.lavaNear());

    // A floor reached this tick: a credit (a climber's landings come through the foot sensor) or a landing on top.
    const credited = events.flatMap((event) => (event.type === "floorLanded" && event.playerId === this.playerId ? [event.floorIndex] : []));
    const onTop = player.grounded ? floorAt(state, player.y) : undefined;
    const reached = [...credited, ...(onTop === undefined ? [] : [onTop])];
    const landedFloor = reached.length === 0 ? undefined : Math.max(...reached);
    if (landedFloor !== undefined) this.standing = landedFloor;
    const playerFloor = this.playerFloor;
    const newFloor = landedFloor !== undefined && landedFloor !== this.lastLandedFloor;
    if (landedFloor !== undefined) this.lastLandedFloor = landedFloor;

    if (credited.length > 0) this.fireWhen((when) => when.kind === "landed");
    if (newFloor) this.fireWhen((when) => when.kind === "floor" && "floor" in when && when.floor === landedFloor);
    if (newFloor && state.course.floors[landedFloor!]!.kind === "moving") this.fireWhen((when) => when.kind === "movingLanded");
    if (newFloor && this.phase.goal.kind === "rescue" && landedFloor! < this.phaseStartFloor) this.fireWhen((when) => when.kind === "descended");
    const ahead = state.course.floors.slice(playerFloor + 1, playerFloor + 1 + STORY_RULES.seenFloors);
    if (ahead.some((floor) => floor.kind === "moving")) this.fireWhen((when) => when.kind === "movingSeen");

    this.glimsAndLamps(onTop, newFloor ? landedFloor : undefined, fallSpeed);
    this.safeSpot(newFloor ? landedFloor : undefined);
    if (landedFloor !== undefined) this.goal(landedFloor);
    if (this.done) return;
    this.lavaRules();
    for (const actor of this.actors.keep(
      state,
      this.playerFloor,
      this.lava?.authored.under === "player" ? this.lava.y : undefined,
      this.phase.goal.kind === "rescue",
    ))
      this.events.push({ kind: "placed", actor: actor.id, at: this.at(actor.playerId) });
  }

  /**
   * `onTop` is a landing on top this tick, which may be hard; `arrived` is a
   * floor first reached this tick, however (a climb's arrival is soft).
   */
  private glimsAndLamps(onTop: number | undefined, arrived: number | undefined, fallSpeed: number): void {
    const state = this.state;
    const player = state.players[this.playerId]!;
    const playerFloor = this.playerFloor;
    (this.chapter.glims ?? []).forEach((glim, index) => {
      if (this.pickups.taken.has(index)) return;
      if (glim.floor >= playerFloor && glim.floor <= playerFloor + STORY_RULES.seenFloors) this.fireWhen((when) => when.kind === "glimSeen");
      const at = glimPosition(state, glim);
      if (!touches(state, player, at)) return;
      this.pickups.taken.add(index);
      this.glimStreak = state.tick - this.lastGlimTick < 300 ? this.glimStreak + 1 : 1;
      this.lastGlimTick = state.tick;
      this.events.push({ kind: "glim", index, at, streak: this.glimStreak });
      this.fireWhen((when) => when.kind === "glimFirst");
    });

    const lamps = this.chapter.lamps ?? [];
    for (const lamp of lamps) {
      if (this.pickups.open.has(lamp)) continue;
      if (lamp >= playerFloor && lamp <= playerFloor + STORY_RULES.seenFloors) this.fireWhen((when) => when.kind === "lampSeen");
      if (onTop !== lamp && arrived !== lamp) continue;
      if (onTop === lamp && fallSpeed <= lampSpeed(state)) {
        this.pickups.open.add(lamp);
        this.events.push({ kind: "lampOpen", floor: lamp, at: lampPosition(state, lamp) });
        this.fireWhen((when) => when.kind === "lampOpen");
      } else if (state.tick - this.lastRattleTick >= 45) {
        this.lastRattleTick = state.tick;
        this.pickups.rattles += 1;
        this.events.push({ kind: "lampRattle", floor: lamp });
        if (this.pickups.rattles % STORY_RULES.rattlesForHint === 0) this.fireWhen((when) => when.kind === "lampSoft");
      }
    }
  }

  /** A safe spot is saved on the first landing on one of the phase's safe floors, above the last. */
  private safeSpot(landedFloor: number | undefined): void {
    if (landedFloor === undefined || !(this.phase.safeSpots ?? []).includes(landedFloor)) return;
    if (this.save.phase === this.phaseIndex && landedFloor <= this.save.floor) return;
    this.saveHere(landedFloor);
    this.events.push({ kind: "safeSpot", floor: landedFloor, at: this.at(this.playerId) });
  }

  private goal(landedFloor: number): void {
    const goal = this.phase.goal;
    if (goal.kind === "reach") {
      if (landedFloor < goal.floor) return;
      if (this.pickups.open.size < (goal.lamps ?? 0)) {
        this.fireWhen((when) => when.kind === "needLamp");
        return;
      }
      this.nextPhase();
      return;
    }
    const actor = this.actors.find(goal.actor)!;
    if (landedFloor !== floorAt(this.state, this.state.players[actor.playerId]!.y)) return;
    this.events.push({ kind: "rescue", actor: actor.id, at: this.at(actor.playerId) });
    this.fireWhen((when) => when.kind === "rescue");
    // Rescued is leashed: it climbs with the player from here.
    actor.parked = false;
    actor.leash = true;
    this.state.players[actor.playerId]!.awaitingInput = false;
    this.nextPhase();
  }

  /** Whether a chasing lava is within `lavaClose` of the top of the floor the player is on (not the top of a bounce), where it slows. */
  private lavaNear(): boolean {
    const lava = this.lava;
    if (lava?.authored.under !== "player") return false;
    return floorTop(this.state, this.state.course.floors[this.playerFloor]!) - lava.y < STORY_RULES.lavaClose;
  }

  private lavaRules(): void {
    const lava = this.lava;
    if (lava === undefined) return;
    const state = this.state;
    // A chasing lava follows from the floor the player stands on or over (as landed this tick), never from the top of a jump.
    if (lava.authored.under === "player") lava.follow(floorTop(state, state.course.floors[this.playerFloor]!) - STORY_RULES.lavaLeash);
    const player = state.players[this.playerId]!;
    const feet = player.y - state.tuning.PLAYER_HEIGHT / 2;
    // The leash keeps it close enough to see; in return it never catches a fall: it backs off a player falling past the floor last reached to `lavaFallGap` under the feet. A bounce in place is no fall, so standing still is still caught.
    const falling = !player.grounded && player.vy < 0 && floorAt(state, player.y) < this.standing;
    if (lava.authored.under === "player" && falling) lava.sinkTo(feet - STORY_RULES.lavaFallGap);
    let caught = false;
    if (lava.authored.under === "player") {
      caught = feet < lava.y;
      if (!caught && feet - lava.y < STORY_RULES.lavaClose && state.tick - this.lavaCloseTick >= STORY_RULES.lavaCloseEvery) {
        this.lavaCloseTick = state.tick;
        this.events.push({ kind: "lavaClose" });
      }
    } else {
      const goal = this.phase.goal;
      const actor = goal.kind === "rescue" ? this.actors.find(goal.actor) : undefined;
      // The lava reaches the actor's floor: too late, and the dive starts again.
      if (actor !== undefined) caught = lava.y >= state.course.floors[floorAt(state, state.players[actor.playerId]!.y)]!.y;
    }
    if (!caught) return;
    this.catches += 1;
    this.catchesAtSave += 1;
    this.outLeft = STORY_RULES.caughtTicks;
    this.events.push({ kind: "caught" });
    this.fireWhen((when) => when.kind === "caught");
  }

  /** After "OUT!": back to the last safe spot (or, in a dive, the dive's start), the lava back under it. */
  private restore(): void {
    const save = this.save;
    this.state = { ...cloneRaceState(save.state), tick: this.state.tick };
    this.simulation.restore(this.state);
    this.sideContacts = [];
    this.actors.list.forEach((actor, index) => Object.assign(actor, save.flags[index]!, { lostTicks: 0 }));
    const lava = this.lava!;
    const target = lava.authored.under === "actor" ? this.rescueFloor() : save.floor;
    lava.reset(this.state.course.floors[target]!.y);
    // Mercy, never said aloud: from the third catch at one safe spot, the lava slows until the next.
    lava.share = this.catchesAtSave >= STORY_RULES.mercyAfter ? STORY_RULES.mercyShare : 1;
    this.lastLandedFloor = -1;
    this.holdLeft = 0;
    this.standing = floorAt(this.state, this.state.players[this.playerId]!.y);
    this.events.push({ kind: "restored" });
  }

  private rescueFloor(): number {
    const goal = this.phase.goal;
    if (goal.kind !== "rescue") return this.playerFloor;
    const actor = this.actors.find(goal.actor)!;
    return floorAt(this.state, this.state.players[actor.playerId]!.y);
  }

  private saveHere(floor: number): void {
    this.save = {
      state: cloneRaceState(this.state),
      floor,
      phase: this.phaseIndex,
      flags: this.actors.list.map(({ ceiling, leash, parked, waiting }) => ({ ceiling, leash, parked, waiting })),
    };
    this.catchesAtSave = 0;
    if (this.lava !== undefined) this.lava.share = 1;
  }

  private nextPhase(): void {
    if (this.phaseIndex + 1 < this.chapter.phases.length) {
      this.startPhase(this.phaseIndex + 1);
      return;
    }
    this.goalTick = this.state.tick;
    this.lava = undefined;
    this.wind = undefined;
    this.fireWhen((when) => when.kind === "goal");
    this.events.push({ kind: "done" });
  }

  private startPhase(index: number): void {
    this.phaseIndex = index;
    this.phaseBeganAt = this.state.tick;
    const phase = this.phase;
    this.fireWhen((when) => when.kind === "phase" && "phase" in when && when.phase === phase.id);
    this.phaseStartFloor = this.playerFloor;
    // A climb after a dive credits its floors again: the floors above are the ones to climb.
    if (phase.goal.kind === "reach") {
      const player = this.state.players[this.playerId]!;
      player.visitedFloorIds = this.state.course.floors.slice(0, this.phaseStartFloor + 1).map((floor) => floor.id);
    }
    this.wind = phase.wind === undefined ? undefined : new Wind(phase.wind);
    this.windNow = {};
    this.lava = undefined;
    if (phase.lava !== undefined) {
      const target = phase.lava.under === "actor" ? this.rescueFloor() : this.phaseStartFloor;
      this.lava = new Lava(phase.lava, this.state.course.floors[target]!.y - phase.lava.startBelow);
    }
    this.saveHere(this.phaseStartFloor);
    this.events.push({ kind: "phase", index, id: phase.id });
  }

  /** Fires every moment `matches` picks that may fire now: its actions first, then its words. */
  private fireWhen(matches: (when: StoryMoment["when"]) => boolean): void {
    this.chapter.moments.forEach((moment, index) => {
      if (!matches(moment.when)) return;
      const kind = moment.when.kind;
      if (REPEATS_AFTER_A_WHILE.has(kind)) {
        if (this.state.tick - (this.lastFired.get(index) ?? -Infinity) < STORY_RULES.repeatTicks) return;
      } else if (!REPEATS.has(kind) && this.fired.has(index)) return;
      this.fired.add(index);
      this.lastFired.set(index, this.state.tick);
      for (const action of moment.do ?? []) this.act(action);
      if (moment.lines !== undefined) this.events.push({ kind: "say", moment: index, lines: moment.lines });
    });
  }

  private act(action: StoryAction): void {
    if (action.do === "quake") {
      this.events.push({ kind: "quake", strength: action.strength });
      return;
    }
    const actor = this.actors.find(action.actor);
    if (actor === undefined) return;
    switch (action.do) {
      case "drop": {
        const floor = Math.max(0, floorAt(this.state, this.state.players[actor.playerId]!.y) - action.floors);
        placeOn(this.state, actor.playerId, floor, false);
        this.events.push({ kind: "placed", actor: actor.id, at: this.at(actor.playerId) });
        break;
      }
      case "place":
        placeOn(this.state, actor.playerId, action.floor, action.parked);
        actor.parked = action.parked;
        this.events.push({ kind: "placed", actor: actor.id, at: this.at(actor.playerId) });
        break;
      case "lookAt":
        this.events.push({ kind: "lookAt", actor: actor.id, ticks: action.ticks });
        this.holdLeft = Math.max(this.holdLeft, action.ticks);
        break;
      case "ceiling":
        actor.ceiling = action.floor;
        break;
      case "leash":
        actor.leash = action.on;
        break;
      case "unpark":
        actor.parked = false;
        actor.leash = true;
        this.state.players[actor.playerId]!.awaitingInput = false;
        break;
    }
  }

  private at(playerId: PlayerId): Point {
    const racer = this.state.players[playerId]!;
    return { x: racer.x, y: racer.y };
  }

  /** Where the top of floor `index` is, for the screen's rings and pointers. */
  floorTopY(index: number): number {
    return floorTop(this.state, this.state.course.floors[index]!);
  }

  /**
   * The last guard: a player who climbs the whole course goes back to the
   * start rather than finishing, since nothing is simulated after a finish.
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
      { id: raceEventId(state.tick, "lapCompleted", this.playerId, "story"), tick: state.tick, type: "lapCompleted", playerId: this.playerId, lap: looped.lap },
    ];
  }
}
