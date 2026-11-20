/**
 * What a room's clock, physics and inputs are doing, measured.
 *
 * A room runs the race on a timer the operating system is only loosely
 * obliged to honour, steps a rigid-body world sixty times a second, and takes
 * input from four sockets it does not control. Every one of those can go
 * wrong silently: a timer that fires at 58.9 Hz, a step that spikes when a
 * world is rebuilt, a client whose frames arrive after the tick they were
 * meant for. None of them throw. They show up as a race that feels wrong, and
 * the only way to tell which one is to have been measuring already.
 *
 * Two outputs, deliberately different in how loud they are:
 *
 * - **Anomalies** are logged whenever a sink is attached, rate-limited per
 *   kind. A tick that took half its budget or a timer that stalled is
 *   something an operator wants to hear about in production.
 * - **Summaries** are logged only when asked for (`FLOOR_FIFTY_TELEMETRY=1`),
 *   because a line per room every ten seconds is a development tool.
 *
 * A room is named by a process-local serial and nothing else. Room codes,
 * player names and tokens never reach a log line: a code is the credential
 * that lets a stranger join a room, and a log is copied far more widely than
 * the room ever is.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { Distribution, formatSummary, type DistributionSummary } from "@floor-fifty/shared/common/telemetry";
import type { StepStats } from "@floor-fifty/shared/simulation/simulation";

/** What happened to one input frame, from the room's side of the socket. */
export type InputOutcome =
  | "accepted"
  | "late"
  | "rejected-rate"
  | "rejected-malformed"
  | "rejected-sequence"
  | "rejected-lead"
  | "rejected-full"
  | "rejected-phase";

const INPUT_OUTCOMES: readonly InputOutcome[] = [
  "accepted",
  "late",
  "rejected-rate",
  "rejected-malformed",
  "rejected-sequence",
  "rejected-lead",
  "rejected-full",
  "rejected-phase",
];

/**
 * Anomaly thresholds.
 *
 * Half a tick is the point where a tick stops being cheap: two of them back to
 * back would miss a frame. A hundred milliseconds between timer callbacks is
 * six ticks the room did not run on time, which a client sees as a hitch.
 */
export const SLOW_TICK_MS = TICK_MS / 2;
export const STALL_MS = 100;
export const SLOW_PATCH_MS = TICK_MS / 2;

/** One line per anomaly kind per room, at most this often. */
const ANOMALY_COOLDOWN_MS = 10_000;

/** How often a summary line is written when summaries are enabled. */
const SUMMARY_EVERY_MS = 10_000;

/** Tick timestamps kept for the rate estimate: ten seconds of them. */
const RATE_WINDOW = 600;

export type RoomTelemetryOptions = {
  /** Process-local room number. The only name a room has in telemetry. */
  serial: number;
  /** Milliseconds, monotonic. Injected so a test can drive time. */
  now?: () => number;
  /** Where lines go. Absent means nowhere, which is the default in tests. */
  log?: (line: string) => void;
  /** Whether to write a periodic summary as well as anomalies. */
  summaries?: boolean;
  /** Each finished tick's cost in ms, for the process's once-a-minute `ticks` line. */
  tickCost?: (ms: number) => void;
};

export type PhysicsSummary = {
  steps: number;
  bodies: number;
  contacts: DistributionSummary;
  /** Facts per step, by what they meant. */
  top: DistributionSummary;
  side: DistributionSummary;
  underside: DistributionSummary;
  foot: DistributionSummary;
};

export type RoomTelemetrySummary = {
  room: number;
  uptimeMs: number;
  ticks: number;
  /** Ticks per second over the last ten seconds of ticks. */
  tickRateHz: number;
  tickIntervalMs: DistributionSummary;
  ticksPerCallback: DistributionSummary;
  /** Wall time the loop gave up on rather than replaying. */
  droppedMs: number;
  /** A whole `stepOnce`, and the two parts of it that cost anything. */
  tickMs: DistributionSummary;
  stepMs: DistributionSummary;
  projectMs: DistributionSummary;
  patches: number;
  patchIntervalMs: DistributionSummary;
  patchMs: DistributionSummary;
  inputs: Record<InputOutcome, number>;
  /** How early frames arrived, in ticks. Negative is late. */
  slackTicks: DistributionSummary;
  pings: number;
  /** Commands dropped because their request id could not be read. */
  droppedRequestIds: number;
  physics: PhysicsSummary;
  invariants: number;
};

/** Live rooms, for the debug endpoint. A room removes itself when it closes. */
const live = new Set<RoomTelemetry>();

/** Every live room's summary, oldest room first. */
export function liveRoomSummaries(): RoomTelemetrySummary[] {
  return [...live].map((telemetry) => telemetry.summary()).sort((a, b) => a.room - b.room);
}

let nextSerial = 0;

/** A fresh process-local room number. */
export function allocateRoomSerial(): number {
  nextSerial += 1;
  return nextSerial;
}

