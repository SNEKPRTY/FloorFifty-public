/**
 * A reference controller.
 *
 * Given a race state, decides which direction a player should hold to climb.
 * It is also where a CPU's steering starts: `cpu/controller.ts` wraps it, and
 * the server calls that during an ordinary race when a room has CPU seats.
 * It exists so these agree:
 *
 *   - the end-to-end room driver, which finishes a race in a test without a
 *     human spending a minute climbing,
 *   - the course completability test, which proves a generated course can
 *     actually be climbed before anyone is asked to climb it, and
 *   - the CPU racers, which steer with it and add a personality on top.
 *
 * Keeping one implementation is the point. Two copies of a controller this
 * subtle would drift, and the drift would show up as a flaky end-to-end test
 * rather than as a failure anyone could read.
 */

import { VIEWPORT } from "../common/constants";
import { shortestWrappedOffset } from "../common/math";
import type { PlayerId } from "../common/ids";
import type { HeldInput } from "../common/protocol";
import type { RaceState } from "../common/state";
import { floorX } from "../common/state";
import type { Floor } from "./course";
import { CONTACT_TOLERANCE_PIXELS } from "../simulation/planck/config";

/**
 * How close counts as arrived.
 *
 * Wide enough that the controller stops fighting for the last pixel, and far
 * narrower than the overlap a landing needs.
 */
const ARRIVED_WITHIN = 4;

/**
 * How much of the landing overlap counts as lined up.
 *
 * Measured over two hundred courses: `0.8` finishes them in a median of 15.8
 * seconds against `0.5`'s 17.8, because committing to the drop a little
 * earlier costs less than the extra airtime it saves.
 */
const LINED_UP_FRACTION = 0.8;

/**
 * How far beyond a floor's side counts as clear of it.
 *
 * Used only to break out from under a floor, where aiming at the edge itself
 * would leave the player oscillating across it. The margin covers the tick of
 * drift between choosing a direction and arriving.
 */
const EDGE_CLEARANCE = 8;

/**
 * The floor a player should be heading for.
 *
 * The floor they still need, when they have already risen above it and can drop
 * onto it; otherwise the next floor up, because reaching a missed floor means
 * climbing past it again.
 */
export function targetFloor(state: RaceState, playerId: PlayerId): Floor | undefined {
  const player = state.players[playerId];
  if (player === undefined) return undefined;

  const required = state.course.floors.find(
    (floor) => !player.visitedFloorIds.includes(floor.id),
  );
  if (required !== undefined && required.y <= player.y) return required;
  return state.course.floors.find((floor) => floor.y > player.y) ?? required;
}

/**
 * Shortest signed horizontal distance to `x`, accounting for the wrap.
 *
 * A target a little way off one edge is closer through the seam than across the
 * whole viewport, and a controller that does not know that will always take the
 * long way round.
 */
export function wrappedOffset(from: number, to: number): number {
  return shortestWrappedOffset(from, to, VIEWPORT.width);
}

/** What a caller may vary about the steering. Absent fields keep the reference behaviour. */
export type SteerOptions = {
  /** How much of the landing overlap counts as lined up before a drop; `LINED_UP_FRACTION` unless given. */
  linedUpFraction?: number;
};

/** Decides one input frame for one player. */
export function steerPlayer(
  state: RaceState,
  playerId: PlayerId,
  sequence: number,
  options: SteerOptions = {},
): HeldInput | undefined {
  const player = state.players[playerId];
  if (player === undefined) return undefined;

  const target = targetFloor(state, playerId);
  if (target === undefined) {
    return { sequence, left: false, right: false, fastFall: false, reset: false };
  }

  const reachX = (state.tuning.FLOOR_WIDTH + state.tuning.PLAYER_WIDTH) / 2;
  const reachY = (state.tuning.FLOOR_HEIGHT + state.tuning.PLAYER_HEIGHT) / 2;
  const centre = floorX(state, target);
  const toCentre = wrappedOffset(player.x, centre);
  const targetTop = target.y + state.tuning.FLOOR_HEIGHT / 2;
  const above = player.y - state.tuning.PLAYER_HEIGHT / 2 > targetTop;

  // Contact lifts a player whichever face they touch, so pressing into a floor
  // is how a climb gains the height one bounce cannot pay for. The single
  // configuration that deadlocks is being held against an underside: the
  // contact re-applies the bounce and the push-out returns the player to the
  // same spot, forever. That is exactly the case where the shallower
  // penetration is vertical and the push is downward, so it is the only case
  // that steers for an edge. A side ride has its shallower penetration
  // horizontal and is left alone, because it is the thing that works.
  //
  // The penetrations are compared with a tolerance: the solver rests a held
  // player inside its contact skin, a fraction of a pixel short of the face,
  // so an exact test never fires on the deadlock it exists to break.
  const dy = player.y - target.y;
  const penetrationX = reachX - Math.abs(toCentre);
  const penetrationY = reachY - Math.abs(dy);
  const roofed =
    penetrationX >= -CONTACT_TOLERANCE_PIXELS &&
    penetrationY >= -CONTACT_TOLERANCE_PIXELS &&
    dy < 0 &&
    penetrationY <= penetrationX;

  const side = toCentre >= 0 ? 1 : -1;
  const aim = roofed ? centre - side * (reachX + EDGE_CLEARANCE) : centre;
  const offset = wrappedOffset(player.x, aim);

  // Fast fall is the precision control, and using it is what stops a climb
  // from sailing past the floor it needs. Once the player is above the target
  // and lined up with it, dropping is strictly better than drifting.
  const lined = Math.abs(toCentre) < reachX * (options.linedUpFraction ?? LINED_UP_FRACTION);
  const fastFall = lined && above;

  if (Math.abs(offset) <= ARRIVED_WITHIN) {
    return { sequence, left: false, right: false, fastFall, reset: false };
  }

  return {
    sequence,
    left: offset < 0,
    right: offset > 0,
    fastFall,
    reset: false,
  };
}


/**
 * How long without a new floor counts as stalled.
 *
 * Generous enough that an ordinary run of bad luck is not mistaken for a dead
 * end, and short enough that a real one does not eat a whole race.
 */
const STALL_TICKS = 60 * 12;

export type ClimbController = {
  /** The input to hold this tick. */
  next(state: RaceState, sequence: number): HeldInput | undefined;
};

/**
 * A controller that can get itself unstuck.
 *
 * `steerPlayer` alone is memoryless, and a memoryless controller in a
 * deterministic simulation repeats a mistake forever: every landing bounces a
 * player upward, so a floor left behind is out of reach, and a player
 * surrounded by floors can bounce indefinitely without ever falling far enough
 * to die. That is a genuine dead end, and the game already has the move for
 * it -- the self-reset. This wrapper notices that no new floor has been
 * collected for a while and uses it.
 *
 * A reset restarts the ascent from the ground with the visited set cleared, and
 * the moving floors have travelled on in the meantime, so the retry is not a
 * replay of the attempt that failed.
 */
export function createClimbController(playerId: PlayerId): ClimbController {
  let lastVisited = -1;
  let stalledFor = 0;

  return {
    next(state, sequence) {
      const player = state.players[playerId];
      if (player === undefined) return undefined;

      const visited = player.visitedFloorIds.length;
      if (visited !== lastVisited) {
        lastVisited = visited;
        stalledFor = 0;
      } else {
        stalledFor += 1;
      }

      if (stalledFor >= STALL_TICKS) {
        stalledFor = 0;
        return { sequence, left: false, right: false, fastFall: false, reset: true };
      }

      return steerPlayer(state, playerId, sequence);
    },
  };
}
