/**
 * What this client's netcode is doing, measured.
 *
 * The race is drawn from three moving parts that each fail quietly: a clock
 * that tracks authority, a buffer that interpolates everyone else, and a
 * prediction that carries the local racer ahead. When one of them is off, the
 * symptom is a feel -- "floaty", "rubber-bandy", "it said I missed" -- and a
 * feel cannot be bisected. This collector turns each part into numbers that
 * can.
 *
 * It observes and never steers. Nothing in the race reads a value back out of
 * it, so turning the overlay on cannot change the game it reports on.
 *
 * Anomalies are logged to the console only while someone is looking (the
 * overlay is up, or a sink was attached), and each kind at most once a second:
 * a log that fires every frame is a log nobody reads.
 */

import { Distribution, type DistributionSummary } from "@floor-fifty/shared/common/telemetry";

/** Why a prediction stopped leading. Each is a different bug, or none. */
export type StandDownReason = "phase" | "absent" | "status" | "tuning" | "silence";

/** One reconcile, as `LocalSimulation` saw it. */
export type ReconcileReport = {
  /** The tick the prediction stood at after the replay. */
  tick: number;
  /** Ticks stepped past the snapshot to get there. */
  replayTicks: number;
  /**
   * How far the simulated racer moved when authority was adopted, in units,
   * before any smoothing. Undefined when there was no earlier prediction at
   * the same tick to compare against.
   */
  misprediction: number | undefined;
  /** The correction was large enough to adopt outright rather than ease. */
  adopted: boolean;
  /** Rebuilding the world around the snapshot, and replaying from it. */
  rebuildMs: number;
  replayMs: number;
};

export type NetSummary = {
  snapshots: {
    count: number;
    /** Same tick as the newest already seen: a republish, harmless. */
    duplicates: number;
    /** Older than the newest already seen: the transport reordered. */
    reordered: number;
    intervalMs: DistributionSummary;
    tickStep: DistributionSummary;
  };
  clock: {
    errorTicks: DistributionSummary;
    skew: DistributionSummary;
    snaps: number;
    /** How far behind authority everyone else is drawn, now. */
    delayTicks: number;
  };
  buffer: { headroomTicks: DistributionSummary; underruns: number; frames: number };
  prediction: {
    reconciles: number;
    misprediction: DistributionSummary;
    replayTicks: DistributionSummary;
    rebuildMs: DistributionSummary;
    replayMs: DistributionSummary;
    adopts: number;
    offset: DistributionSummary;
    standDowns: Record<StandDownReason, number>;
  };
  input: {
    sent: number;
    leadTicks: number;
    leadTarget: number;
    slackTicks: DistributionSummary;
    rttMs: DistributionSummary;
  };
  frame: { frameMs: DistributionSummary; drawMs: DistributionSummary; longFrames: number };
  wire: { bytesIn: number; bytesPerSecond: number };
};

/** Thresholds that are worth a console line. */
export const ANOMALY = {
  /** Past this the player can see the sprite pulled; a sixth of a body width. */
  mispredictionUnits: 8,
  /** A frame this long is three missed vsyncs at 60 Hz. */
  longFrameMs: 50,
} as const;

const STAND_DOWN_REASONS: readonly StandDownReason[] = [
  "phase",
  "absent",
  "status",
  "tuning",
  "silence",
];

export class NetDiagnostics {
  private readonly now: () => number;
  private log: ((line: string) => void) | undefined;
  private readonly lastLogged = new Map<string, number>();

  private snapshotCount = 0;
  private duplicates = 0;
  private reordered = 0;
  private newestTick: number | undefined;
  private lastArrival: number | undefined;
  private readonly snapshotInterval = new Distribution();
  private readonly tickStep = new Distribution();

  private readonly clockError = new Distribution();
  private readonly clockSkew = new Distribution();
  private snaps = 0;
  private delayTicks = 0;

  private readonly headroom = new Distribution();
  private underruns = 0;
  private frames = 0;

  private reconciles = 0;
  private adopts = 0;
  private readonly misprediction = new Distribution();
  private readonly replayTicks = new Distribution();
  private readonly rebuildMs = new Distribution();
  private readonly replayMs = new Distribution();
  private readonly offsets = new Distribution();
  private readonly standDowns = new Map<StandDownReason, number>(
    STAND_DOWN_REASONS.map((reason) => [reason, 0]),
  );

  private sent = 0;
  private leadTicks = 0;
  private leadTarget = 0;
  private readonly slack = new Distribution(128);
  private readonly rtt = new Distribution(128);

  private readonly frameMs = new Distribution();
  private readonly drawMs = new Distribution();
  private longFrames = 0;

  private bytesIn = 0;
  private readonly byteWindow: { at: number; total: number }[] = [];

  constructor(options: { now?: () => number; log?: (line: string) => void } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.log = options.log;
  }

  /** Attaches or detaches the console sink. Only anomalies are ever logged. */
  setLog(log: ((line: string) => void) | undefined): void {
    this.log = log;
  }

  /** A snapshot was published to the race. */
  snapshot(tick: number): void {
    const at = this.now();
    this.snapshotCount += 1;
    if (this.newestTick !== undefined) {
      if (tick === this.newestTick) {
        this.duplicates += 1;
        return;
      }
      if (tick < this.newestTick) {
        this.reordered += 1;
        return;
      }
      this.tickStep.add(tick - this.newestTick);
    }
    if (this.lastArrival !== undefined) this.snapshotInterval.add(at - this.lastArrival);
    this.lastArrival = at;
    this.newestTick = tick;
  }

