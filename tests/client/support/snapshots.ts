/**
 * Snapshot fixtures.
 *
 * Builds authority snapshots the way a room would, so a client test never has
 * to hand-construct a shape the server does not actually send.
 */

import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import type {
  PlayerSnapshot,
  PlatformSnapshot,
  RaceEvent,
  RoomPhase,
  RoomSnapshot,
} from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { floorX } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { liveFloors, progressOf } from "@floor-fifty/shared/simulation/endless";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";

/**
 * The content identity a fixture snapshot carries.
 *
 * Every snapshot names the content its room froze, so a fixture has to too.
 * Exported because the client's staleness check compares a snapshot's
 * revision against its own cache, and a test needs both sides to agree.
 */
export const TEST_REVISIONS = {
  contentRevision: asRevision("c".repeat(64)),
  rulesetRevision: asRevision("d".repeat(64)),
} as const;

export const LOCAL_ID = asPlayerId("room-p1");
export const REMOTE_ID = asPlayerId("room-p2");

export function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: LOCAL_ID,
    name: "Kite",
    characterId: "ninja",
    colour: "scarlet",
    deviceClass: "desktop",
    cpu: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    grounded: false,
    awaitingInput: false,
    lastAckedSequence: 0,
    facingRight: true,
    lap: 1,
    progress: 0,
    ready: false,
    status: "connected",
    bestFloor: 0,
    floorEdgeY: -265,
    ...overrides,
  };
}

export function snapshotAt(
  tick: number,
  overrides: Partial<RoomSnapshot> & { player?: Partial<PlayerSnapshot> } = {},
): RoomSnapshot {
  const { player, ...rest } = overrides;
  return {
    tick,
    phase: "racing" as RoomPhase,
    seed: 4182,
    roomSeed: 4182,
    round: 0,
    courseRevision: "",
    tuning: resolveTuning(),
    ...TEST_REVISIONS,
    floorCount: 20,
    lapCount: 1,
    modeId: "floors-20",
    clockSeconds: 180,
    hostId: LOCAL_ID,
    access: "private",
    players: [playerSnapshot(player)],
    platforms: [{ id: "floor-0", x: 0, y: 0, direction: 1, collectedBy: [] }],
    events: [],
    standings: [],
    ...rest,
  };
}

/** A lobby snapshot with `count` seated players. */
export function lobbySnapshot(count: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const players = Array.from({ length: count }, (_unused, index) =>
    playerSnapshot({
      id: asPlayerId(`room-p${index + 1}`),
      name: index === 0 ? "Kite" : `Ninja ${index + 1}`,
      colour: SEAT_COLOURS[index % SEAT_COLOURS.length]!,
    }),
  );
  return { ...snapshotAt(0, { phase: "lobby" }), players, ...overrides };
}

/**
 * Projects a bare race state the way a room's snapshot would.
 *
 * The server projects into Colyseus schema now, so this is a fixture: it lets
 * a client test hand `LocalSimulation` the shape it really receives.
 */
export function stateToSnapshot(
  state: RaceState,
  events: readonly RaceEvent[],
): RoomSnapshot {
  const players: PlayerSnapshot[] = Object.values(state.players).map((player) => ({
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
    ...(player.outAtTick === undefined ? {} : { outAtTick: player.outAtTick }),
    ...(player.edgeWaitTicks === undefined ? {} : { edgeWaitTicks: player.edgeWaitTicks }),
    ...(player.bestFloorAtTick === undefined ? {} : { bestFloorAtTick: player.bestFloorAtTick }),
    ...(player.finishedAtTick === undefined ? {} : { finishedAtTick: player.finishedAtTick }),
    ...(player.holdUntilTick === undefined ? {} : { holdUntilTick: player.holdUntilTick }),
  }));

  const platforms: PlatformSnapshot[] = liveFloors(state).map((floor) => ({
    id: floor.id,
    x: floorX(state, floor),
    y: floor.y,
    direction: state.movingFloors[floor.id]?.direction ?? floor.direction,
    collectedBy: Object.values(state.players)
      .filter((player) => player.visitedFloorIds.includes(floor.id))
      .map((player) => player.id),
  }));

  return {
    tick: state.tick,
    phase: state.phase,
    seed: state.seed,
    roomSeed: state.roomSeed,
    round: state.round,
    courseRevision: "",
    ...(state.stageId === undefined ? {} : { stageId: state.stageId }),
    ...(state.songId === undefined ? {} : { songId: state.songId }),
    tuning: state.tuning,
    contentRevision: TEST_REVISIONS.contentRevision,
    rulesetRevision: TEST_REVISIONS.rulesetRevision,
    floorCount: state.course.floorCount,
    lapCount: state.lapCount,
    modeId: state.modeId,
    clockSeconds: state.clockSeconds,
    hostId: state.hostId,
    access: state.access,
    ...(state.countdownEndsAtTick === undefined
      ? {}
      : { countdownEndsAtTick: state.countdownEndsAtTick }),
    ...(state.raceStartedAtTick === undefined
      ? {}
      : { raceStartedAtTick: state.raceStartedAtTick }),
    players,
    platforms,
    events,
    standings: state.standings as readonly PlayerId[],
    ...(state.winnerId === undefined ? {} : { winnerId: state.winnerId }),
  };
}

