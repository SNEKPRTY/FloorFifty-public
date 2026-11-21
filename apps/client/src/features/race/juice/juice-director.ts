/**
 * Racer juice (polish spec §4): presentation only.
 *
 * It hears two things. The drawn picture, from which it derives a bounce, a
 * slam and a wrap for every racer. And the room's events, held until the drawn
 * tick reaches them, from which it answers a floor collected, a respawn and
 * the finish. It answers through the view and through `cue`, and nothing else:
 * it reads nothing into the simulation, and nothing it does is sent.
 *
 * The tiers (§4.2):
 * - whisper: a bounce gets two squash steps and a small puff, every racer;
 * - beat: a floor collected pops the HUD (local, authoritative only); a wrap
 *   leaves a streak at both seams;
 * - hit: a slam gets a deep squash and a ring, and for the local racer a
 *   camera kick and a hit-stop; a respawn, a lap release and the finish burst.
 *
 * Contact juice (squash, dust) answers what is drawn, so the local racer's
 * comes from the prediction the moment it turns. Credit (the HUD pop) waits
 * for authority. Everything runs on the scene's presentation clock, so the
 * finish's slow motion slows it with the rest of the picture.
 */

import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import { WALL_SCUFF_CUE, FLOOR_POP_CUE } from "../race-cues";
import { playerColorTint, roleTint } from "@floor-fifty/asset-contract/roles";
import type { Container, Texture } from "pixi.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { DustSpec, JuiceTuning } from "@floor-fifty/shared/content/game-content";
import { DustPool } from "./dust-pool";
import { HitStop } from "./hit-stop";
import { MotionWatch, type JuiceMoment } from "./motion-watch";
import { RoomBeats } from "./room-beats";
import { LeanBook } from "./lean";
import { SecondOrder, snapTo } from "../../../lib/second-order";
import { SquashBook } from "./squash";
import { WrapStreak } from "./wrap-streak";
import { distanceFor, juiceSound } from "../race-cues";

/** What the director draws through. `GameplayView` is the one implementation. */
export interface JuiceView {
  /** A racer's squash for this frame; (1, 1) is rest. */
  setSquash(id: PlayerId, x: number, y: number): void;
  /** A racer's lean for this frame, as the sprite's skew in radians; 0 is upright (Wonder spec §4.1). */
  setLean(id: PlayerId, radians: number): void;
  /** The local racer's camera kick, in whole logical units downward; 0 is rest. */
  setKick(units: number): void;
  /** Freezes the local racer's pose and the camera follow, never a position. */
  setHitStop(frozen: boolean): void;
  /** A racer's current frame, for its wrap streak. */
  textureOf(id: PlayerId): Texture | undefined;
  /** The world-layer containers the dust and the streak live in. */
  readonly dustLayer: Container;
  readonly streakLayer: Container;
}

/** One racer as this frame draws it: the prediction for the local racer, the sample for everyone else. */
export type JuiceRacer = {
  readonly id: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  /** Drawn sideways speed, which the lean follows. */
  readonly vx: number;
  readonly colour: SeatColour;
  readonly facingRight: boolean;
};

export type JuiceFrame = {
  /** The drawn sample's tick. */
  readonly tick: number;
  /** The scene's presentation clock, which slows with the finish. */
  readonly nowMs: number;
  readonly localId: PlayerId | undefined;
  /** Each racer where it is drawn: the prediction for the local racer, the sample for the rest. */
  readonly racers: readonly JuiceRacer[];
  /**
   * Each racer as the sample (authority) has it at `tick`: its place, and its
   * lap hold, held while `tick < holdUntilTick`. The room's moments are thrown
   * from here, since the local racer's prediction has moved on by the time
   * one is drawn.
   */
  readonly sampled: ReadonlyMap<PlayerId, SampledRacer>;
  /**
   * True when the local racer's predicted landing sounds this frame: the
   * landing is the bigger cue, so the bounce under it stays quiet.
   */
  readonly localLanding?: boolean;
  /**
   * Side wall contacts occurring this frame, triggering friction sparks,
   * wall-brace tilt, and tactile audio scuff.
   */
  readonly sideContacts?: readonly SideContact[];
};

