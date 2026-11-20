/**
 * The netcode lab.
 *
 * One real race server and up to four headless clients, each behind its own
 * latency proxy, each running the client's real network manager and the same
 * `RaceNetcode` the gameplay screen runs. Each is steered by the reference
 * controller from the picture it would draw -- exactly the information a
 * player has -- and every frame is recorded.
 *
 * The server runs in this process, which is what makes the comparison
 * possible: the room's authoritative position for every player on every tick
 * is recorded as it happens, so what a client drew for tick `T` can be held
 * against what authority decided for tick `T`. That is the whole question the
 * lab exists to answer. "Does it play as if local" means: is what the player
 * sees what the server decided, and does it respond when they do.
 *
 * Nothing here reaches into the race to help it. The proxies carry bytes; the
 * clients send intent through the same port a keypress uses.
 */

import { matchMaker } from "@colyseus/core";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import { shortestWrappedOffset } from "@floor-fifty/shared/common/math";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { Distribution, type DistributionSummary } from "@floor-fifty/shared/common/telemetry";
import { createClimbController, type ClimbController } from "@floor-fifty/shared/level/steering";
import { ColyseusNetworkManager } from "../../../apps/client/src/features/net/colyseus-network";
import type { InputIntent } from "../../../apps/client/src/features/platform/input";
import {
  NetDiagnostics,
  type NetSummary,
} from "../../../apps/client/src/features/net/net-diagnostics";
import { RaceNetcode } from "../../../apps/client/src/features/net/race-netcode";
import { snapshotToRaceState } from "../../../apps/client/src/features/net/snapshot-to-race";
import { createColyseusRaceServer } from "../../../apps/server/src/colyseus-server";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import type { RaceRoom } from "../../../apps/server/src/rooms/race-room";
import type { RoomTelemetrySummary } from "../../../apps/server/src/rooms/room-telemetry";
import { startLatencyProxy, type LatencyProxy, type LinkProfile } from "./latency-proxy";

export type LabOptions = {
  profile: LinkProfile;
  racers?: number;
  /** Racing time recorded, after the countdown. */
  raceSeconds?: number;
  seed?: number;
  /** The display's refresh interval. 60 Hz unless a run asks otherwise. */
  frameMs?: number;
};

type Truth = { x: number; y: number; vx: number; vy: number; sequence: number };

/** One tick where the client's racer and authority's disagreed, with what each held. */
export type Divergence = {
  tick: number;
  error: number;
  client: { x: number; y: number };
  server: { x: number; y: number; vx: number; vy: number };
  /** The sequence authority had in force on that tick. */
  serverSequence: number;
  /** The newest sequence the client had stamped at or before that tick. */
  clientSequence: number | undefined;
};

/** A server step slow enough to capture, with the state it started from. */
export type SlowStep = { tick: number; ms: number; state: string; inputs: string };

type FrameRecord = {
  /** The prediction's tick and its raw simulated position, before smoothing. */
  predictedTick: number | undefined;
  raw: { x: number; y: number; vx: number } | undefined;
  /**
   * Where the local racer was drawn this frame, at the newest tick. The frame
   * blends it with the tick before, which is presentation rather than
   * correction, so it is left out and the offset measured is the correction alone.
   */
  drawn: { x: number; y: number } | undefined;
  /** The render clock's moment, and every remote racer as drawn at it. */
  renderTick: number;
  remotes: { id: PlayerId; x: number; y: number }[];
  /** The horizontal direction held for this frame, and whether it changed on it. */
  direction: -1 | 0 | 1;
  intentChanged: boolean;
};

export type RacerReport = {
  name: string;
  frames: number;
  /** |predicted(T) - authority(T)| for the local racer, per frame. */
  misprediction: DistributionSummary;
  /** How far the drawn racer sat from the simulated one: the smoothing on screen. */
  drawnOffset: DistributionSummary;
  /** |drawn - authority| for remote racers at the render moment. */
  remoteError: DistributionSummary;
  /** Frames between an intent change and the simulated racer's velocity answering it. */
  responseFrames: DistributionSummary;
  /**
   * Server's first tick for each input minus the client's first tick for it.
   * Zero is "as if local": both sides applied the same intent on the same tick.
   */
  inputTickSkew: DistributionSummary;
  inputsSent: number;
  floorsReached: number;
  /** The first divergences over a unit, for diagnosis. */
  divergences: Divergence[];
  client: NetSummary;
};