  /** The render clock after a frame: how far it trails its anchor, at what rate, how far back. */
  clock(errorTicks: number, skew: number, delayTicks: number): void {
    this.clockError.add(errorTicks);
    this.clockSkew.add(skew);
    this.delayTicks = delayTicks;
  }

  /** The render clock jumped rather than eased. */
  clockSnapped(snap: {
    jump: number;
    frameTicks: number;
    anchorAgeMs: number;
    anchorTick: number;
  }): void {
    this.snaps += 1;
    this.anomaly(
      "snap",
      `render clock snapped ${snap.jump.toFixed(1)} ticks on a ${snap.frameTicks.toFixed(1)}-tick ` +
        `frame, to tick ${snap.anchorTick} which arrived ${snap.anchorAgeMs.toFixed(0)} ms before`,
    );
  }

  /** How far past the render tick the buffer reaches; an underrun is none at all. */
  buffer(headroomTicks: number): void {
    this.frames += 1;
    this.headroom.add(headroomTicks);
    if (headroomTicks <= 0) this.underruns += 1;
  }

  reconcile(report: ReconcileReport): void {
    this.reconciles += 1;
    this.replayTicks.add(report.replayTicks);
    this.rebuildMs.add(report.rebuildMs);
    this.replayMs.add(report.replayMs);
    if (report.adopted) this.adopts += 1;
    if (report.misprediction !== undefined) {
      this.misprediction.add(report.misprediction);
      if (report.misprediction > ANOMALY.mispredictionUnits && !report.adopted) {
        this.anomaly(
          "mispredict",
          `misprediction ${report.misprediction.toFixed(1)} units at tick ${report.tick}`,
        );
      }
    }
  }

  /** The drawing offset still being bled away this frame. */
  offset(units: number): void {
    this.offsets.add(units);
  }

  standDown(reason: StandDownReason): void {
    this.standDowns.set(reason, (this.standDowns.get(reason) ?? 0) + 1);
    this.anomaly(`stand-down:${reason}`, `prediction stood down (${reason})`);
  }

  inputSent(): void {
    this.sent += 1;
  }

  lead(ticks: number, target: number): void {
    this.leadTicks = ticks;
    this.leadTarget = target;
  }

  pong(rttMs: number, slackTicks: number | undefined): void {
    this.rtt.add(rttMs);
    if (slackTicks !== undefined) this.slack.add(slackTicks);
  }

  /** One rendered frame: the gap since the last one and what `draw` cost. */
  frame(frameMs: number, drawMs: number): void {
    this.frameMs.add(frameMs);
    this.drawMs.add(drawMs);
    if (frameMs > ANOMALY.longFrameMs) {
      this.longFrames += 1;
      this.anomaly("long-frame", `long frame ${frameMs.toFixed(1)}ms (draw ${drawMs.toFixed(2)}ms)`);
    }
  }

  /** The socket's lifetime received byte count, as the transport reports it. */
  wire(totalBytesIn: number): void {
    const at = this.now();
    this.bytesIn = totalBytesIn;
    this.byteWindow.push({ at, total: totalBytesIn });
    while (this.byteWindow.length > 2 && at - this.byteWindow[0]!.at > 5_000) this.byteWindow.shift();
  }

  summary(): NetSummary {
    const first = this.byteWindow[0];
    const last = this.byteWindow[this.byteWindow.length - 1];
    const span = first !== undefined && last !== undefined ? last.at - first.at : 0;
    return {
      snapshots: {
        count: this.snapshotCount,
        duplicates: this.duplicates,
        reordered: this.reordered,
        intervalMs: this.snapshotInterval.summary(),
        tickStep: this.tickStep.summary(),
      },
      clock: {
        errorTicks: this.clockError.summary(),
        skew: this.clockSkew.summary(),
        snaps: this.snaps,
        delayTicks: this.delayTicks,
      },
      buffer: {
        headroomTicks: this.headroom.summary(),
        underruns: this.underruns,
        frames: this.frames,
      },
      prediction: {
        reconciles: this.reconciles,
        misprediction: this.misprediction.summary(),
        replayTicks: this.replayTicks.summary(),
        rebuildMs: this.rebuildMs.summary(),
        replayMs: this.replayMs.summary(),
        adopts: this.adopts,
        offset: this.offsets.summary(),
        standDowns: Object.fromEntries(this.standDowns) as Record<StandDownReason, number>,
      },
      input: {
        sent: this.sent,
        leadTicks: this.leadTicks,
        leadTarget: this.leadTarget,
        slackTicks: this.slack.summary(),
        rttMs: this.rtt.summary(),
      },
      frame: {
        frameMs: this.frameMs.summary(),
        drawMs: this.drawMs.summary(),
        longFrames: this.longFrames,
      },
      wire: {
        bytesIn: this.bytesIn,
        bytesPerSecond:
          span > 0 && first !== undefined && last !== undefined
            ? ((last.total - first.total) * 1000) / span
            : 0,
      },
    };
  }

  private anomaly(kind: string, message: string): void {
    if (this.log === undefined) return;
    const at = this.now();
    const last = this.lastLogged.get(kind);
    if (last !== undefined && at - last < 1_000) return;
    this.lastLogged.set(kind, at);
    this.log(`[ff:net] ${message}`);
  }
}
