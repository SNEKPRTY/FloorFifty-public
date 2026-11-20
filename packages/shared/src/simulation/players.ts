/**
 * Where a player stands and where they go back to.
 *
 * Movement itself belongs to the solver: Planck integrates the bodies, and
 * this module answers the two questions the rules ask about the result -- how
 * far above a floor a player's feet are, and where their ascent restarts.
 */

import type { PlayerState, RaceState } from "../common/state";
import { spawnPosition } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";

/** Bottom edge of a player's collision box. */
export function playerBottom(player: PlayerState, tuning: ResolvedTuning): number {
  return player.y - tuning.PLAYER_HEIGHT / 2;
}

/**
 * Returns a player to the start of their current ascent.
 *
 * Only the visited set is cleared; the lap is not, because a fall costs an
 * ascent's progress and never a lap already earned.
 */
export function respawnPlayer(
  state: RaceState,
  player: PlayerState,
  tuning: ResolvedTuning,
): void {
  const spawn = spawnPosition(state.course, tuning);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = tuning.BOUNCE_VELOCITY;
  player.grounded = true;
  // A respawn is mid-play, so it bounces at once rather than waiting again.
  player.awaitingInput = false;
  player.visitedFloorIds = [state.course.floors[0]!.id];
}
