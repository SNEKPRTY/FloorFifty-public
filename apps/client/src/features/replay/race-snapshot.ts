/**
 * A race state as the snapshot a room would broadcast of it, so the replay
 * viewer draws a race stepped on this device exactly as it draws a live one.
 */

import type { RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { RevisionHash } from "@floor-fifty/shared/content/game-content";
import { liveFloors, progressOf } from "@floor-fifty/shared/simulation/endless";

type Revisions = { contentRevision: RevisionHash; rulesetRevision: RevisionHash };

/**
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
    // A race stepped on this device carries no course revision of its own.
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