export class RoomTelemetry {
  private readonly now: () => number;
  private readonly log: ((line: string) => void) | undefined;
  private readonly summaries: boolean;
  private readonly createdAt: number;

  private ticks = 0;
  private readonly tickTimes: number[] = [];
  private lastTickAt: number | undefined;
  private tickStartedAt: number | undefined;
  private lastPatchAt: number | undefined;
  private droppedMs = 0;
  private patches = 0;
  private pings = 0;
  private droppedRequestIds = 0;
  private invariants = 0;
  private lastSummaryAt: number;
  private readonly lastAnomalyAt = new Map<string, number>();

  private readonly tickInterval = new Distribution();
  private readonly perCallback = new Distribution();
  private readonly tickCost = new Distribution();
  private readonly stepCost = new Distribution();
  private readonly projectCost = new Distribution();
  private readonly patchInterval = new Distribution();
  private readonly patchCost = new Distribution();
  private readonly slack = new Distribution();
  private readonly inputs = new Map<InputOutcome, number>(INPUT_OUTCOMES.map((o) => [o, 0]));

  private physicsSteps = 0;
  private bodies = 0;
  private readonly contacts = new Distribution();
  private readonly facts = {
    top: new Distribution(),
    side: new Distribution(),
    underside: new Distribution(),
    foot: new Distribution(),
  };

  constructor(private readonly options: RoomTelemetryOptions) {
    this.now = options.now ?? (() => performance.now());
    this.log = options.log;
    this.summaries = options.summaries ?? false;
    this.createdAt = this.now();
    this.lastSummaryAt = this.createdAt;
    live.add(this);
  }

  get serial(): number {
    return this.options.serial;
  }

  /** A tick is about to run. */
  tickStarted(): void {
    const at = this.now();
    this.tickStartedAt = at;
    if (this.lastTickAt !== undefined) {
      const interval = at - this.lastTickAt;
      this.tickInterval.add(interval);
      if (interval > STALL_MS) {
        this.anomaly("stall", `timer stalled ${interval.toFixed(1)}ms between ticks`);
      }
    }
    this.lastTickAt = at;
    this.tickTimes.push(at);
    if (this.tickTimes.length > RATE_WINDOW) this.tickTimes.shift();
  }

  /** The tick that `tickStarted` opened has finished, with its two costly parts. */
  tickFinished(parts: { stepMs: number; projectMs: number }): void {
    this.ticks += 1;
    this.stepCost.add(parts.stepMs);
    this.projectCost.add(parts.projectMs);
    if (this.tickStartedAt !== undefined) {
      const cost = this.now() - this.tickStartedAt;
      this.tickCost.add(cost);
      this.options.tickCost?.(cost);
      if (cost > SLOW_TICK_MS) {
        this.anomaly(
          "slow-tick",
          `slow tick ${cost.toFixed(2)}ms (step ${parts.stepMs.toFixed(2)}ms, ` +
            `project ${parts.projectMs.toFixed(2)}ms) against a ${TICK_MS.toFixed(2)}ms budget`,
        );
      }
    }
    this.tickStartedAt = undefined;
    this.maybeReport();
  }

  /** One timer callback ran `ticks` ticks and gave up on `droppedMs` of wall time. */
  callback(ticks: number, droppedMs: number): void {
    this.perCallback.add(ticks);
    if (droppedMs > 0) {
      this.droppedMs += droppedMs;
      this.anomaly("dropped", `dropped ${droppedMs.toFixed(1)}ms of room time catching up`);
    }
  }

  /** One patch went out, costing `ms` to encode and send. */
  patchSent(ms: number): void {
    const at = this.now();
    this.patches += 1;
    this.patchCost.add(ms);
    if (this.lastPatchAt !== undefined) this.patchInterval.add(at - this.lastPatchAt);
    this.lastPatchAt = at;
    if (ms > SLOW_PATCH_MS) this.anomaly("slow-patch", `slow patch ${ms.toFixed(2)}ms`);
  }

  /** One input frame's fate, and how early it was when it had one. */
  input(outcome: InputOutcome, slackTicks?: number): void {
    this.inputs.set(outcome, (this.inputs.get(outcome) ?? 0) + 1);
    if (slackTicks !== undefined) this.slack.add(slackTicks);
  }

  ping(): void {
    this.pings += 1;
  }

  /**
   * A command was dropped because its request id could not be read (audit
   * A01). Only counted: there is no valid id to answer, and a client that
   * repeats the mistake must not be able to fill the journal.
   */
  requestIdDropped(): void {
    this.droppedRequestIds += 1;
  }

  /**
   * A seat spent its whole command budget and a command was dropped (audit
   * B2). One line per cooldown, never one per command, so a flood cannot fill
   * the journal; it names no seat, address or message.
   */
  commandThrottled(): void {
    this.anomaly("command-throttled", "command budget exhausted; commands dropped");
  }

