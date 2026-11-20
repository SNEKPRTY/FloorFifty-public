/**
 * The local player's predicted position.
 *
 * Authority arrives at twenty hertz and remote players are drawn a further
 * interpolation delay behind it, which is right for someone else's ninja and
 * wrong for your own. This carries the local one forward by stepping the
 * simulation itself.
 *
 * It steps the shared `RaceSimulation`. Not a copy of it, not the horizontal
 * half of it: the same simulation the server runs, over a state rebuilt from
 * the last snapshot. The predecessor integrated `x` from held input with no
 * notion of a floor, which is why a wall ride -- where the server pushes back
 * every tick and the input never stops asking -- drew the sprite as much as
 * fifty units from where the player actually was, over a contact reach of
 * ninety. A player saw a touch, earned no floor, and was right to call it
 * broken.
 *
 * What time it is here is not this module's opinion either. The tick to
 * predict up to arrives from `RenderClock`, the same clock the world is drawn
 * on, which every snapshot re-anchors against authority's real rate. An
 * earlier revision counted rendered frames instead, on the assumption that a
 * display draws sixty a second and a room delivers sixty ticks a second.
 * Neither is quite true, and the difference is not noise but a bias: it
 * accumulated into a lead that grew for the whole race and then sat at its
 * bound, half a second of travel, with the sprite drawn over floors the
 * player was nowhere near.
 *
 * Nothing here is authority. Position, lap, standing, score and winner all
 * still arrive from the room, and the next snapshot overrules whatever this
 * drew. When any precondition for predicting fails -- a phase that is not
 * racing, a finished racer, a ghost, tuning that disagrees, a server that has
 * gone quiet -- it does not guess and it does not answer: it returns nothing,
 * and the screen falls back to the interpolated sample it draws every other
 * player from. That is the point of returning nothing rather than the newest
 * snapshot. The newest snapshot is a different clock from the one the rest of
 * the room is drawn on, and a finisher watching the race out beside it would
 * step at the snapshot rate while everyone still racing moved smoothly.
 */