export type SideContact = SideContactObservation;


/** What one frame answered: the words and the stage read it (Wonder spec §5.5, §6.3). */
export type JuiceFrameResult = {
  /** The moments answered this frame, each the first time. */
  readonly moments: readonly JuiceMoment[];
  /** The room's events the drawn tick reached this frame. */
  readonly reached: readonly RaceEvent[];
  /** The local racer slammed this frame: its landing's cue gives way (Wonder spec §3.2). */
  readonly localSlammed: boolean;
  /** The timeline jumped back this frame (a replay's rewind): what follows it answers again. */
  readonly restarted?: boolean;
};

const NOTHING: JuiceFrameResult = { moments: [], reached: [], localSlammed: false };

/** A cue's level and pitch, from `race-cues.ts`'s mix. */
export type JuiceCueOptions = { readonly gain?: number; readonly rate?: number; readonly vary?: boolean; readonly distance?: number };

export type SampledRacer = { readonly x: number; readonly y: number; readonly holdUntilTick: number | undefined };

export type JuiceDeps = {
  readonly view: JuiceView;
  /** The tuning to draw with, read every frame; nothing before content has loaded. */
  readonly juice: () => JuiceTuning | undefined;
  /** `reducedMotion()`, read at the moment of use. */
  readonly reduced: () => boolean;
  /**
   * The player has switched character effects off, read every frame: nothing
   * is drawn -- no squash, lean, kick, hit-stop, dust, streak or HUD pop --
   * while the sounds play and the moments are still returned.
   */
  readonly off?: () => boolean;
  /** One pixel of white, tinted per particle. */
  readonly texture: Texture;
  readonly tuning: {
    readonly BOUNCE_VELOCITY: number;
    readonly FAST_FALL_VELOCITY: number;
    readonly PLAYER_HEIGHT: number;
    readonly PLAYER_SPRITE_SIZE: number;
    readonly FLOOR_GAP_MIN: number;
  };
  /** This stage's dust swatches: its `palette.stages` override, or `ROLES.dust`. */
  readonly dustTints: () => readonly number[];
  /** Plays a sound once per key (the mixer de-duplicates by event ID), at the mix's level. */
  readonly cue: (alias: string, key: string, options?: JuiceCueOptions) => void;
  /** The ladder's height in floors, which pitches a bounce with its floor's landing. */
  readonly floorCount: () => number;
  /**
   * What the owner puts before a derived sound's key, read at the moment of
   * use: a replay's `replay:{playthrough}:`, so its keys follow the replay's.
   */
  readonly keyPrefix?: () => string;
};

/** The rest band `PlayerView` reads its landing flourish from, as a share of the bounce. */
const REST_SPEED_FRACTION = 0.05;
/** How far behind the drawn tick a moment's key is kept, to refuse a replay; then it is forgotten. */
const MEMORY_TICKS = 600;
/** The particle limit before content has loaded, when nothing is thrown anyway. */
const NO_PARTICLES = 0;
/**
 * How often the frame-budget gate's stress slams every racer: faster than a
 * slam's ring dies, so four racers ask for more particles than the limit and
 * the pool is measured held at it, recycling its oldest (Review Focus 5).
 */
const STRESS_EVERY_MS = 100;

/**
 * The last session handed out on this page. The mixer never forgets a key it
 * has played, so a derived sound's key carries a session: a replay of a race
 * the mixer heard, or a rewind within one, sounds again.
 */
let sessions = 0;

/** A seat colour as the 24-bit tint Pixi expects: the finish burst's colour. */
export const seatTint = (colour: SeatColour): number => playerColorTint(colour);

/** Reduced motion keeps one particle of a throw, still: the moment arrives, without movement. */
const stillOf = (spec: DustSpec): DustSpec => ({ ...spec, count: Math.min(1, spec.count), sparks: 0 });

/** A spring for before content has loaded, when nothing is knocked anyway. */
const RESTING_SPRING = { f: 4, zeta: 0.5, r: 0 } as const;

