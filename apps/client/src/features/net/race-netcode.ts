/**
 * The race's network timing, in one place.
 *
 * Four parts decide what moment of the race is on screen and where the local
 * racer is in it: the render clock that tracks authority, the buffer that
 * interpolates everyone else, the lead that says how far past authority to
 * predict, and the prediction that carries the local racer there. They were
 * fields of the gameplay screen, wired together inside its snapshot handler
 * and its draw call, which meant the only way to exercise them together was to
 * mount a screen -- and the netcode lab, which runs four headless clients
 * against a real server, has no screen to mount. So they live here, and the
 * screen and the lab run this same object.
 *
 * Input is sampled here too, once per predicted tick, because *when* a frame
 * takes effect is the whole of making a networked race play as if local. Each
 * frame is stamped with the tick it is sampled for and sent; the room holds it
 * until that tick; the prediction applies it on that tick. The frame the room
 * receives and the frame the prediction steps are one object, so the two agree
 * whenever it arrives in time -- and the lead is set from the room's own
 * measurements so that it does.
 *
 * What stays on the screen is presentation: which sound a landing makes,
 * whether a contact is speculative, how the view draws the answer. Nothing
 * here plays, draws or decides a rule.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type {
  InputFrame,
  RaceEvent,
  RoomPhase,
  RoomSnapshot,
} from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { InputIntent } from "../platform/input";
import type { NetDiagnostics } from "./net-diagnostics";
import { InputLead, leadForRoundTrip } from "./input-lead";
import { LocalSimulation, type PredictedState } from "./local-simulation";
import { RenderClock } from "./render-clock";
import { SnapshotBuffer } from "./snapshot-buffer";

/** How often the clock is probed. Four a second is five seconds per lead window. */
export const PING_EVERY_MS = 250;

/**
 * The most ticks one rendered frame may sample.
 *
 * Twelve is a fifth of a second -- a hitch the loop can honestly catch up on.
 * Past it the gap is a hidden tab or a stalled device, and sampling the same
 * held keys hundreds of times would only send hundreds of identical frames;
 * the loop re-seats at the present instead.
 */
export const MAX_CATCH_UP_TICKS = 12;

/**
 * How far off authority the clock may be for a probe it sends to count.
 *
 * A probe measures the lead only if the tick it carries is a fair reading of
 * where this client is. While the clock is still closing a gap -- the first
 * frames of a race, compiling shaders; a tab just brought back -- it is not,
 * and the room's answer would say the link is a hundred ticks slower than it
 * is. Two ticks is more than the clock's ordinary error on any link measured.
 */
const RELIABLE_CLOCK_ERROR_TICKS = 2;

export type RaceNetcodeOptions = {
  /** The room's own tuning, from the snapshot that brought the race up. */
  tuning: ResolvedTuning;
  /** Where measurements go. Optional: the race runs the same without it. */
  diagnostics?: NetDiagnostics;
  /** Sends one stamped frame to the room. */
  send?: (frame: InputFrame) => void;
  /** Sends a clock probe carrying `tick`, and returns its id; undefined with no room. */
  ping?: (tick: number) => number | undefined;
  /** The round trip measured before the race, which seeds the lead. */
  roundTripMs?: number;
  /**
   * The wall clock, in milliseconds: `performance.now` in a browser. Snapshot
   * arrivals are timestamped with it. Without one, time is the sum of frame
   * deltas, which is what a test that draws frames means by time.
   */
  now?: () => number;
};

/** One rendered frame's answer: the room to draw, and where the local racer is in it. */
export type NetcodeFrame = {
  /** Everyone, interpolated at the render clock's moment. */
  sample: RoomSnapshot;
  /** The local racer, carried ahead; undefined when the sample should be used. */
  predicted: PredictedState | undefined;
  /** Moving floors at the local racer's moment, by id; undefined when the sample should be used. */
  floors: ReadonlyMap<string, number> | undefined;
};

const sameIntent = (a: InputIntent, b: InputIntent): boolean =>
  a.left === b.left && a.right === b.right && a.fastFall === b.fastFall && a.reset === b.reset;

export class RaceNetcode {
  private presentationScale = 1;
  private presentationLag = 0;
  private lastDrawn: number | undefined;
  private readonly buffer = new SnapshotBuffer();
  private readonly clock: RenderClock;
  private readonly lead: InputLead;
  private readonly prediction: LocalSimulation;
  private readonly diagnostics: NetDiagnostics | undefined;
  private readonly send: ((frame: InputFrame) => void) | undefined;
  private readonly ping: ((tick: number) => number | undefined) | undefined;

  /** The last tick input was sampled for, which is the tick the prediction stands at. */
  private inputTick: number | undefined;
  /** The moment the local racer was last drawn at, which a correction is measured from. */
  private drawnAt: number | undefined;
  private sequence = 0;
  /** The last frame sent, which is what the room holds unless it was lost. */
  private lastSent: InputFrame | undefined;
  /** The newest snapshot's phase: input is only worth sending while the room takes it. */
  private phase: RoomPhase | undefined;
  private newestTick = Number.NEGATIVE_INFINITY;
  private sincePing = Number.POSITIVE_INFINITY;
  /** The lead each outstanding probe was sent with, and whether it can count, by id. */
  private readonly pings = new Map<number, { lead: number; reliable: boolean }>();

