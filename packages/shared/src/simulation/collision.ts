/**
 * Floor credit, horizontal wrap, and death-line resets.
 *
 * What a *contact* means -- a landing, a bounce, a push out of a floor -- is
 * the solver's business and now lives in `planck/consequences.ts`, which reads
 * the same simulation coordinates this module does. Nothing here decides
 * whether two bodies touched; this is what happens after the solver has said
 * they did.
 *
 * Collision reads simulation coordinates only. Render transforms -- camera
 * follow, zoom, letterboxing -- never reach this module, so what a player sees
 * and what the server resolves cannot diverge.
 */

import { VIEWPORT } from "../common/constants";
import type { PlayerId } from "../common/ids";
import { raceEventId } from "../common/ids";
import { wrapSymmetric } from "../common/math";
import type { RaceEvent } from "../common/protocol";
import type { PlayerState, RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import type { Floor } from "../level/course";
import { isEndless } from "./endless";
import { isSimulated } from "./input";
import { respawnPlayer } from "./players";
import { advanceEdges } from "./survival";

/**
 * Credits a floor to a player, once per ascent.
 *
 * A floor counts once however it was earned, so the visited set and the event
 * live here rather than in either resolution pass. A re-landing, or a ride back
 * across a floor already collected, is movement without progress.
 */
export function creditFloor(
  state: RaceState,
  player: PlayerState,
  floor: Floor,
  events: RaceEvent[],
): void {
  if (player.visitedFloorIds.includes(floor.id)) return;
  player.visitedFloorIds.push(floor.id);
  events.push({
    id: raceEventId(state.tick, "floorLanded", player.id, floor.id),
    tick: state.tick,
    type: "floorLanded",
    playerId: player.id,
    floorId: floor.id,
    floorIndex: floor.index,
  });

  // Infinite's standing (D-O3). Any credit counts, foot or top: a climber's
  // landings arrive through the foot sensor (phase 3's finding).
  if (floor.index > player.bestFloor) {
    player.bestFloor = floor.index;
    player.bestFloorAtTick = state.tick - (state.raceStartedAtTick ?? 0);
  }
}

/**
 * Wraps players horizontally and respawns anyone who fell or asked to reset.
 * In Survival nobody respawns: each racer's rising edge decides, and a racer
 * below it is out (survival spec §3).
 *
 * A reset costs one player their ascent and nobody else anything, which is why
 * it is resolved per player rather than as a race-wide event.
 */
export function resolveWrapAndDeaths(
  state: RaceState,
  resetRequests: ReadonlySet<PlayerId>,
  events: RaceEvent[],
  tuning: ResolvedTuning,
): void {
  const half = VIEWPORT.width / 2;

  for (const player of Object.values(state.players)) {
    if (!isSimulated(player)) continue;

    player.x = wrapSymmetric(player.x, half);
    // Survival has no respawn: the edge decides, below (survival spec §3).
    if (isEndless(tuning)) continue;

    const manual = resetRequests.has(player.id);
    if (!manual && player.y >= state.course.deathLineY) continue;

    const reason = manual ? "manual" : "fall";
    respawnPlayer(state, player, tuning);
    events.push({
      id: raceEventId(state.tick, "playerReset", player.id, reason),
      tick: state.tick,
      type: "playerReset",
      playerId: player.id,
      reason,
    });
  }

  advanceEdges(state, events, tuning);
}