export type LabReport = {
  profile: LinkProfile;
  seed: number;
  racingTicks: number;
  server: RoomTelemetrySummary;
  racers: RacerReport[];
  proxyBytes: { up: number; down: number };
  /** How late the lab's own frame timer ran: host load, not the game. */
  hostLagMs: DistributionSummary;
  /** Every anomaly line the room logged during the run. */
  serverAnomalies: string[];
  /** Server steps over 20 ms, with the state each began from. */
  slowSteps: SlowStep[];
};

const NEUTRAL: InputIntent = { left: false, right: false, fastFall: false, reset: false };

const sameIntent = (a: InputIntent, b: InputIntent): boolean =>
  a.left === b.left && a.right === b.right && a.fastFall === b.fastFall && a.reset === b.reset;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(shortestWrappedOffset(a.x, b.x, VIEWPORT.width), b.y - a.y);

/** One headless client: the network port, the race's netcode, and a controller's hands. */
class HeadlessRacer {
  readonly network: ColyseusNetworkManager;
  readonly diagnostics = new NetDiagnostics();
  netcode: RaceNetcode | undefined;
  readonly records: FrameRecord[] = [];
  private tuning: RoomSnapshot["tuning"] | undefined;
  private controller: ClimbController | undefined;
  private held: InputIntent = NEUTRAL;
  private sent = 0;
  /** The tick each sequence was stamped for, which is when the prediction applies it. */
  readonly appliedFrom = new Map<number, number>();
  private release: (() => void) | undefined;

  constructor(
    readonly name: string,
    url: string,
  ) {
    this.network = new ColyseusNetworkManager(url);
  }

  get localId(): PlayerId | undefined {
    const id = this.network.localPlayerId;
    return id === undefined ? undefined : asPlayerId(id);
  }

  get inputsSent(): number {
    return this.sent;
  }

  /** Listens the way the gameplay screen does: the race mounts on its first racing snapshot. */
  listen(): void {
    this.release = this.network.subscribe({
      onSnapshot: (snapshot) => {
        if (this.netcode === undefined) {
          if (snapshot.phase !== "racing") return;
          this.tuning = snapshot.tuning;
          const roundTripMs = this.network.roundTripMs();
          this.netcode = new RaceNetcode({
            tuning: snapshot.tuning,
            diagnostics: this.diagnostics,
            send: (frame) => {
              this.network.sendInput(frame);
              this.sent += 1;
              this.appliedFrom.set(frame.sequence, frame.tick);
            },
            ping: (tick) => this.network.sendPing(tick),
            now: () => performance.now(),
            ...(roundTripMs === undefined ? {} : { roundTripMs }),
          });
        }
        this.netcode.observe(snapshot, this.localId);
      },
      onPong: (pong) => this.netcode?.pong(pong.id, pong.rttMs, pong.slack),
    });
  }

  /** The race as this client can see it: its prediction, or else its sample. */
  private picture(): Readonly<RaceState> | undefined {
    const localId = this.localId;
    if (this.netcode === undefined || localId === undefined || this.tuning === undefined) {
      return undefined;
    }
    const predicted = this.netcode.predictedRace();
    if (predicted !== undefined) return predicted;
    const sample = this.netcode.sample();
    return sample === undefined ? undefined : snapshotToRaceState(sample, localId, this.tuning);
  }

  /** One rendered frame: decide from the last picture, let the race sample it, record. */
  frame(deltaMs: number): void {
    const localId = this.localId;
    if (this.netcode === undefined || localId === undefined) return;

    let intentChanged = false;
    const picture = this.picture();
    if (picture !== undefined && picture.phase === "racing") {
      this.controller ??= createClimbController(localId);
      const wanted = this.controller.next(picture as RaceState, 0);
      if (wanted !== undefined) {
        const intent: InputIntent = {
          left: wanted.left,
          right: wanted.right,
          fastFall: wanted.fastFall,
          reset: wanted.reset,
        };
        intentChanged = !sameIntent(intent, this.held);
        this.held = intent;
      }
    }

    // A reset is a press, handed to exactly one sampled tick.
    let pressed = this.held.reset;
    const result = this.netcode.frame(() => {
      const sampled = { ...this.held, reset: pressed };
      pressed = false;
      return sampled;
    }, deltaMs);
    if (result === undefined) return;
    const race = this.netcode.predictedRace();
    const simulated = race?.players[localId];
    const drawn = this.netcode.predicted();
    this.records.push({
      predictedTick: race?.tick,
      raw:
        simulated === undefined
          ? undefined
          : { x: simulated.x, y: simulated.y, vx: simulated.vx },
      drawn: drawn === undefined ? undefined : { x: drawn.x, y: drawn.y },
      renderTick: this.netcode.renderTick() ?? result.sample.tick,
      remotes: result.sample.players
        .filter((player) => player.id !== localId)
        .map((player) => ({ id: player.id, x: player.x, y: player.y })),
      direction: this.held.right ? 1 : this.held.left ? -1 : 0,
      intentChanged,
    });
  }

