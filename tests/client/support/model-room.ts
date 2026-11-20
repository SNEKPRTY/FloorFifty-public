/**
 * A race room on virtual time, for the netcode model test.
 *
 * Everything that decides the outcome is real: the room's own input queue,
 * the shared simulation, and the client's `RaceNetcode` exactly as the
 * gameplay screen runs it. What is modelled is only what sits between them --
 * a link with a latency and a seeded jitter that, like TCP, never reorders --
 * and time itself, which advances in events rather than in wall-clock
 * milliseconds so a twenty-second race runs in well under a second and gives
 * the same answer every time.
 *
 * The real-socket lab (`pnpm netlab`) asks the same question of the real
 * transport. This is the version that can run on every commit.
 */

import { TICK_MS, VIEWPORT } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type LapCount, type PlayerId } from "@floor-fifty/shared/common/ids";
import { shortestWrappedOffset } from "@floor-fifty/shared/common/math";
import type { InputFrame, RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { createRaceState, floorX, type RaceState } from "@floor-fifty/shared/common/state";
import { floorShifts } from "@floor-fifty/shared/simulation/planck/consequences";
import { Distribution, type DistributionSummary } from "@floor-fifty/shared/common/telemetry";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { InputQueue } from "../../../apps/server/src/rooms/input-queue";
import type { InputIntent } from "../../../apps/client/src/features/platform/input";
import { NetDiagnostics } from "../../../apps/client/src/features/net/net-diagnostics";
import { RaceNetcode } from "../../../apps/client/src/features/net/race-netcode";
import { snapshotToRaceState } from "../../../apps/client/src/features/net/snapshot-to-race";
import { stateToSnapshot } from "./snapshots";

export type ModelLink = {
  /** One-way latency, milliseconds. */
  upMs: number;
  downMs: number;
  /** Each message is delayed a further uniform `[-jitterMs, +jitterMs]`, never reordered. */
  jitterMs: number;
  seed?: number;
};

export type ModelOptions = {
  link: ModelLink;
  seconds?: number;
  /** Rendered frame interval; 60 Hz by default. */
  frameMs?: number;
  /** Replaces the bot's intent on a frame, for scripted presses. */
  script?: (frame: number, intent: InputIntent) => InputIntent;
  /**
   * The round trip the lobby measured, as the real client knows it before a
   * race. The link's own by default; `null` models a client that knew nothing.
   */
  roundTripMs?: number | null;
  /** Laps in the race; one by default. */
  lapCount?: LapCount;
  /** Tuning over the authored defaults, as a mode would set it. */
  tuning?: Parameters<typeof resolveTuning>[0];
  /** Rearranges the room before the first tick, for a racer placed by hand. */
  start?: (race: RaceState) => RaceState;
};

export type ModelReport = {
  /** After the first two seconds, once the lead has heard the room. */
  misprediction: DistributionSummary;
  /** Over the whole race, the first round trip included. */
  wholeRaceMisprediction: DistributionSummary;
  drawnOffset: DistributionSummary;
  /** Snapshots whose floors differed from the one before: an endless window moved (race-options spec §8). */
  windowChanges: number;
  /** Misprediction over the six ticks after each window change, once the lead has warmed up. */
  windowChangeMisprediction: DistributionSummary;
  late: number;
  accepted: number;
  floors: number;
  /** Ticks on which the room reset the racer, and on which the client predicted it. */
  serverResets: number[];
  predictedResets: number[];
  /** Laps the room saw the racer complete. */
  laps: number;
  /** Room ticks on which a moving floor carried the racer. */
  carriedTicks: number;
  leadTicks: number;
  client: ReturnType<NetDiagnostics["summary"]>;
  /** The room's course height when the run ended; an endless course grows (race-options spec §5.3). */
  finalFloorCount: number;
};

const LOCAL = asPlayerId("model-p1");
const PATCH_EVERY_TICKS = 3;
/** Two seconds: the lead has heard several pongs by then on any modelled link. */
const WARM_UP_TICKS = 120;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Event = { at: number; order: number; run: () => void };

export function runModelRace(options: ModelOptions): ModelReport {
  const { link } = options;
  const random = seeded(link.seed ?? 7);
  const frameMs = options.frameMs ?? 1000 / 60;
  const endMs = (options.seconds ?? 20) * 1000;
  const tuning = resolveTuning(options.tuning);

  // --- the room ---------------------------------------------------------
  let race: RaceState = {
    ...createRaceState({
      seed: 4182,
      lapCount: options.lapCount ?? 1,
      tuning,
      players: [{ id: LOCAL, name: asPlayerName("Model") }],
    }),
    phase: "racing",
    raceStartedAtTick: 0,
  };
  if (options.start !== undefined) race = options.start(race);
  let laps = 0;
  let carriedTicks = 0;
  const simulation = createRaceSimulation(race);
  const queue = new InputQueue();
  const history = new Map<number, { x: number; y: number }>();
  const serverResets: number[] = [];
  let pendingEvents: RaceEvent[] = [];
  let lastStepAt = 0;
  let late = 0;
  let accepted = 0;

  // --- the event loop -------------------------------------------------------
  const events: Event[] = [];
  let order = 0;
  let now = 0;
  const at = (time: number, run: () => void): void => {
    events.push({ at: time, order: (order += 1), run });
  };
  /** A one-way link that delays and jitters but never reorders. */
  const channel = (baseMs: number) => {
    let last = 0;
    return (run: () => void): void => {
      const delay = Math.max(0, baseMs + (random() * 2 - 1) * link.jitterMs);
      last = Math.max(now + delay, last);
      at(last, run);
    };
  };
  const up = channel(link.upMs);
  const down = channel(link.downMs);

  // --- the client -----------------------------------------------------------
  const diagnostics = new NetDiagnostics();
  const pingsSent = new Map<number, number>();
  let pingId = 0;
  const knownRoundTrip =
    options.roundTripMs === null ? undefined : (options.roundTripMs ?? link.upMs + link.downMs);
  const netcode = new RaceNetcode({
    tuning,
    diagnostics,
    now: () => now,
    ...(knownRoundTrip === undefined ? {} : { roundTripMs: knownRoundTrip }),
    send: (frame: InputFrame) =>
      up(() => {
        const result = queue.submit(LOCAL, frame, race.tick);
        if (result.ok && result.slack < 0) late += 1;
        else if (result.ok) accepted += 1;
      }),
    ping: (tick: number) => {
      pingId += 1;
      const id = pingId;
      pingsSent.set(id, now);
      up(() => {
        const since = Math.min(1, Math.max(0, (now - lastStepAt) / TICK_MS));
        const slack = tick - (race.tick + since);
        down(() => {
          const sentAt = pingsSent.get(id);
          if (sentAt === undefined) return;
          pingsSent.delete(id);
          netcode.pong(id, now - sentAt, slack);
        });
      });
      return id;
    },
  });
  const controller = createClimbController(LOCAL);
  const misprediction = new Distribution(1 << 16);
  const wholeRace = new Distribution(1 << 16);
  const drawnOffset = new Distribution(1 << 16);
  const predictedRecords: { tick: number; x: number; y: number }[] = [];
  const predictedResets: number[] = [];
  let lastFloors: string | undefined;
  const windowChangeTicks: number[] = [];

  // --- schedules ------------------------------------------------------------
  const serverTick = (): void => {
    lastStepAt = now;
    race = { ...race, tick: race.tick + 1 };
    const inputs = queue.take(race.tick);
    const before = race;
    const result = simulation.step(race, inputs);
    race = result.state;
    const was = before.players[LOCAL]!;
    const now_ = race.players[LOCAL]!;
    const shifts = floorShifts(before, race);
    if (now_.vx === 0 && [...shifts.values()].some((shift) => shift !== 0 && Math.abs(now_.x - was.x - shift) < 1e-9)) {
      carriedTicks += 1;
    }
    laps += result.events.filter((event) => event.type === "lapCompleted").length;
    pendingEvents.push(...result.events);
    for (const event of result.events) {
      if (event.type === "playerReset" && event.reason === "manual") serverResets.push(event.tick);
    }
    const player = race.players[LOCAL]!;
    history.set(race.tick, { x: player.x, y: player.y });
    if (race.tick % PATCH_EVERY_TICKS === 0) {
      const snapshot: RoomSnapshot = stateToSnapshot(race, pendingEvents);
      pendingEvents = [];
      const floors = snapshot.platforms.map((platform) => platform.id).join(",");
      if (lastFloors !== undefined && floors !== lastFloors) windowChangeTicks.push(snapshot.tick);
      lastFloors = floors;
      down(() => netcode.observe(snapshot, LOCAL));
    }
    // The room's clock runs on after a finish, as a real room's does.
    at(now + TICK_MS, serverTick);
  };

  let frameIndex = 0;
  let intent: InputIntent = { left: false, right: false, fastFall: false, reset: false };
  const clientFrame = (): void => {
    // Decide from the picture the last frame drew, as a player does.
    const picture =
      netcode.predictedRace() ??
      (() => {
        const sample = netcode.sample();
        return sample === undefined ? undefined : snapshotToRaceState(sample, LOCAL, tuning);
      })();
    if (picture !== undefined) {
      const wanted = controller.next(picture as RaceState, frameIndex);
      if (wanted !== undefined) {
        intent = { left: wanted.left, right: wanted.right, fastFall: wanted.fastFall, reset: wanted.reset };
      }
    }
    const held = options.script?.(frameIndex, intent) ?? intent;
    let consumed = false;
    netcode.frame(() => {
      // A press belongs to one tick, however many this frame samples.
      const sampled = consumed ? { ...held, reset: false } : held;
      consumed = true;
      return sampled;
    }, frameMs);

    for (const event of netcode.drainPredictedEvents()) {
      if (event.type === "playerReset" && event.reason === "manual") predictedResets.push(event.tick);
    }
    const raw = netcode.predictedRace()?.players[LOCAL];
    const tick = netcode.predictedRace()?.tick;
    const drawn = netcode.predicted();
    if (raw !== undefined && tick !== undefined) {
      predictedRecords.push({ tick, x: raw.x, y: raw.y });
      if (drawn !== undefined) {
        drawnOffset.add(
          Math.hypot(shortestWrappedOffset(raw.x, drawn.x, VIEWPORT.width), drawn.y - raw.y),
        );
      }
    }
    frameIndex += 1;
    at(now + frameMs, clientFrame);
  };

  at(TICK_MS, serverTick);
  // The client's frames start at an arbitrary phase against the room's ticks.
  at(frameMs * 0.37, clientFrame);

  while (events.length > 0) {
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    const next = events.shift()!;
    if (next.at > endMs) break;
    now = next.at;
    next.run();
  }

  for (const record of predictedRecords) {
    const truth = history.get(record.tick);
    if (truth === undefined) continue;
    const error = Math.hypot(
      shortestWrappedOffset(record.x, truth.x, VIEWPORT.width),
      truth.y - record.y,
    );
    wholeRace.add(error);
    if (record.tick > WARM_UP_TICKS) misprediction.add(error);
  }

  const windowChange = new Distribution(1 << 16);
  for (const record of predictedRecords) {
    if (record.tick <= WARM_UP_TICKS) continue;
    if (!windowChangeTicks.some((tick) => record.tick >= tick && record.tick < tick + PATCH_EVERY_TICKS * 2)) continue;
    const truth = history.get(record.tick);
    if (truth === undefined) continue;
    windowChange.add(Math.hypot(shortestWrappedOffset(record.x, truth.x, VIEWPORT.width), truth.y - record.y));
  }

  const player = race.players[LOCAL]!;
  netcode.clear();
  simulation.dispose();
  return {
    misprediction: misprediction.summary(),
    wholeRaceMisprediction: wholeRace.summary(),
    drawnOffset: drawnOffset.summary(),
    windowChanges: windowChangeTicks.length,
    windowChangeMisprediction: windowChange.summary(),
    late,
    accepted,
    floors: (player.lap - 1) * race.course.floorCount + player.visitedFloorIds.length,
    serverResets,
    predictedResets,
    laps,
    carriedTicks,
    leadTicks: netcode.leadTicks,
    client: diagnostics.summary(),
    finalFloorCount: race.course.floorCount,
  };
}

export { LOCAL as MODEL_PLAYER };
export type { PlayerId };

/**
 * Stands the racer on the course's first moving floor, a pixel above its top,
 * so a held fast fall pins it there and the floor carries it.
 */
export function standOnMovingFloor(race: RaceState): RaceState {
  const floor = race.course.floors.find((candidate) => candidate.kind === "moving");
  if (floor === undefined) throw new Error("the model course has no moving floor");
  const player = race.players[LOCAL]!;
  const top = floor.y + race.tuning.FLOOR_HEIGHT / 2;
  return {
    ...race,
    players: {
      [LOCAL]: {
        ...player,
        x: floorX(race, floor),
        y: top + race.tuning.PLAYER_HEIGHT / 2 + 1,
        vx: 0,
        vy: 0,
        awaitingInput: false,
        visitedFloorIds: race.course.floors.filter((f) => f.index <= floor.index).map((f) => f.id),
      },
    },
  };
}
