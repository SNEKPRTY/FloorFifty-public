/**
 * Authoritative race state, written into the synchronized view.
 *
 * In place, never by replacement. Colyseus patches what changed, and replacing
 * a child schema each tick would send the whole object every time and defeat
 * the entire reason for moving off snapshots. It is also why a player who has
 * left is deleted from the map rather than the map being rebuilt.
 *
 * This is the successor to `toRoomSnapshot`, and it draws the same line.
 * Derived values cross for presentation (`progress`). Simulation state crosses
 * for prediction (velocity, grounding, the input ack, a floor's direction).
 * Authority crosses for neither: standings, the winner and credited floors are
 * decided by the simulation and are never accepted back.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerState, RaceState } from "@floor-fifty/shared/common/state";
import { seedChoiceToWire, type SelectState } from "@floor-fifty/shared/room/select";
import { floorX } from "@floor-fifty/shared/common/state";
import { TUNABLES, type ResolvedTuning, type TunableName } from "@floor-fifty/shared/common/tuning";
import type { GameContent } from "@floor-fifty/shared/content/game-content";
import { liveFloors, progressOf } from "@floor-fifty/shared/simulation/endless";
import { ArraySchema } from "@colyseus/schema";
import {
  ABSENT_ID,
  ABSENT_TICK,
  PlatformStateSchema,
  PlayerStateSchema,
  SelectPickSchema,
  type RaceRoomState,
  type SelectStateSchema,
} from "./race-room-state";

export type SnapshotRevisions = Pick<GameContent, "contentRevision" | "rulesetRevision" | "courseRevisions">;

const TUNABLE_NAMES = Object.keys(TUNABLES) as TunableName[];

/**
 * The tuning each view last carried. A race's tuning is resolved once and
 * frozen (`RaceState.tuning`), so the thirty-odd fields are copied when the
 * object is a new one -- a stage applied, a mode chosen -- and not every tick.
 */
const projectedTuning = new WeakMap<RaceRoomState, ResolvedTuning>();

/** Whether an array already holds exactly these values, in order. */
function holds(target: ArraySchema<string>, values: readonly string[]): boolean {
  if (target.length !== values.length) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (target[index] !== values[index]) return false;
  }
  return true;
}

/** Replaces an array's contents without replacing the array. */
function setStrings(target: ArraySchema<string>, values: readonly string[]): void {
  if (holds(target, values)) return;
  // Colyseus patches array mutations at their own index and `splice` refuses
  // to insert more than it deletes, so a replacement is a delete and a push
  // rather than one splice with both.
  if (target.length > 0) target.splice(0, target.length);
  for (const value of values) target.push(value);
}