  async close(): Promise<void> {
    this.release?.();
    this.netcode?.clear();
    await this.network.leaveRoom().catch(() => undefined);
    this.network.dispose();
  }
}

/** Waits for a condition, polling, or fails with the message. */
async function until(condition: () => boolean, message: string, timeoutMs = 15_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Authority at a fractional tick, interpolated the way the buffer would. */
function truthAt(
  history: ReadonlyMap<number, ReadonlyMap<PlayerId, Truth>>,
  id: PlayerId,
  tick: number,
): { x: number; y: number } | undefined {
  const lower = history.get(Math.floor(tick))?.get(id);
  const upper = history.get(Math.ceil(tick))?.get(id);
  if (lower === undefined || upper === undefined) return undefined;
  const t = tick - Math.floor(tick);
  const dx = shortestWrappedOffset(lower.x, upper.x, VIEWPORT.width);
  return { x: lower.x + dx * t, y: lower.y + (upper.y - lower.y) * t };
}

export async function runNetLab(options: LabOptions): Promise<LabReport> {
  const racerCount = options.racers ?? 4;
  const raceSeconds = options.raceSeconds ?? 12;
  const seed = options.seed ?? 13;
  const frameMs = options.frameMs ?? 1000 / 60;

  const server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    fixedSeed: seed,
    telemetry: { log: (line) => anomalies.push(line) },
  });
  const proxies: LatencyProxy[] = [];
  const racers: HeadlessRacer[] = [];
  const history = new Map<number, Map<PlayerId, Truth>>();
  /** The first server tick each (player, sequence) was in force on. */
  const serverApplied = new Map<string, number>();
  const anomalies: string[] = [];
  const slowSteps: SlowStep[] = [];
  const hostLag = new Distribution(4096);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let room: RaceRoom | undefined;

  try {
    for (let index = 0; index < racerCount; index += 1) {
      const proxy = await startLatencyProxy(
        { host: "127.0.0.1", port: server.port },
        options.profile,
        seed * 31 + index,
      );
      proxies.push(proxy);
      racers.push(new HeadlessRacer(`racer-${index + 1}`, `http://127.0.0.1:${proxy.port}`));
    }

    const [host, ...guests] = racers as [HeadlessRacer, ...HeadlessRacer[]];
    for (const racer of racers) racer.listen();
    await host.network.createRoom(host.name);
    await until(() => host.network.roomCode !== undefined, "the host was never seated");
    const code = host.network.roomCode!;
    for (const guest of guests) {
      await guest.network.joinRoom(code, guest.name);
      await until(() => guest.network.roomCode !== undefined, `${guest.name} was never seated`);
    }

    room = matchMaker.getLocalRoomById(code) as RaceRoom | undefined;
    if (room === undefined) throw new Error("the lab could not find its own room");
    const measured = room;
    // Authority, tick by tick, recorded as the room decides it.
    const stepOnce = measured.stepOnce.bind(measured);
    measured.stepOnce = () => {
      stepOnce();
      const state = measured.raceState;
      if (state.phase !== "racing" && state.phase !== "finished") return;
      for (const player of Object.values(state.players)) {
        const key = `${player.id}#${player.lastSequence}`;
        if (!serverApplied.has(key)) serverApplied.set(key, state.tick);
      }
      history.set(
        state.tick,
        new Map(
          Object.values(state.players).map((player) => [
            player.id,
            {
              x: player.x,
              y: player.y,
              vx: player.vx,
              vy: player.vy,
              sequence: player.lastSequence,
            },
          ]),
        ),
      );
    };

    // Slow steps, caught with the state they began from so they can be replayed.
    const simulationHost = measured as unknown as {
      simulation: { step: (state: RaceState, inputs: ReadonlyMap<PlayerId, unknown>) => unknown };
    };
    const originalStep = simulationHost.simulation.step.bind(simulationHost.simulation);
    simulationHost.simulation.step = (state, inputs) => {
      const started = performance.now();
      const result = originalStep(state, inputs);
      const ms = performance.now() - started;
      if (ms > 20 && slowSteps.length < 5) {
        slowSteps.push({
          tick: state.tick,
          ms,
          state: JSON.stringify(state),
          inputs: JSON.stringify([...inputs]),
        });
      }
      return result;
    };

    // Every client draws from the moment it joins, as a browser would.
    let lastFrame = performance.now();
    let due = lastFrame + frameMs;
    const loop = (): void => {
      const now = performance.now();
      hostLag.add(Math.max(0, now - due));
      const delta = now - lastFrame;
      lastFrame = now;
      for (const racer of racers) racer.frame(delta);
      due += frameMs;
      if (due < now) due = now + frameMs;
      timer = setTimeout(loop, Math.max(0, due - performance.now()));
    };
    timer = setTimeout(loop, frameMs);

    for (const racer of racers) await racer.network.setReady(true);
    await until(() => measured.raceState.phase === "racing", "the race never started", 10_000);
    const startedAt = measured.raceState.raceStartedAtTick ?? measured.raceState.tick;

    await new Promise((resolve) => setTimeout(resolve, raceSeconds * 1000));
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;

    const finalState = measured.raceState;
    const racingTicks = finalState.tick - startedAt;

    const reports = racers.map((racer): RacerReport => {
      const localId = racer.localId!;
      const misprediction = new Distribution(1 << 16);
      const drawnOffset = new Distribution(1 << 16);
      const remoteError = new Distribution(1 << 16);
      const response = new Distribution(4096);
      const skew = new Distribution(4096);
      for (const [sequence, clientTick] of racer.appliedFrom) {
        const serverTick = serverApplied.get(`${localId}#${sequence}`);
        if (serverTick !== undefined) skew.add(serverTick - clientTick);
      }

      const divergences: Divergence[] = [];
      const stamped = [...racer.appliedFrom].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      let pendingResponse: { frame: number; direction: number } | undefined;
      racer.records.forEach((record, index) => {
        if (record.raw !== undefined && record.predictedTick !== undefined) {
          const tick = record.predictedTick;
          const truth = history.get(tick)?.get(localId);
          if (truth !== undefined) {
            const error = distance(record.raw, truth);
            misprediction.add(error);
            if (error > 1 && divergences.length < 12) {
              let clientSequence: number | undefined;
              for (const [sequence, at] of stamped) if (at <= tick) clientSequence = sequence;
              divergences.push({
                tick,
                error,
                client: { x: record.raw.x, y: record.raw.y },
                server: { x: truth.x, y: truth.y, vx: truth.vx, vy: truth.vy },
                serverSequence: truth.sequence,
                clientSequence,
              });
            }
          }
        }
        if (record.raw !== undefined && record.drawn !== undefined) {
          drawnOffset.add(distance(record.raw, record.drawn));
        }
        for (const remote of record.remotes) {
          const truth = truthAt(history, remote.id, record.renderTick);
          if (truth !== undefined) remoteError.add(distance(remote, truth));
        }
        // Responsiveness: after the held direction changes, how many frames
        // until the racer this client simulates is moving that way. Zero is
        // the frame the key changed on, which is what a local game gives.
        if (record.intentChanged) pendingResponse = { frame: index, direction: record.direction };
        if (pendingResponse !== undefined && record.raw !== undefined) {
          if (Math.sign(record.raw.vx) === pendingResponse.direction) {
            response.add(index - pendingResponse.frame);
            pendingResponse = undefined;
          } else if (index - pendingResponse.frame > 120) {
            pendingResponse = undefined;
          }
        }
      });

      const player = finalState.players[localId];
      return {
        name: racer.name,
        frames: racer.records.length,
        misprediction: misprediction.summary(),
        drawnOffset: drawnOffset.summary(),
        remoteError: remoteError.summary(),
        responseFrames: response.summary(),
        inputTickSkew: skew.summary(),
        divergences,
        inputsSent: racer.inputsSent,
        floorsReached:
          player === undefined
            ? 0
            : (player.lap - 1) * finalState.course.floorCount + player.visitedFloorIds.length,
        client: racer.diagnostics.summary(),
      };
    });

    return {
      profile: options.profile,
      seed,
      racingTicks,
      server: measured.telemetry.summary(),
      racers: reports,
      proxyBytes: {
        up: proxies.reduce((total, proxy) => total + proxy.bytesUp, 0),
        down: proxies.reduce((total, proxy) => total + proxy.bytesDown, 0),
      },
      hostLagMs: hostLag.summary(),
      serverAnomalies: anomalies,
      slowSteps,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    for (const racer of racers) await racer.close();
    for (const proxy of proxies) await proxy.close();
    await server.close();
  }
}