  constructor(options: RaceNetcodeOptions) {
    this.diagnostics = options.diagnostics;
    this.send = options.send;
    this.ping = options.ping;
    this.clock = new RenderClock(options.now);
    this.lead = new InputLead(leadForRoundTrip(options.roundTripMs));
    this.prediction = new LocalSimulation(options.tuning, (reason) =>
      this.diagnostics?.standDown(reason),
    );
  }

  /**
   * Takes one authority snapshot.
   *
   * It steers the render clock -- never setting it outright except across a
   * gap too large to ease -- and reconciles the prediction against it. The
   * prediction replays from the newest snapshot, where the server actually put
   * the player, up to the tick input has been sampled for.
   */
  observe(snapshot: RoomSnapshot, localId: PlayerId | undefined, receivedAt?: number): void {
    this.diagnostics?.snapshot(snapshot.tick);
    this.buffer.push(snapshot);
    if (snapshot.tick > this.newestTick) {
      this.newestTick = snapshot.tick;
      this.phase = snapshot.phase;
    }

    this.clock.observe(snapshot.tick, receivedAt);

    if (localId !== undefined) {
      // A page that reclaims a seat mid-race starts counting from nothing, but
      // the room kept the seat's numbering and refuses every frame at or below
      // it -- the racer would stand frozen until the count caught up. Numbering
      // on from what authority has consumed puts the two back in step.
      const acked = snapshot.players.find((player) => player.id === localId)?.lastAckedSequence;
      if (acked !== undefined && acked > this.sequence) this.sequence = acked;

      const report = this.prediction.reconcile(snapshot, localId, this.inputTick, this.drawnAt);
      if (report !== undefined) this.diagnostics?.reconcile(report);
    }
  }

  /**
   * Advances one rendered frame, sampling input for every tick it crosses.
   *
   * Undefined until the first snapshot, because before one there is no race
   * to be at a moment of.
   */
  frame(sample: () => InputIntent, deltaMs: number): NetcodeFrame | undefined {
    this.clock.advance(deltaMs);
    const snapped = this.clock.takeSnap();
    if (snapped !== undefined) this.diagnostics?.clockSnapped(snapped);
    this.lead.advance(deltaMs);
    const moment = this.clock.current();
    const authority = this.clock.authorityTick();
    if (moment === undefined || authority === undefined || this.buffer.size === 0) return undefined;
    this.presentationLag += (Math.max(0, deltaMs) / TICK_MS) * (1 - this.presentationScale);
    const slowed = this.presentationLag > 0;
    // Never before the oldest snapshot held; unslowed, exactly the clock's moment.
    const drawn = slowed ? Math.max(moment - this.presentationLag, this.buffer.oldestTick ?? moment) : moment;
    this.lastDrawn = slowed ? drawn : undefined;

    this.sampleUpTo(Math.floor(authority + this.lead.ticks), sample);
    this.prediction.smooth(deltaMs);

    this.sincePing += deltaMs;
    if (this.sincePing >= PING_EVERY_MS && this.ping !== undefined) {
      this.sincePing = 0;
      const id = this.ping(authority + this.lead.ticks);
      if (id !== undefined) {
        this.pings.set(id, {
          lead: this.lead.ticks,
          reliable: Math.abs(this.clock.error) <= RELIABLE_CLOCK_ERROR_TICKS,
        });
        // A probe that is never answered is forgotten rather than kept forever.
        if (this.pings.size > 16) this.pings.delete(this.pings.keys().next().value!);
      }
    }

    if (this.diagnostics !== undefined) {
      this.diagnostics.clock(this.clock.error, this.clock.rateSkew, this.clock.interpolationDelay);
      this.diagnostics.buffer((this.buffer.latest()?.tick ?? moment) - moment);
      this.diagnostics.offset(this.prediction.offset);
      this.diagnostics.lead(this.lead.ticks, this.lead.target);
    }

    // The local racer is drawn a tick behind the newest one input has reached,
    // blended from the tick before it. The clock's moment falls between two
    // whole ticks and the next is not stepped until its input is sampled, so
    // this is the latest moment the prediction can draw rather than repeat.
    this.drawnAt = authority + this.lead.ticks - 1;
    // While slowed, everyone is drawn from the room's record, the local racer
    // included: the prediction runs ahead of authority, so slowing it would
    // show a moment nobody else is at.
    return {
      sample: this.buffer.sample(drawn),
      predicted: slowed ? undefined : this.prediction.state(this.drawnAt),
      floors: slowed ? undefined : this.prediction.predictedFloors(this.drawnAt),
    };
  }