export class JuiceDirector {
  private readonly watch: MotionWatch;
  private readonly squash: SquashBook;
  private readonly lean = new LeanBook();
  /** The local racer's camera kick, in logical units downward, on its spring (Wonder spec §4.2). */
  private readonly kick: SecondOrder;
  private readonly dust: DustPool;
  private readonly streak: WrapStreak;
  private readonly beats = new RoomBeats();
  private readonly hitStop = new HitStop();
  /** Every moment answered, by key, with the tick it was drawn at. */
  private readonly answered = new Map<string, number>();
  private readonly wallLastAt = new Map<PlayerId, number>();
  /** Each racer's previous drawn tick, for the lap release. */
  /** Each racer's lap hold as last seen: the field is gone from the release tick on. */
  private readonly holds = new Map<PlayerId, number>();
  private lastNowMs: number | undefined;
  private pops = 0;
  private stressOn = false;
  private stressedAtMs = Number.NEGATIVE_INFINITY;
  /** This director's session, renewed when the timeline jumps back. */
  private session = ++sessions;
  private lastFrameTick: number | undefined;
  /** Character effects are switched off this frame. */
  private off = false;

  constructor(private readonly deps: JuiceDeps) {
    this.squash = new SquashBook(() => deps.juice()?.springs.squash ?? RESTING_SPRING);
    this.kick = new SecondOrder(deps.juice()?.springs.kick ?? RESTING_SPRING);
    this.watch = new MotionWatch(deps.tuning.BOUNCE_VELOCITY * REST_SPEED_FRACTION);
    this.dust = new DustPool(deps.texture, () => deps.juice()?.limits.particles ?? NO_PARTICLES);
    this.streak = new WrapStreak(deps.view.streakLayer, {
      size: deps.tuning.PLAYER_SPRITE_SIZE,
      feet: deps.tuning.PLAYER_HEIGHT / 2,
    });
    deps.view.dustLayer.addChild(this.dust.root);
  }

  /** The room's events from a snapshot batch: each is answered once, when the drawn tick reaches it. */
  noteRoomEvents(events: readonly RaceEvent[]): void {
    this.beats.noteAt(events);
  }

  /**
   * The local racer's predicted resets, heard before the frame that draws
   * them. A respawn leaves the racer rising at the bounce speed, exactly as a
   * landing does, so without this a respawn after a fast fall reads as a slam.
   */
  notePredictedResets(events: readonly RaceEvent[]): void {
    for (const event of events) if (event.type === "playerReset") this.watch.forget(event.playerId);
  }

  /**
   * Floors the local racer has been credited with, by authority, as drawn.
   * The HUD pops each time it rises.
   */
  get hudPops(): number {
    return this.pops;
  }

