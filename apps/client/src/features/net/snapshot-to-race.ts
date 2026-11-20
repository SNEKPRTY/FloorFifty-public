/**
 * The inverse of the server's projection.
 *
 * `toRoomSnapshot` flattens a race into what a client renders; this rebuilds
 * the part of it a client simulates. It lives here rather than in the shared
 * package because only a client needs it, and it reconstructs one player
 * rather than the room: no simulation rule reads one player from another, so
 * the local sprite's future does not depend on anybody else's.
 *
 * What it does not rebuild is as deliberate as what it does. Standings, the
 * winner and the lap are authority's answers and are read from the snapshot
 * wherever they are drawn; a value this function produces is only ever used to
 * decide where to draw one sprite.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerName } from "@floor-fifty/shared/common/ids";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { MovingFloorState, PlayerState, RaceState } from "@floor-fifty/shared/common/state";
import { createMovingFloorStates } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { Course } from "@floor-fifty/shared/level/course";
import { createCourse, extendCourse } from "@floor-fifty/shared/level/course";
import { isEndless } from "@floor-fifty/shared/simulation/endless";

/**
 * One course per seed.
 *
 * Generation is pure and cheap, but a snapshot arrives twenty times a second
 * and the course is immutable, so regenerating it per snapshot would allocate
 * a new one for every packet and defeat identity comparisons.
 */
let cached: { seed: number; tuning: ResolvedTuning; course: Course } | undefined;

export function courseFor(seed: number, tuning: ResolvedTuning, floorCount: number): Course {
  if (cached === undefined || cached.seed !== seed || cached.tuning !== tuning) {
    cached = { seed, tuning, course: createCourse(seed, tuning) };
  }
  // An endless course is as tall as the room has grown it (race-options spec
  // §5.4); the generator is prefix-stable, so growing the copy is enough.
  if (cached.course.floorCount < floorCount) {
    cached = { ...cached, course: extendCourse(cached.course, tuning, floorCount - 1) };
  }
  return cached.course;
}

/**
 * The floors the local racer has collected this ascent, as far as the
 * snapshot can say. An endless snapshot carries only its window (race-options
 * spec §5.4), so a floor below it is counted as collected: no racer can touch
 * it before the next reconcile, and a racer who fell is back at floor 0, where
 * the window reaches the bottom again and nothing lies below it.
 */
function visitedFrom(snapshot: RoomSnapshot, localId: PlayerId, course: Course, tuning: ResolvedTuning): string[] {
  const collected = snapshot.platforms
    .filter((platform) => platform.collectedBy.includes(localId))
    .map((platform) => platform.id);
  if (!isEndless(tuning) || snapshot.platforms.length === 0) return collected;
  const shown = new Set(snapshot.platforms.map((platform) => platform.id));
  const lowest = course.floors.find((floor) => shown.has(floor.id))?.index ?? 0;
  return [...course.floors.slice(0, lowest).map((floor) => floor.id), ...collected];
}

export function snapshotToRaceState(
  snapshot: RoomSnapshot,
  localId: PlayerId,
  tuning: ResolvedTuning,
): RaceState | undefined {
  const local = snapshot.players.find((player) => player.id === localId);
  if (local === undefined) return undefined;

  const course = courseFor(snapshot.seed, tuning, snapshot.floorCount);

  // Start from the generator's own phase, then adopt the live one. Speed is
  // the seed's and never travels; position and direction are the race's.
  // An endless course's snapshot carries only its window: a moving floor
  // outside it keeps its generated x here. It has no body until it enters the
  // window, at least six floors from any racer, so it cannot touch the
  // predicted racer before the next reconcile brings its true position.
  const movingFloors: Record<string, MovingFloorState> = createMovingFloorStates(course);
  for (const platform of snapshot.platforms) {
    const floor = movingFloors[platform.id];
    if (floor === undefined) continue;
    floor.x = platform.x;
    floor.direction = platform.direction;
  }

  const player: PlayerState = {
    id: local.id,
    name: asPlayerName(local.name),
    characterId: local.characterId,
    colour: local.colour,
    deviceClass: local.deviceClass,
    cpu: local.cpu,
    x: local.x,
    y: local.y,
    vx: local.vx,
    vy: local.vy,
    facingRight: local.facingRight,
    grounded: local.grounded,
    awaitingInput: local.awaitingInput,
    lap: local.lap,
    visitedFloorIds: visitedFrom(snapshot, localId, course, tuning),
    bestFloor: local.bestFloor,
    floorEdgeY: local.floorEdgeY,
    ...(local.outAtTick === undefined ? {} : { outAtTick: local.outAtTick }),
    ...(local.edgeWaitTicks === undefined ? {} : { edgeWaitTicks: local.edgeWaitTicks }),
    ...(local.bestFloorAtTick === undefined ? {} : { bestFloorAtTick: local.bestFloorAtTick }),
    ready: local.ready,
    status: local.status,
    lastSequence: local.lastAckedSequence,
    ...(local.finishedAtTick === undefined ? {} : { finishedAtTick: local.finishedAtTick }),
    ...(local.holdUntilTick === undefined ? {} : { holdUntilTick: local.holdUntilTick }),
  };

  return {
    tick: snapshot.tick,
    phase: snapshot.phase,
    seed: snapshot.seed,
    roomSeed: snapshot.roomSeed,
    round: snapshot.round,
    lapCount: snapshot.lapCount,
    modeId: snapshot.modeId,
    clockSeconds: snapshot.clockSeconds,
    tuning,
    course,
    movingFloors,
    freedBelow: 0,
    players: { [localId]: player },
    hostId: snapshot.hostId,
    access: snapshot.access,
    standings: [...snapshot.standings],
    ...(snapshot.countdownEndsAtTick === undefined
      ? {}
      : { countdownEndsAtTick: snapshot.countdownEndsAtTick }),
    ...(snapshot.raceStartedAtTick === undefined
      ? {}
      : { raceStartedAtTick: snapshot.raceStartedAtTick }),
    ...(snapshot.winnerId === undefined ? {} : { winnerId: snapshot.winnerId }),
  };
}