  /**
   * Brings input and the prediction up to `target`: sample once, stamp, step.
   *
   * Input is sampled once per rendered frame that reaches a new tick, and a
   * change is stamped with the *latest* tick the frame reaches. A frame that
   * covers several ticks -- a hitch, a slow device -- could only notice a key
   * now, so stamping it on the earliest of them would claim it was pressed in
   * the past, and hand the room a frame already late. The ticks before it are
   * stepped with the frame already in force.
   *
   * The first frame always goes out, so the room holds this client's intent
   * from the start rather than assuming nothing is held.
   */
  private sampleUpTo(target: number, sample: () => InputIntent): void {
    // Re-seated rather than caught up after a long gap either way: forward, so
    // a hidden tab does not sample hundreds of identical ticks; backward, so a
    // clock that lands far behind never leaves input dead until it catches up.
    // A stamp that runs backward is harmless: the room never lets a frame take
    // effect before the one sent ahead of it.
    if (this.inputTick === undefined || Math.abs(target - this.inputTick) > MAX_CATCH_UP_TICKS) {
      this.inputTick = target - 1;
    }
    if (this.inputTick >= target) return;

    this.prediction.advanceTo(target - 1);
    this.inputTick = target;
    const intent = sample();
    const accepting = this.phase === "racing" || this.phase === "countdown";
    if (
      accepting &&
      (this.lastSent === undefined || !sameIntent(intent, this.lastSent) || intent.reset)
    ) {
      this.sequence += 1;
      const frame: InputFrame = { sequence: this.sequence, tick: target, ...intent };
      this.lastSent = frame;
      this.send?.(frame);
      this.diagnostics?.inputSent();
      this.prediction.record(frame);
    }
    this.prediction.advanceTo(target);
  }

  /**
   * The room answered a probe.
   *
   * RTT is measured against the send; slack, when the probe carried a tick,
   * steers the lead.
   */
  pong(id: number, rttMs: number, slack: number | null): void {
    const sent = this.pings.get(id);
    this.pings.delete(id);
    this.diagnostics?.pong(rttMs, slack ?? undefined);
    if (slack !== null && sent !== undefined && sent.reliable) this.lead.observe(sent.lead, slack);
  }

  /**
   * The connection came back.
   *
   * Frames sent while it was down went nowhere, so the room may hold an older
   * one than this client last sent. Forgetting the last frame sent makes the
   * next tick send the current intent again, which puts the two back in step.
   */
  resync(): void {
    this.lastSent = undefined;
  }

  /** The room at the render clock's moment, without advancing it. */
  sample(): RoomSnapshot | undefined {
    const moment = this.clock.current();
    if (moment === undefined || this.buffer.size === 0) return undefined;
    return this.buffer.sample(moment);
  }

  /**
   * The local racer at the newest tick predicted, correction included, or
   * nothing when the sample should be drawn. The frame draws it blended with
   * the tick before; this is the tick itself, for measurement.
   */
  predicted(): PredictedState | undefined {
    return this.prediction.state();
  }

  /** The predicted race before any drawing correction, for measurement and steering. */
  predictedRace(): Readonly<RaceState> | undefined {
    return this.prediction.predictedRace;
  }

  /** The tick the prediction has reached, for the speculative contact window. */
  get predictedTick(): number | undefined {
    return this.prediction.predictedTick;
  }

  /** The tick input was last sampled for, or nothing before the first frame. */
  get sampledTick(): number | undefined {
    return this.inputTick;
  }

  /** The lead in ticks, for diagnostics and the lab. */
  get leadTicks(): number {
    return this.lead.ticks;
  }

  /** The moment everyone else is drawn at, on the one clock. */
  renderTick(): number | undefined {
    return this.lastDrawn ?? this.clock.current();
  }

  /**
   * Slows what is drawn without slowing the race (race-flow spec §5.2): the
   * drawn moment falls behind by (1 - scale) of each frame. The clock, its
   * estimate of authority, input sampling and sending are untouched; the
   * clock reads wall time in production, so scaling its delta would not slow
   * it anyway.
   */
  setPresentationScale(scale: number): void {
    this.presentationScale = Math.min(1, Math.max(0, scale));
  }

  /** Where authority is now, on the one clock. */
  authorityTick(): number | undefined {
    return this.clock.authorityTick();
  }

  /** Contacts the prediction made since the last call. Each is handed out once. */
  drainSideContacts() { return this.prediction.drainSideContacts(); }

  drainPredictedEvents(): readonly RaceEvent[] {
    return this.prediction.drainPredictedEvents();
  }

  /** Forgets the race, as leaving the screen does. */
  clear(): void {
    this.buffer.clear();
    this.prediction.clear();
    this.clock.clear();
    this.inputTick = undefined;
    this.drawnAt = undefined;
    this.lastSent = undefined;
    this.phase = undefined;
    this.newestTick = Number.NEGATIVE_INFINITY;
    this.pings.clear();
    this.presentationScale = 1;
    this.presentationLag = 0;
    this.lastDrawn = undefined;
  }
}