import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { clamp, lerp, shortestWrappedOffset, wrapSymmetric } from "@floor-fifty/shared/common/math";
import type {
  HeldInput,
  InputFrame,
  RaceEvent,
  RoomSnapshot,
} from "@floor-fifty/shared/common/protocol";
import type { PlayerState, RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { ReconcileReport, StandDownReason } from "./net-diagnostics";
import { snapshotToRaceState } from "./snapshot-to-race";

/** How fast a correction bleeds away, per second. The predecessor's rate. */
const CORRECTION_PER_SECOND = 6;

/**
 * A difference larger than this is a respawn, a lap reset, or a first
 * snapshot -- never ordinary movement -- so it is adopted rather than eased
 * into. One floor gap is comfortably more than a tick of running and
 * comfortably less than the distance any reset covers.
 */
const SNAP_DISTANCE = 120;

/**
 * How far ahead of the last snapshot the prediction may run before it is
 * abandoned.
 *
 * Two seconds of ticks. Past that the server is not answering, replay is
 * reconstructing a history nothing confirms, and standing down to the sample
 * is more honest than drawing a guess compounded a hundred and twenty times.
 * It is
 * measured in ticks rather than buffered frames because a player who holds one
 * direction for a minute buffers a single frame, and a player drumming the keys
 * buffers dozens in a second; neither says anything about whether the server is
 * still there.
 */
const MAX_PREDICTED_TICKS = 120;

export type PredictedState = {
  x: number;
  y: number;
  /** Sideways speed, which the racer's lean follows (Wonder spec §4.1). */
  vx: number;
  vy: number;
  facingRight: boolean;
  /** Survival's edge under the predicted racer (survival spec §7); the camera holds it at the field's bottom. */
  floorEdgeY?: number;
};

/**
 * An input frame and the tick it takes effect on.
 *
 * For a stamped frame that is the frame's own tick, which the room holds it
 * until, so the history replays exactly as the room applies it.
 */
type PendingInput = { frame: HeldInput; tick: number };

/**
 * The most frames the history keeps.
 *
 * Pruned by the server's ack on every snapshot, so in a race this holds a
 * round trip's worth. The bound is for a prediction that has stood down --
 * a finished racer watching the race out still sends -- so nothing grows for
 * as long as a room lives.
 */
const MAX_PENDING = 256;

/** Moves `value` toward zero at `rate` per second, without overshooting. */
function decay(value: number, rate: number, deltaSeconds: number): number {
  return value - value * Math.min(1, rate * deltaSeconds);
}

/**
 * The racer between two consecutive ticks, `t` of the way from one to the next.
 *
 * Across the seam the short way round, because the course wraps and the long
 * way drags the sprite back over the whole width for a frame. What does not
 * blend is the older tick's until the newer one has happened, as the snapshot
 * buffer takes it: vertical speed, because a bounce is instantaneous, and a
 * respawn, because a teleport has no halfway and drawing one slides the racer
 * across the course.
 */
function blendRacer(from: PlayerState, to: PlayerState, t: number): PredictedState {
  if (t >= 1) return { x: to.x, y: to.y, vx: to.vx, vy: to.vy, facingRight: to.facingRight, floorEdgeY: to.floorEdgeY };
  const dx = shortestWrappedOffset(from.x, to.x, VIEWPORT.width);
  const dy = to.y - from.y;
  const blend = Math.hypot(dx, dy) < SNAP_DISTANCE ? t : 0;
  return {
    x: wrapSymmetric(from.x + dx * blend, VIEWPORT.width / 2),
    y: from.y + dy * blend,
    vx: from.vx + (to.vx - from.vx) * t,
    vy: from.vy,
    facingRight: to.facingRight,
    // The edge only rises, and smoothly: blended as the height is.
    floorEdgeY: from.floorEdgeY + (to.floorEdgeY - from.floorEdgeY) * t,
  };
}

/**
 * Drops input the server has finished with, and keeps the one it has not.
 *
 * An acknowledged frame is *not* finished with. The room keeps the frame in
 * force on every tick until a newer one takes over (`InputQueue.take`), so the
 * most recent acknowledged frame is still being applied and must still be
 * replayed; only frames older than it are genuinely history.
 *
 * Dropping everything at or below the ack instead replays those ticks with no
 * input at all while the server keeps moving the player, which measures as
 * twenty-three units of drift over ten ticks and grows from there.
 */
function prune(pending: readonly PendingInput[], ack: number): PendingInput[] {
  let baseline = -1;
  for (let index = 0; index < pending.length; index += 1) {
    if (pending[index]!.frame.sequence <= ack) baseline = index;
  }
  return baseline <= 0 ? [...pending] : pending.slice(baseline);
}

export class LocalSimulation {
  private predicted: RaceState | undefined;
  /** The tick before `predicted`, which a moment between the two is blended from. */
  private previous: RaceState | undefined;
  private localId: PlayerId | undefined;
  private pending: PendingInput[] = [];
  private offsetX = 0;
  private offsetY = 0;
  private lastSnapshotTick = -1;
  /** The highest sequence authority had consumed at the last snapshot. */
  private ack = 0;
  /** False whenever the client has no business leading the sprite at all. */
  private leading = false;
  private round: string | undefined;
  private sideContacts: SideContactObservation[] = [];
  private readonly sideSeen = new Map<string, number>();
  private presentedThrough = -1;

  /**
   * The world this client predicts in.
   *
   * It holds every course body and exactly one racer. Remote players are
   * interpolated from authority and no rule reads one player's physics from
   * another's, so simulating them here would cost a body each and decide
   * nothing.
   */
  private simulation: RaceSimulation | undefined;

  constructor(
    private readonly tuning: ResolvedTuning,
    /**
     * Told when the lead stands down and why. Diagnostics only: nothing the
     * prediction decides depends on whether anyone is listening.
     */
    private readonly onStandDown?: (reason: StandDownReason) => void,
  ) {}

  /**
   * Where the local sprite should be drawn, or nothing when this has no
   * business drawing it -- which the screen reads as "use the sample".
   *
   * `moment` is the fractional tick to draw. The simulation only stands on
   * whole ticks, and a sprite drawn at the one it reached moves only when a
   * tick passes: on a 144 Hz display that is two frames in five, and on a
   * 60 Hz one it is a repeated frame and then a double step whenever the
   * clock's phase sits on a tick boundary -- beside remote racers who are
   * interpolated and move every frame. So a moment is blended between the two
   * newest ticks, and one outside them is held at the nearer. Without a
   * moment this is the newest tick.
   */
  state(moment?: number): PredictedState | undefined {
    const racer = this.racerAt(moment);
    if (racer === undefined) return undefined;
    return { ...racer, x: racer.x + this.offsetX, y: racer.y + this.offsetY };
  }

  /** The simulated racer at `moment`, before the drawing correction. */
  private racerAt(moment: number | undefined): PredictedState | undefined {
    if (!this.leading || this.predicted === undefined || this.localId === undefined) {
      return undefined;
    }
    const player = this.predicted.players[this.localId];
    if (player === undefined) { this.stopLeading("absent"); return undefined; }
    const earlier = this.previous?.players[this.localId];
    return blendRacer(earlier ?? player, player, this.fractionAt(moment));
  }

  /** How far `moment` is from the tick before the newest to the newest, held to the two. */
  private fractionAt(moment: number | undefined): number {
    if (moment === undefined || this.predicted === undefined) return 1;
    return clamp(moment - (this.predicted.tick - 1), 0, 1);
  }

  /**
   * Adopts an authoritative snapshot and replays what it has not yet seen.
   *
   * A lead is only legitimate while the player is racing under their own
   * control and both sides agree on the numbers. A countdown, a finish, a
   * ghost and a tuning mismatch are all states in which the server is not
   * moving this player the way the client would predict, so the lead stands
   * down and the sprite goes back to being drawn like everybody else's.
   *
   * `drawnAt` is the moment the sprite was last drawn at, and the correction
   * is measured there. Measured at the newest tick instead, it is right at
   * that tick and wrong everywhere else in the blend, and the sprite moves on
   * the frame a snapshot lands by however much the error changed in one tick.
   */
  reconcile(
    snapshot: RoomSnapshot,
    localId: PlayerId,
    targetTick: number | undefined,
    drawnAt?: number,
  ): ReconcileReport | undefined {
    const round = `${snapshot.round}:${snapshot.courseRevision}`;
    if (this.round !== round) { this.clear(); this.round = round; }
    const player = snapshot.players.find((candidate) => candidate.id === localId);
    if (player === undefined) { this.stopLeading("absent"); return undefined; }
    if (snapshot.tick <= this.lastSnapshotTick) return undefined;

    // Authority can reset an ascent without the predictor having stepped that
    // reset. Discard its undrawn contacts before restoring/replaying the world.
    // Snapshots repeat recent events; only a newly crossed transition counts.
    if (snapshot.events.some((event) => event.tick > this.lastSnapshotTick
      && (event.type === "playerReset" || event.type === "lapCompleted")
      && event.playerId === localId)) this.discardSideContacts();

    this.lastSnapshotTick = snapshot.tick;
    this.localId = localId;

    const refusal: StandDownReason | undefined =
      snapshot.phase !== "racing"
        ? "phase"
        : player.status !== "connected" || player.finishedAtTick !== undefined
          ? "status"
          : !this.agreesOnTuning(snapshot)
            ? "tuning"
            : undefined;

    if (refusal !== undefined) {
      this.stopLeading(refusal);
      return undefined;
    }

    const drawn = this.state(drawnAt);
    // The simulated racer before authority is adopted, and the tick it stood
    // at: the replay below lands on the same tick, so the difference between
    // the two is exactly how wrong the prediction was -- before the drawing
    // offset hides it.
    const before = this.predicted?.players[localId];
    const beforeTick = this.predicted?.tick;

    const rebuildStarted = performance.now();
    const rebuilt = snapshotToRaceState(snapshot, localId, this.tuning);
    if (rebuilt === undefined) {
      this.stopLeading("absent");
      return undefined;
    }

    // Restored, not continued. Planck's warm-start and contact caches are not
    // on the wire and cannot be, so the local world is rebuilt around
    // authority's transform every time authority speaks. A small divergence
    // before the next patch is the designed cost; a growing one is a bug.
    if (this.simulation === undefined) {
      this.simulation = createRaceSimulation(rebuilt);
    } else {
      this.simulation.restore(rebuilt);
    }

    this.pending = prune(this.pending, player.lastAckedSequence);
    this.ack = player.lastAckedSequence;

    const replayStarted = performance.now();
    [this.previous, this.predicted] = this.replay(rebuilt, targetTick);
    const replayEnded = performance.now();
    this.leading = true;

    // Correct the *drawing*, never the simulation. The state above is the
    // replayed truth; this only softens how fast the sprite reaches it, and it
    // starts below the snap distance by construction and only ever shrinks.
    //
    // There is nothing to soften on the first snapshot, or on the first one
    // after a lead was abandoned: the sprite was being drawn from the sample
    // then, which this does not track, so it adopts the replayed position.
    const now = this.predicted.players[localId]!;
    const misprediction =
      before === undefined || beforeTick !== this.predicted.tick
        ? undefined
        : Math.hypot(
            shortestWrappedOffset(now.x, before.x, VIEWPORT.width),
            before.y - now.y,
          );
    const report = (adopted: boolean): ReconcileReport => ({
      tick: this.predicted!.tick,
      replayTicks: this.predicted!.tick - rebuilt.tick,
      misprediction,
      adopted,
      rebuildMs: replayStarted - rebuildStarted,
      replayMs: replayEnded - replayStarted,
    });

    if (drawn === undefined) {
      this.offsetX = 0;
      this.offsetY = 0;
      return report(false);
    }
    const redrawn = this.racerAt(drawnAt)!;
    const dx = drawn.x - redrawn.x;
    const dy = drawn.y - redrawn.y;
    const adopt = Math.hypot(dx, dy) >= SNAP_DISTANCE;
    this.offsetX = adopt ? 0 : dx;
    this.offsetY = adopt ? 0 : dy;
    return report(adopt);
  }

  /** The drawing correction still being bled away, in units. */
  get offset(): number {
    return Math.hypot(this.offsetX, this.offsetY);
  }

  /**
   * Advances the prediction to the moment authority has reached.
   *
   * The simulation is stepped a whole tick at a time, never on render time: a
   * display that runs at 144Hz must not simulate 144 times a second, or it
   * would be playing a different game from the server. How many ticks that is
   * comes from the shared clock rather than from counting frames here --
   * `authorityTick` is the room's own tick as `RenderClock` measures it, so a
   * room running slightly slow is a rate this stays matched to rather than a
   * lead it accumulates.
   *
   * `deltaMs` is the rendered frame, and it is only ever the drawing
   * correction's: how fast an offset bleeds away is a question about the
   * screen, not about the simulation.
   */
  advance(input: HeldInput, deltaMs: number, authorityTick: number | undefined): void {
    if (!this.leading || this.predicted === undefined) return;

    const target = authorityTick === undefined ? this.predicted.tick : Math.floor(authorityTick);
    // An unstamped frame takes effect on the next tick the prediction steps,
    // which is what holding a key between two frames means.
    if (this.predicted.tick < target) {
      const last = this.pending[this.pending.length - 1];
      if (last === undefined || last.frame.sequence !== input.sequence) {
        this.pending.push({ frame: input, tick: this.predicted.tick + 1 });
      }
    }
    this.advanceTo(target);
    this.smooth(deltaMs);
  }

  /**
   * Adds one stamped frame to the history the prediction replays.
   *
   * Recorded whether or not the prediction is leading, because the room
   * applies it either way: a lead that resumes has to replay what the room has
   * been doing in the meantime, not guess at it.
   */
  record(frame: InputFrame): void {
    const last = this.pending[this.pending.length - 1];
    if (last !== undefined && last.frame.sequence >= frame.sequence) return;
    this.pending.push({ frame, tick: frame.tick });
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
  }

  /**
   * Steps the prediction up to `target`, each tick with the frame in force on it.
   *
   * The simulation is stepped a whole tick at a time, never on render time: a
   * display that runs at 144Hz must not simulate 144 times a second, or it
   * would be playing a different game from the server.
   */
  advanceTo(target: number): void {
    if (!this.leading || this.predicted === undefined) return;
    while (this.predicted.tick < target) {
      this.previous = this.predicted;
      this.predicted = this.step(this.predicted, this.frameHeldAt(this.predicted.tick + 1));
      if (this.predicted.tick - this.lastSnapshotTick > MAX_PREDICTED_TICKS) {
        this.stopLeading("silence");
        return;
      }
    }
  }

  /**
   * Bleeds the drawing correction for one rendered frame.
   *
   * `deltaMs` is the rendered frame's, and it is only ever the correction's:
   * how fast an offset fades is a question about the screen, not the race.
   */
  smooth(deltaMs: number): void {
    const deltaSeconds = deltaMs / 1000;
    this.offsetX = decay(this.offsetX, CORRECTION_PER_SECOND, deltaSeconds);
    this.offsetY = decay(this.offsetY, CORRECTION_PER_SECOND, deltaSeconds);
  }

  /**
   * Where each moving floor is at `moment` on the predicted timeline, by floor id.
   *
   * The local racer is drawn at this moment, so the floors it lands on have to
   * be drawn at it too: drawn at the interpolated sample instead, a floor
   * moving at two hundred units a second sat a dozen units or more from where
   * the racer on it was touching it. Blended between the same two ticks as the
   * racer, and the newest tick without a moment. Floors turn at their bounds
   * rather than wrap, so a plain blend is the whole of it. Undefined when the
   * prediction is not leading, which the view reads as "use the sample for
   * everything".
   */
  predictedFloors(moment?: number): ReadonlyMap<string, number> | undefined {
    if (!this.leading || this.predicted === undefined) return undefined;
    const t = this.fractionAt(moment);
    const floors = new Map<string, number>();
    for (const floor of Object.values(this.predicted.movingFloors)) {
      const earlier = this.previous?.movingFloors[floor.id];
      floors.set(floor.id, earlier === undefined ? floor.x : lerp(earlier.x, floor.x, t));
    }
    return floors;
  }

  /** Forgets the local player, as leaving the screen does. */
  clear(): void {
    this.sideContacts = [];
    this.sideSeen.clear();
    this.presentedThrough = -1;
    this.round = undefined;
    this.predictedEvents = [];
    this.predicted = undefined;
    this.previous = undefined;
    this.localId = undefined;
    this.pending = [];
    this.ack = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.lastSnapshotTick = -1;
    this.leading = false;
    this.simulation?.dispose();
    this.simulation = undefined;
  }

  /**
   * Steps from the rebuilt state back up to the tick being predicted.
   *
   * Returns the tick before the last as well as the last, for blending. When
   * the snapshot is already the tick being predicted there is no tick before
   * it to have, and the newest is drawn alone.
   */
  private replay(
    rebuilt: RaceState,
    targetTick: number | undefined,
  ): [previous: RaceState | undefined, state: RaceState] {
    // Up to the tick the caller is predicting, never past it, and never behind
    // the snapshot itself: a snapshot is authority at its own tick and there is
    // nothing to replay before it. The target comes from the one clock -- the
    // race's input tick, which is authority's tick plus the lead -- so the
    // replay covers the round trip a frame spends in flight and nothing more.
    const target = Math.max(
      rebuilt.tick,
      Math.min(
        targetTick === undefined ? rebuilt.tick : Math.floor(targetTick),
        rebuilt.tick + MAX_PREDICTED_TICKS,
      ),
    );
    let previous: RaceState | undefined;
    let state = rebuilt;

    for (let tick = rebuilt.tick + 1; tick <= target; tick += 1) {
      previous = state;
      state = this.step(state, this.frameHeldAt(tick));
    }
    return [previous, state];
  }

  /**
   * The frame in force on a given tick: the newest one taking effect by then.
   *
   * With stamped frames this is exactly the room's rule, so a frame that
   * arrived in time replays bit for bit.
   *
   * A tick earlier than every buffered frame gets the oldest one when the room
   * has acknowledged anything: that is the frame `prune` kept because the room
   * is still applying it. When the room has acknowledged nothing, it holds
   * nothing, and neither does the replay -- which `applyInputs` reads as
   * neutral, exactly as the room does.
   */
  private frameHeldAt(tick: number): HeldInput | undefined {
    const first = this.pending[0];
    let held: HeldInput | undefined = first !== undefined && this.ack > 0 ? first.frame : undefined;
    for (const entry of this.pending) {
      if (entry.tick > tick) break;
      held = entry.frame;
    }
    return held;
  }

  private predictedEvents: RaceEvent[] = [];

  private step(state: RaceState, input: HeldInput | undefined): RaceState {
    const inputs =
      input === undefined || this.localId === undefined
        ? new Map<PlayerId, HeldInput>()
        : new Map<PlayerId, HeldInput>([[this.localId, input]]);
    const result = this.simulation!.step({ ...state, tick: state.tick + 1 }, inputs);

    // The events the prediction produced, kept rather than dropped.
    //
    // They are not authority and are never treated as it: what they are good
    // for is knowing, a round trip early, that this client believes it touched
    // something. A replay re-steps ticks that have already been stepped, so the
    // same landing can appear here more than once; `creditFloor` will not
    // re-emit one the state already visited, and the speculative tracker
    // ignores a floor it is already waiting on.
    this.predictedEvents.push(...result.events);
    if (result.events.some((event) => (event.type === "playerReset" || event.type === "lapCompleted") && event.playerId === this.localId)) this.discardSideContacts();
    const cutoff = result.state.tick - MAX_PREDICTED_TICKS;
    for (const [key, tick] of this.sideSeen) if (tick < cutoff) this.sideSeen.delete(key);
    this.sideContacts = this.sideContacts.filter((contact) => contact.tick >= cutoff);
    for (const contact of result.sideContacts) {
      const key = `${state.round}:${contact.tick}:${contact.playerId}:${contact.floorId}`;
      if (contact.playerId !== this.localId || contact.tick <= this.presentedThrough || this.sideSeen.has(key)) continue;
      this.sideSeen.set(key, contact.tick);
      this.sideContacts.push(contact);
    }
    return result.state;
  }

  /**
   * The tick the prediction has reached, or nothing before it has started.
   *
   * Exposed for the speculative contact window, which measures how long a
   * prediction has gone unconfirmed and therefore has to measure it on the
   * clock the prediction runs on rather than on authority's.
   */
  get predictedTick(): number | undefined {
    return this.predicted?.tick;
  }

  /**
   * The predicted race itself, before any drawing correction.
   *
   * For measurement and for the lab's steering, which have to compare the
   * simulation rather than the picture. Read-only by contract: the object is
   * the prediction's own and is replaced, never mutated, on every step.
   */
  get predictedRace(): Readonly<RaceState> | undefined {
    return this.leading ? this.predicted : undefined;
  }

  /** How many racers the prediction world holds. One, or nothing. */
  get localPlayerCount(): number {
    return this.predicted === undefined ? 0 : Object.keys(this.predicted.players).length;
  }

  /**
   * Takes the predicted events since the last call.
   *
   * Draining rather than reading, because every one of these is a thing that
   * should happen once and a caller that read them twice would act twice.
   */
  drainSideContacts(): readonly SideContactObservation[] {
    const contacts = this.sideContacts;
    this.sideContacts = [];
    this.presentedThrough = Math.max(this.presentedThrough, this.predicted?.tick ?? -1);
    return contacts;
  }

  drainPredictedEvents(): readonly RaceEvent[] {
    const events = this.predictedEvents;
    this.predictedEvents = [];
    return events;
  }

  /** Undrawn observations belong to the discarded prediction, not its replacement. */
  private discardSideContacts(): void {
    this.sideContacts = [];
    this.sideSeen.clear();
    // Keep the presentation watermark: already-drawn contacts cannot fire twice.
  }

  /**
   * Whether the room resolves the same numbers this client does.
   *
   * Prediction is only correct while they agree, and a disagreement is silent:
   * wrong gravity draws a confident sprite in the wrong place with no error
   * anywhere. Tuning is a flat record of numbers, so a field-by-field
   * comparison is the whole check.
   */
  private agreesOnTuning(snapshot: RoomSnapshot): boolean {
    // `ResolvedTuning` is a flat `{ readonly [K in TunableName]: number }`, so a
    // field-by-field comparison is the whole check. The double cast is because
    // a readonly mapped type is not directly comparable to an index signature.
    const theirs = snapshot.tuning as unknown as Record<string, number> | undefined;
    if (theirs === undefined) return false;
    const ours = this.tuning as unknown as Record<string, number>;
    const names = Object.keys(ours);
    if (names.length !== Object.keys(theirs).length) return false;
    return names.every((name) => Object.is(ours[name], theirs[name]));
  }

  private stopLeading(reason: StandDownReason): void {
    this.sideContacts = [];
    this.predictedEvents = [];
    if (this.leading) this.onStandDown?.(reason);
    this.leading = false;
    this.predicted = undefined;
    this.previous = undefined;
    // The history is kept: the room goes on applying these frames whether or
    // not this client is drawing from them, and a lead that resumes replays
    // them. The ack prunes it on the next snapshot and `record` bounds it.
    this.offsetX = 0;
    this.offsetY = 0;
    this.simulation?.dispose();
    this.simulation = undefined;
  }
}