  /** Draws one frame's juice. Call before the view applies the snapshot, so the squash lands this frame. */
  frame(input: JuiceFrame): JuiceFrameResult {
    // A timeline that runs backwards (a replay's rewind or seek) starts over:
    // what it answered before is to be answered again.
    const restarted = this.lastFrameTick !== undefined && input.tick < this.lastFrameTick;
    if (restarted) this.restart();
    this.lastFrameTick = input.tick;
    const juice = this.deps.juice();
    this.off = this.deps.off?.() ?? false;
    // Off settles and holds everything still, as reduced motion does, and draws no dust at all.
    const reduced = this.deps.reduced() || this.off;
    if (this.off) this.dust.clear();
    const deltaMs = this.lastNowMs === undefined ? 0 : Math.max(0, input.nowMs - this.lastNowMs);
    this.lastNowMs = input.nowMs;
    const dtSeconds = deltaMs / 1_000;
    if (reduced) {
      this.squash.settle();
      this.lean.settle();
      this.hitStop.settle();
      this.kick.set(0);
    }

    // A hit-stop holds the local racer's pose: its squash and lean resume where they froze.
    const frozen = this.hitStop.frozen(input.nowMs - deltaMs) && this.hitStop.frozen(input.nowMs);
    const frozenId = frozen ? input.localId : undefined;
    if (!reduced) {
      this.squash.update(dtSeconds, frozenId);
      if (juice !== undefined) {
        this.kick.retune(juice.springs.kick);
        this.lean.update(input.racers, dtSeconds, juice, frozenId);
      }
      this.kick.update(dtSeconds, 0);
    }

    let result = NOTHING;
    if (juice !== undefined) {
      // The room's events first: a respawn this frame draws must be known
      // before its rise is read as a landing.
      const reached = this.beats.reach(input.tick);
      for (const event of reached) this.beat(event, input, juice, reduced);
      const slamSpeed = juice.slam.threshold * Math.abs(this.deps.tuning.FAST_FALL_VELOCITY);
      const moments: JuiceMoment[] = [];
      let localSlammed = false;
      for (const moment of this.watch.observe(input.racers, input.tick, slamSpeed)) {
        if (!this.firstTime(moment.key, input.tick)) continue;
        moments.push(moment);
        this.answer(moment, input, juice, reduced);
        if (moment.kind === "slam" && moment.playerId === input.localId) localSlammed = true;
      }
      this.releases(input, juice, reduced);
      if (this.stressOn) moments.push(...this.stressFrame(input, juice, reduced));
      result = { moments, reached, localSlammed, ...(restarted ? { restarted } : {}) };
    } else {
      // Nothing to answer with, but the room's events still pass, so none is
      // left waiting to fire the moment content arrives.
      this.beats.reach(input.tick);
    }

    for (const contact of input.sideContacts ?? []) {
      if (contact.playerId !== input.localId) continue;
      const key = `wallScuff:${contact.tick}:${contact.playerId}:${contact.floorId}`;
      if (this.answered.has(key)) continue;
      this.answered.set(key, contact.tick);
      if (!reduced) this.lean.brace(contact.playerId, contact.facingLeft, input.nowMs);
      if (input.nowMs - (this.wallLastAt.get(contact.playerId) ?? -Infinity) < 100) continue;
      this.wallLastAt.set(contact.playerId, input.nowMs);
      this.deps.cue(WALL_SCUFF_CUE.alias, this.soundKey(key), { gain: WALL_SCUFF_CUE.gain });
      if (!reduced) this.dust.emitWallSparks(contact.x, contact.y, contact.facingLeft, input.nowMs, false);
    }

    for (const racer of input.racers) {
      const scale = this.squash.scaleOf(racer.id);
      this.deps.view.setSquash(racer.id, scale.x, scale.y);
      this.deps.view.setLean(racer.id, this.lean.drawnOf(racer.id, input.nowMs));
    }

    this.deps.view.setKick(snapTo(this.kick.value, 1));
    this.deps.view.setHitStop(this.hitStop.frozen(input.nowMs));
    this.dust.update(input.nowMs);
    this.streak.update();
    this.forgetBefore(input.tick - MEMORY_TICKS);
    return result;
  }

  /**
   * A moment the story names (story mode v2, "Feel"): dust from a point, and
   * for the local racer the camera kick and the hit-stop. Drawn on the next
   * frame's clock; nothing under reduced motion but the still dust.
   */
  storyMoment(moment: { readonly at?: { readonly x: number; readonly y: number }; readonly dust?: DustSpec; readonly tints?: readonly number[]; readonly hitStopMs?: number; readonly kickUnits?: number }): void {
    const nowMs = this.lastNowMs ?? 0;
    const reduced = this.deps.reduced() || this.off;
    if (moment.dust !== undefined && moment.at !== undefined) this.throwFromFeet(moment.dust, moment.at, nowMs, reduced, moment.tints);
    if (reduced) return;
    if (moment.kickUnits !== undefined && moment.kickUnits > 0) this.kick.lift(moment.kickUnits);
    if (moment.hitStopMs !== undefined && moment.hitStopMs > 0) this.hitStop.start(nowMs, moment.hitStopMs);
  }

  /** Particles on screen now, for the leak checks. */
  get liveParticles(): number {
    return this.dust.live;
  }

  /**
   * Slams every racer every `STRESS_EVERY_MS`, silently, for the frame-budget
   * gate (polish spec §10.1). Reached only through `__ffJuice`, which exists
   * only where visual inspection is enabled.
   */
  /** Whether the frame-budget gate's stress is on: the words load with it. */
  get stressed(): boolean {
    return this.stressOn;
  }

  setStress(on: boolean): void {
    this.stressOn = on;
    this.stressedAtMs = Number.NEGATIVE_INFINITY;
  }