export function projectRace(
  target: RaceRoomState,
  state: RaceState,
  revisions: SnapshotRevisions,
): void {
  target.tick = state.tick;
  target.phase = state.phase;
  target.seed = state.seed;
  target.round = state.round;
  target.lapCount = state.lapCount;
  target.modeId = state.modeId;
  target.clockSeconds = state.clockSeconds;
  target.floorCount = state.course.floorCount;
  target.hostId = state.hostId;
  target.access = state.access;
  target.startsAtTick = state.startsAtTick ?? ABSENT_TICK;
  target.soloFromTick = state.soloFromTick ?? ABSENT_TICK;
  target.countdownEndsAtTick = state.countdownEndsAtTick ?? ABSENT_TICK;
  target.raceStartedAtTick = state.raceStartedAtTick ?? ABSENT_TICK;
  target.contentRevision = revisions.contentRevision;
  target.rulesetRevision = revisions.rulesetRevision;
  target.winnerId = state.winnerId ?? ABSENT_ID;
  target.roomSeed = state.roomSeed;
  target.stageId = state.stageId ?? ABSENT_ID;
  target.courseRevision =
    state.stageId === undefined ? ABSENT_ID : (revisions.courseRevisions[state.stageId] ?? ABSENT_ID);
  target.songId = state.songId ?? ABSENT_ID;
  projectSelect(target.select, state.select);

  if (projectedTuning.get(target) !== state.tuning) {
    for (const name of TUNABLE_NAMES) target.tuning[name] = state.tuning[name];
    projectedTuning.set(target, state.tuning);
  }

  const players = Object.values(state.players);
  for (const player of players) {
    let row = target.players.get(player.id);
    if (row === undefined) {
      row = new PlayerStateSchema();
      row.id = player.id;
      target.players.set(player.id, row);
    }
    row.name = player.name;
    row.characterId = player.characterId;
    row.colour = player.colour;
    row.deviceClass = player.deviceClass;
    row.cpu = player.cpu;
    row.x = player.x;
    row.y = player.y;
    row.vx = player.vx;
    row.vy = player.vy;
    row.grounded = player.grounded;
    row.awaitingInput = player.awaitingInput;
    row.facingRight = player.facingRight;
    row.lap = player.lap;
    row.progress = progressOf(state, player);
    row.bestFloor = player.bestFloor;
    row.bestFloorAtTick = player.bestFloorAtTick ?? ABSENT_TICK;
    row.floorEdgeY = player.floorEdgeY;
    row.outAtTick = player.outAtTick ?? ABSENT_TICK;
    row.edgeWaitTicks = player.edgeWaitTicks ?? 0;
    row.ready = player.ready;
    row.status = player.status;
    row.finishedAtTick = player.finishedAtTick ?? ABSENT_TICK;
    row.holdUntilTick = player.holdUntilTick ?? ABSENT_TICK;
    row.lastAckedSequence = player.lastSequence;
  }

  // Every player is in the view now, so a view no larger holds nobody else:
  // the common tick has no leaver to look for.
  if (target.players.size !== players.length) {
    for (const id of [...target.players.keys()]) {
      if (state.players[id as PlayerId] === undefined) target.players.delete(id);
    }
  }

  // An endless course projects its window only (race-options spec §5.4); a
  // platform that left it is deleted below, as a finite course never does.
  const live = liveFloors(state);
  for (const floor of live) {
    let row = target.platforms.get(floor.id);
    if (row === undefined) {
      row = new PlatformStateSchema();
      row.id = floor.id;
      row.index = floor.index;
      target.platforms.set(floor.id, row);
    }
    row.x = floorX(state, floor);
    row.y = floor.y;
    row.direction = state.movingFloors[floor.id]?.direction ?? floor.direction;
    setCollectors(row.collectedBy, players, floor.id);
  }

  // As with players: every live floor is in the view, so only a larger view
  // holds a floor the window has left.
  if (target.platforms.size !== live.length) {
    const liveIds = new Set(live.map((floor) => floor.id));
    for (const id of [...target.platforms.keys()]) {
      if (!liveIds.has(id)) target.platforms.delete(id);
    }
  }

  setStrings(target.standings, state.standings);
}

/**
 * The players who have landed on a floor this ascent, in player order. Compared
 * in place first: a floor's collectors change a few times a race, and building
 * the list for every floor on every tick was most of what a projection allocated.
 */
function setCollectors(target: ArraySchema<string>, players: readonly PlayerState[], floorId: string): void {
  let count = 0;
  let same = true;
  for (const player of players) {
    if (!player.visitedFloorIds.includes(floorId)) continue;
    if (same && target[count] !== player.id) same = false;
    count += 1;
  }
  if (same && count === target.length) return;
  setStrings(
    target,
    players.filter((player) => player.visitedFloorIds.includes(floorId)).map((player) => player.id),
  );
}

/**
 * The select phase, in place like everything else: a pick row is upserted and
 * a leaver's deleted, so a patch carries only the focus that moved. Outside the
 * phase every field reads absent.
 */
function projectSelect(target: SelectStateSchema, select: SelectState | undefined): void {
  if (select === undefined) {
    target.step = ABSENT_ID;
    target.endsAtTick = ABSENT_TICK;
    // Cleared only when it holds rows: a clear is itself a patch.
    if (target.picks.size > 0) target.picks.clear();
    target.stageId = ABSENT_ID;
    target.stagePickedBy = ABSENT_ID;
    target.stageSeed = ABSENT_TICK;
    target.stageClassic = false;
    target.songId = ABSENT_ID;
    target.songPickedBy = ABSENT_ID;
    if (target.loaded.length > 0) setStrings(target.loaded, []);
    return;
  }

  target.step = select.step;
  target.endsAtTick = select.endsAtTick;
  for (const [id, pick] of Object.entries(select.picks)) {
    let row = target.picks.get(id);
    if (row === undefined) {
      row = new SelectPickSchema();
      target.picks.set(id, row);
    }
    row.focus = pick.focus;
    row.locked = pick.locked;
    row.seed = seedChoiceToWire(pick.seed);
  }
  for (const id of [...target.picks.keys()]) {
    if (select.picks[id as PlayerId] === undefined) target.picks.delete(id);
  }
  target.stageId = select.stage?.id ?? ABSENT_ID;
  target.stagePickedBy = select.stage?.pickedBy ?? ABSENT_ID;
  target.stageSeed = select.stage?.seed ?? ABSENT_TICK;
  target.stageClassic = select.stage?.classic ?? false;
  target.songId = select.song?.id ?? ABSENT_ID;
  target.songPickedBy = select.song?.pickedBy ?? ABSENT_ID;
  setStrings(target.loaded, select.loaded);
}