const f = (value: number, digits = 1): string => value.toFixed(digits);

/** The report as the table a person reads. */
export function formatLabReport(report: LabReport): string {
  const { server } = report;
  const lines = [
    `== ${report.profile.name}: up ${report.profile.upMs}ms down ${report.profile.downMs}ms ` +
      `jitter ±${report.profile.jitterMs}ms` +
      (report.profile.stallEveryMs === undefined
        ? ""
        : ` stall ${report.profile.stallMs}ms/${report.profile.stallEveryMs}ms`) +
      ` | ${report.racingTicks} racing ticks, host lag p99 ${f(report.hostLagMs.p99)}ms`,
    `server ${f(server.tickRateHz, 2)} Hz, interval p50 ${f(server.tickIntervalMs.p50)} p99 ${f(server.tickIntervalMs.p99)} ` +
      `max ${f(server.tickIntervalMs.lifetimeMax)}ms, per-callback max ${server.ticksPerCallback.lifetimeMax}, ` +
      `tick p99 ${f(server.tickMs.p99, 2)}ms (step ${f(server.stepMs.p99, 2)}), ` +
      `patch every p50 ${f(server.patchIntervalMs.p50)} p99 ${f(server.patchIntervalMs.p99)}ms, ` +
      `inputs ${server.inputs.accepted} ok ${server.inputs.late} late, slack p10..p90 ` +
      `${f(server.slackTicks.min)}..${f(server.slackTicks.p90)}`,
    `wire: up ${f(report.proxyBytes.up / 1024)} KiB, down ${f(report.proxyBytes.down / 1024)} KiB`,
    ...report.serverAnomalies.map((line) => `  server: ${line}`),
    "racer     mispredict p50/p99/max   drawn-offset p99/max   remote-err p50/p99   " +
      "resp p50/max  skew min/p50/max  sent  floors  clock-err p99  underrun%  replay p50 (ms p99)",
  ];
  for (const racer of report.racers) {
    const c = racer.client;
    const underrun = c.buffer.frames === 0 ? 0 : (c.buffer.underruns / c.buffer.frames) * 100;
    lines.push(
      `${racer.name.padEnd(9)} ` +
        `${f(racer.misprediction.p50, 2)}/${f(racer.misprediction.p99, 2)}/${f(racer.misprediction.lifetimeMax)}`.padEnd(25) +
        `${f(racer.drawnOffset.p99, 2)}/${f(racer.drawnOffset.lifetimeMax)}`.padEnd(23) +
        `${f(racer.remoteError.p50, 2)}/${f(racer.remoteError.p99, 2)}`.padEnd(21) +
        `${f(racer.responseFrames.p50, 0)}/${f(racer.responseFrames.lifetimeMax, 0)}`.padEnd(14) +
        `${f(racer.inputTickSkew.min, 0)}/${f(racer.inputTickSkew.p50, 0)}/${f(racer.inputTickSkew.max, 0)}`.padEnd(17) +
        `${String(racer.inputsSent).padEnd(6)}${String(racer.floorsReached).padEnd(8)}` +
        `${f(c.clock.errorTicks.p99, 2)}`.padEnd(15) +
        `${f(underrun)}`.padEnd(11) +
        `${f(c.prediction.replayTicks.p50, 0)} (${f(c.prediction.replayMs.p99, 2)})`,
    );
  }
  return lines.join("\n");
}