  /** A derived moment's sound key: the owner's prefix, this session, the moment. */
  private soundKey(key: string): string {
    return `${this.deps.keyPrefix?.() ?? ""}${this.session}:${key}`;
  }

  /** Settles everything and forgets what was answered, under a new session. */
  private restart(): void {
    this.session = ++sessions;
    this.watch.clear();
    this.answered.clear();
    this.wallLastAt.clear();
    this.holds.clear();
    this.beats.clear();
    this.squash.settle();
    this.lean.settle();
    this.hitStop.settle();
    this.kick.set(0);
    this.dust.clear();
  }

  destroy(): void {
    this.dust.destroy();
    this.streak.destroy();
    this.squash.settle();
    this.lean.settle();
    this.kick.set(0);
    this.hitStop.settle();
    this.beats.clear();
    this.answered.clear();
    this.wallLastAt.clear();
    this.holds.clear();
  }

  private answer(moment: JuiceMoment, input: JuiceFrame, juice: JuiceTuning, reduced: boolean): void {
    const local = moment.playerId === input.localId;
    this.sound(moment, local, input);
    switch (moment.kind) {
      case "bounce":
        if (!reduced) this.squash.knock(moment.playerId, juice.bounce.squash.amount);
        this.throwFromFeet(juice.bounce.dust, moment, input.nowMs, reduced);
        return;
      case "slam":
        this.slam(moment.playerId, moment, local, input.nowMs, juice, reduced);
        return;
      case "wrap": {
        const racer = input.racers.find((each) => each.id === moment.playerId);
        const texture = this.deps.view.textureOf(moment.playerId);
        if (!reduced && racer !== undefined && texture !== undefined) {
          this.streak.show({ texture, fromX: moment.fromX, x: moment.x, y: moment.y, facingRight: racer.facingRight }, juice.wrap.streak.frames);
        }
        // A spark trail at both seams (Wonder spec §4.3); none under reduced motion.
        if (!reduced && juice.wrap.sparks > 0) {
          const trail: DustSpec = { count: 0, spread: 8, rise: 2, lifeMs: 240, sparks: juice.wrap.sparks };
          for (const x of [moment.fromX, moment.x]) this.throwFromFeet(trail, { x, y: moment.y }, input.nowMs, false);
        }
        return;
      }
    }
  }

  /** The moment's sound, through the mix's own gains (Wonder spec §3.2). */
  private sound(moment: JuiceMoment, local: boolean, input: JuiceFrame): void {
    // The landing is the bigger cue: the bounce under it stays quiet.
    if (moment.kind === "bounce" && local && input.localLanding === true) return;
    const gap = this.deps.tuning.FLOOR_GAP_MIN;
    const floorIndex = Math.max(0, Math.floor(moment.y / gap));
    const self = input.racers.find((racer) => racer.id === input.localId);
    const distance = distanceFor(moment.y, self?.y, gap);
    const sound = juiceSound(moment.kind, { rival: !local, floorIndex, floorCount: this.deps.floorCount(), distance });
    if (sound === undefined) return;
    const { alias, gain, rate, vary } = sound;
    this.deps.cue(alias, this.soundKey(moment.key), {
      ...(gain === undefined ? {} : { gain }),
      ...(rate === undefined ? {} : { rate }),
      ...(vary === undefined ? {} : { vary }),
      ...(sound.distance === undefined ? {} : { distance: sound.distance }),
    });
  }

  /** A slam's picture: the deep squash and the ring, and for the local racer the kick and the hit-stop. */
  private slam(
    id: PlayerId,
    at: { readonly x: number; readonly y: number },
    local: boolean,
    nowMs: number,
    juice: JuiceTuning,
    reduced: boolean,
  ): void {
    if (!reduced) this.squash.knock(id, juice.slam.squash.amount);
    this.throwFromFeet(juice.slam.dust, at, nowMs, reduced);
    if (!local || reduced) return;
    this.kick.lift(juice.slam.cameraKick.units);
    this.hitStop.start(nowMs, juice.slam.hitStopMs);
  }