  /** What the last racing step asked of the solver. */
  physics(stats: StepStats): void {
    if (stats.steps === this.physicsSteps) return;
    this.physicsSteps = stats.steps;
    this.bodies = stats.bodies;
    this.contacts.add(stats.contacts);
    this.facts.top.add(stats.facts.top);
    this.facts.side.add(stats.facts.side);
    this.facts.underside.add(stats.facts.underside);
    this.facts.foot.add(stats.facts.foot);
  }

  /**
   * A client message threw past its handler and was dropped (audit A01).
   *
   * Names the message type and the error's class only: the error's text can
   * echo what the client sent. Rate-limited like any anomaly, so a client
   * repeating a bad message cannot flood the journal.
   */
  messageFailed(type: string, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : "unknown";
    this.anomaly("message-failed", `message failed ${type} ${errorClass}`);
  }

  /** A simulation invariant failed; the room has stopped. */
  invariant(name: string): void {
    this.invariants += 1;
    // Never rate-limited: a room stops once, and the line is the bug report.
    this.log?.(`[ff:room ${this.serial}] simulation invariant ${name} failed; room halted`);
  }

  summary(): RoomTelemetrySummary {
    const times = this.tickTimes;
    const span = times.length > 1 ? times[times.length - 1]! - times[0]! : 0;
    return {
      room: this.serial,
      uptimeMs: this.now() - this.createdAt,
      ticks: this.ticks,
      tickRateHz: span > 0 ? ((times.length - 1) * 1000) / span : 0,
      tickIntervalMs: this.tickInterval.summary(),
      ticksPerCallback: this.perCallback.summary(),
      droppedMs: this.droppedMs,
      tickMs: this.tickCost.summary(),
      stepMs: this.stepCost.summary(),
      projectMs: this.projectCost.summary(),
      patches: this.patches,
      patchIntervalMs: this.patchInterval.summary(),
      patchMs: this.patchCost.summary(),
      inputs: Object.fromEntries(this.inputs) as Record<InputOutcome, number>,
      slackTicks: this.slack.summary(),
      pings: this.pings,
      droppedRequestIds: this.droppedRequestIds,
      physics: {
        steps: this.physicsSteps,
        bodies: this.bodies,
        contacts: this.contacts.summary(),
        top: this.facts.top.summary(),
        side: this.facts.side.summary(),
        underside: this.facts.underside.summary(),
        foot: this.facts.foot.summary(),
      },
      invariants: this.invariants,
    };
  }

  /** Writes a summary line when summaries are on and one is due. */
  maybeReport(): void {
    if (!this.summaries || this.log === undefined) return;
    const at = this.now();
    if (at - this.lastSummaryAt < SUMMARY_EVERY_MS) return;
    this.lastSummaryAt = at;
    this.log(formatRoomSummary(this.summary()));
  }

  /**
   * A seat joined from another build on the same rules (release readiness
   * D-G7): seated, and worth hearing about, because a skew that never ends
   * means a client host is serving an old build.
   */
  buildSkew(clientBuildId: string, serverBuildId: string): void {
    this.anomaly("build-skew", `build-skew client ${clientBuildId} server ${serverBuildId}`);
  }

  /** The room has closed. It stops appearing in the debug endpoint. */
  dispose(): void {
    live.delete(this);
  }

  private anomaly(kind: string, message: string): void {
    if (this.log === undefined) return;
    const at = this.now();
    const last = this.lastAnomalyAt.get(kind);
    if (last !== undefined && at - last < ANOMALY_COOLDOWN_MS) return;
    this.lastAnomalyAt.set(kind, at);
    this.log(`[ff:room ${this.serial}] ${message}`);
  }
}

/** One summary as one log line. */
export function formatRoomSummary(summary: RoomTelemetrySummary): string {
  const inputs = summary.inputs;
  const rejected =
    inputs["rejected-rate"] +
    inputs["rejected-malformed"] +
    inputs["rejected-sequence"] +
    inputs["rejected-lead"] +
    inputs["rejected-full"] +
    inputs["rejected-phase"];
  return (
    `[ff:room ${summary.room}] ${summary.tickRateHz.toFixed(2)} Hz, ` +
    `tick ms ${formatSummary(summary.tickMs, 2)}, ` +
    `step ms ${formatSummary(summary.stepMs, 2)}, ` +
    `interval ms ${formatSummary(summary.tickIntervalMs)}, ` +
    `patches ${summary.patches} (interval ${formatSummary(summary.patchIntervalMs)}), ` +
    `inputs ${inputs.accepted} ok / ${inputs.late} late / ${rejected} rejected, ` +
    `slack ${formatSummary(summary.slackTicks)}, ` +
    `contacts ${formatSummary(summary.physics.contacts, 0)}, dropped ${summary.droppedMs.toFixed(0)}ms`
  );
}
