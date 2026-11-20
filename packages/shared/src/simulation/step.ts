/**
 * The race's rules that outlive a physics step.
 *
 * Deciding a lap and deciding the race are not the solver's business: they
 * read a state the solver has already produced. They live here so the Planck
 * step and the consequences pass can both reach them without either importing
 * the other's machinery.
 */

import { FINITE_RACE_TIME_LIMIT_TICKS } from "../common/constants";
import type { RaceEvent } from "../common/protocol";
import type { PlayerId } from "../common/ids";
import { raceEventId } from "../common/ids";
import type { PlayerState, RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import { isEndless } from "./endless";
import { isSimulated } from "./input";
import { respawnPlayer } from "./players";

/** Presentation-only solver observations; never serialized into authority or replay. */
export type SideContactObservation = Readonly<{ tick: number; playerId: PlayerId; floorId: string; x: number; y: number; facingLeft: boolean }>;
export type StepResult = { state: RaceState; events: readonly RaceEvent[]; sideContacts: readonly SideContactObservation[] };

/**
 * Advances lap state and decides the race.
 *
 * Standings and the winner are written here and nowhere else. A client that
 * wanted to compute either would have to reimplement this function, which is
 * exactly the situation the authority split exists to prevent.
 */
export function resolveLapAndWinner(
  state: RaceState,
  events: RaceEvent[],
  tuning: ResolvedTuning,
): void {
  // An endless course has no lap to complete: Survival's standing and its clock decide the race.
  if (isEndless(tuning)) {
    resolveSurvival(state, events, tuning);
    return;
  }

  for (const player of Object.values(state.players)) {
    if (!isSimulated(player)) continue;
    if (player.visitedFloorIds.length < state.course.floorCount) continue;

    const completedLap = player.lap;

    if (completedLap < state.lapCount) {
      events.push({
        id: raceEventId(state.tick, "lapCompleted", player.id, String(completedLap)),
        tick: state.tick,
        type: "lapCompleted",
        playerId: player.id,
        lap: completedLap,
      });
      player.lap = completedLap + 1;
      respawnPlayer(state, player, tuning);
      if (tuning.LAP_HOLD_TICKS > 0) {
        player.holdUntilTick = state.tick + tuning.LAP_HOLD_TICKS;
        player.vx = 0;
        player.vy = 0;
      }
      continue;
    }

    // Order and elapsed time are recorded in the same tick the ascent
    // completes, so two players finishing together still resolve to one order.
    player.finishedAtTick = state.tick - (state.raceStartedAtTick ?? 0);
    state.standings.push(player.id);

    if (state.winnerId === undefined) {
      state.winnerId = player.id;
      events.push({
        id: raceEventId(state.tick, "raceFinished", player.id, String(completedLap)),
        tick: state.tick,
        type: "raceFinished",
        winnerId: player.id,
      });
    }
    state.phase = "finished";
  }

  // The course was not finished by anyone: a finite race has a clock too (audit S11).
  if (state.phase === "racing") endFiniteRaceOnClock(state, events);
}

/**
 * Ends a finite race that has run out of time: the racers still in it rank by
 * the highest floor they reached, then who reached it first, then those who
 * never started by ID. A race with only DNS racers ends with no winner, as a
 * Survival race does.
 */
function endFiniteRaceOnClock(state: RaceState, events: RaceEvent[]): void {
  const elapsed = state.tick - (state.raceStartedAtTick ?? 0);
  if (elapsed < FINITE_RACE_TIME_LIMIT_TICKS) return;
  const players = Object.values(state.players);
  const standing = players.filter((player) => player.status !== "dns").sort(compareBestFloor);
  const dns = players
    .filter((player) => player.status === "dns")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const player of standing) player.finishedAtTick = elapsed;
  state.standings = [...standing, ...dns].map((player) => player.id);
  state.phase = "finished";

  const winner = standing[0];
  if (winner === undefined) return;
  state.winnerId = winner.id;
  events.push({
    id: raceEventId(state.tick, "raceFinished", winner.id, "clock"),
    tick: state.tick,
    type: "raceFinished",
    winnerId: winner.id,
  });
}

/** Best floor, highest first; then whoever reached it first (never is last); then player ID. A total order. */
export function compareBestFloor(a: PlayerState, b: PlayerState): number {
  if (a.bestFloor !== b.bestFloor) return b.bestFloor - a.bestFloor;
  const at = (player: PlayerState): number => player.bestFloorAtTick ?? Number.POSITIVE_INFINITY;
  if (at(a) !== at(b)) return at(a) < at(b) ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Latest out first; a tie by best floor. */
function compareOut(a: PlayerState, b: PlayerState): number {
  if (a.outAtTick !== b.outAtTick) return (b.outAtTick ?? 0) - (a.outAtTick ?? 0);
  return compareBestFloor(a, b);
}

/**
 * Ends a Survival race (survival spec §4): when one racer of several is left,
 * when nobody is, or on the clock. Racers still standing rank by best floor,
 * then those who went out by how long they lasted, then DNS racers by ID. A
 * ghost still stands until it becomes a DNS, so a drop that outlasts everyone
 * still standing can win, as an idle racer can. A race with only DNS racers
 * ends with no winner.
 *
 * Going out decides a racer's place: one who leaves after going out becomes a
 * DNS in the room (`race-room.ts`) but keeps the place their fall earned.
 */
function resolveSurvival(state: RaceState, events: RaceEvent[], tuning: ResolvedTuning): void {
  const elapsed = state.tick - (state.raceStartedAtTick ?? 0);
  const players = Object.values(state.players);
  const standing = players.filter((player) => player.status !== "dns" && player.outAtTick === undefined);
  const lastOne = players.length >= 2 && standing.length <= 1;
  if (!lastOne && standing.length > 0 && elapsed < tuning.RACE_TIME_LIMIT_TICKS) return;

  const out = players.filter((player) => player.outAtTick !== undefined).sort(compareOut);
  const dns = players
    .filter((player) => player.status === "dns" && player.outAtTick === undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  standing.sort(compareBestFloor);
  for (const player of standing) player.finishedAtTick = elapsed;
  state.standings = [...standing, ...out, ...dns].map((player) => player.id);
  state.phase = "finished";

  const winner = standing[0] ?? out[0];
  if (winner === undefined) return;
  state.winnerId = winner.id;
  events.push({
    id: raceEventId(state.tick, "raceFinished", winner.id, "survival"),
    tick: state.tick,
    type: "raceFinished",
    winnerId: winner.id,
  });
}