  /**
   * The frame-budget gate's load: every racer slams, silently, on a short
   * cadence. Its slams are the frame's moments too, so the words load with
   * the juice (Wonder spec §6.6); they never take a landing's sound.
   */
  private stressFrame(input: JuiceFrame, juice: JuiceTuning, reduced: boolean): JuiceMoment[] {
    if (input.nowMs - this.stressedAtMs < STRESS_EVERY_MS) return [];
    this.stressedAtMs = input.nowMs;
    return input.racers.map((racer) => {
      this.slam(racer.id, racer, racer.id === input.localId, input.nowMs, juice, reduced);
      return { kind: "slam", playerId: racer.id, x: racer.x, y: racer.y, fromX: racer.x, key: `${racer.id}:stress:${input.nowMs}` };
    });
  }

  /** A room event the drawn picture has reached. */
  private beat(event: RaceEvent, input: JuiceFrame, juice: JuiceTuning, reduced: boolean): void {
    if (event.type === "floorLanded") {
      if (event.playerId !== input.localId) return;
      if (!this.off) this.pops += 1;
      this.deps.cue(FLOOR_POP_CUE, event.id);
      const racer = input.sampled.get(event.playerId);
      if (racer !== undefined) this.throwFromFeet(juice.collect.dust, racer, input.nowMs, reduced);
      return;
    }
    if (event.type === "playerReset") {
      // A respawn is not a landing. The local racer's is forgotten from its
      // prediction (`notePredictedResets`), which runs ahead of this; forgetting
      // it again here, behind, could swallow a real landing.
      if (event.playerId !== input.localId) {
        this.watch.forget(event.playerId);
        this.lean.forget(event.playerId);
      }
      // Authority has moved the racer to the spawn by the sample's tick.
      const racer = input.sampled.get(event.playerId);
      if (racer !== undefined) this.throwFromFeet(juice.burst.spawn.dust, racer, input.nowMs, reduced);
      return;
    }
    if (event.type === "raceFinished") {
      const winner = input.racers.find((each) => each.id === event.winnerId);
      if (winner === undefined) return;
      const seat = seatTint(winner.colour);
      // Two in the winner's colour to one glint: the burst is theirs.
      this.throwFromFeet(juice.burst.finish.dust, winner, input.nowMs, reduced, [seat, seat, roleTint("finishBurst")]);
    }
  }

  /**
   * A racer whose lap hold ends this frame bounces out of the spawn in a
   * burst. The simulation deletes `holdUntilTick` on the release tick, so no
   * sample shows the hold reached: the hold is remembered from the frames
   * before it, and answered once the drawn tick passes it.
   */
  private releases(input: JuiceFrame, juice: JuiceTuning, reduced: boolean): void {
    for (const [id, racer] of input.sampled) {
      if (racer.holdUntilTick !== undefined && input.tick < racer.holdUntilTick) {
        this.holds.set(id, racer.holdUntilTick);
        continue;
      }
      const until = this.holds.get(id);
      if (until === undefined || input.tick < until) continue;
      this.holds.delete(id);
      if (!this.firstTime(`${id}:release:${until}`, input.tick)) continue;
      this.throwFromFeet(juice.burst.spawn.dust, racer, input.nowMs, reduced);
    }
  }

  /** Throws dust from a racer's feet. */
  private throwFromFeet(
    spec: DustSpec,
    at: { readonly x: number; readonly y: number },
    nowMs: number,
    reduced: boolean,
    tints: readonly number[] = this.deps.dustTints(),
  ): void {
    if (this.off) return;
    const feet = at.y - this.deps.tuning.PLAYER_HEIGHT / 2;
    // Every spark glints in the finish highlight, which is off every seat colour and dust swatch.
    this.dust.emit(reduced ? stillOf(spec) : spec, at.x, feet, tints, nowMs, reduced, roleTint("finishBurst"));
  }

  /** Records a key; false if it was already answered. */
  private firstTime(key: string, tick: number): boolean {
    if (this.answered.has(key)) return false;
    this.answered.set(key, tick);
    return true;
  }

  private forgetBefore(tick: number): void {
    for (const [key, at] of this.answered) if (at < tick) this.answered.delete(key);
  }
}
