/**
 * Input consumption.
 *
 * A client sends intent, never position. This module is the only place a
 * client-originated value influences the simulation, and it applies that value
 * to velocity alone.
 */

import type { PlayerId } from "../common/ids";
import type { HeldInput } from "../common/protocol";
import type { PlayerState, RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";

/** A neutral frame: what an absent or rejected input is treated as. */
const NEUTRAL: HeldInput = {
  sequence: 0,
  left: false,
  right: false,
  fastFall: false,
  reset: false,
};

/**
 * Only connected, unfinished players are simulated.
 *
 * A ghost freezes where they disconnected so that a reconnect inside the grace
 * window restores a player mid-ascent rather than at the bottom of a fall.
 */
export function isSimulated(player: PlayerState): boolean {
  return player.status === "connected" && player.finishedAtTick === undefined;
}

/** Whether a lapping racer is still resting at the spawn on this tick (race-flow spec §4.1). */
export function isHeld(player: PlayerState, tick: number): boolean {
  return player.holdUntilTick !== undefined && tick < player.holdUntilTick;
}

/**
 * Whether the solver moves this player: simulated, past their first input,
 * and not held after a lap.
 *
 * A player still waiting for it stands exactly where they spawned. Their body
 * is left out of the step, as a ghost's is, so gravity cannot drop them onto
 * the floor and the floor cannot bounce them off it. A held racer rests the
 * same way.
 */
export function isInMotion(player: PlayerState, tick: number): boolean {
  return isSimulated(player) && !player.awaitingInput && !isHeld(player, tick);
}

/**
 * Intent that outlives the moment it was read.
 *
 * Both sets are resolved once, here, and handed to the systems that own the
 * decisions they feed: respawns run after collision, and so does the fast-fall
 * override, because a fall that a contact has already cancelled is not a fall
 * the player asked for. Re-reading `inputs` in those systems would mean
 * repeating the accepted-versus-stale rule below and eventually disagreeing
 * with it.
 */
export type InputOutcome = {
  readonly resetRequests: ReadonlySet<PlayerId>;
  readonly fastFallRequests: ReadonlySet<PlayerId>;
};

/**
 * Applies the latest frame for every player and reports the deferred intent.
 *
 * A request is returned rather than stored, because it is intent for exactly
 * this tick: threading it keeps each decision in the system that owns it
 * instead of leaving a flag on the player for a later tick to misread.
 */
export function applyInputs(
  state: RaceState,
  inputs: ReadonlyMap<PlayerId, HeldInput>,
  tuning: ResolvedTuning,
): InputOutcome {
  const resetRequests = new Set<PlayerId>();
  const fastFallRequests = new Set<PlayerId>();

  for (const player of Object.values(state.players)) {
    if (!isSimulated(player)) continue;

    // A frame persists until a newer one replaces it, so an equal sequence is
    // the held state and only a strictly older one is stale.
    const frame = inputs.get(player.id);
    const accepted = frame !== undefined && frame.sequence >= player.lastSequence ? frame : NEUTRAL;
    // Whether this is the first tick to see this frame, as opposed to a tick
    // re-applying one already in force. Held state does not care; an edge does.
    const firstSight = accepted !== NEUTRAL && accepted.sequence > player.lastSequence;
    if (accepted !== NEUTRAL) {
      player.lastSequence = accepted.sequence;
    }

    // The lap hold (race-flow spec §4.1): sequenced, but nothing moves it and a
    // reset is not taken. On the release tick it bounces, and the frame in
    // force then applies below as on any other tick.
    if (isHeld(player, state.tick)) {
      player.vx = 0;
      player.vy = 0;
      continue;
    }
    if (player.holdUntilTick !== undefined) {
      delete player.holdUntilTick;
      player.vy = tuning.BOUNCE_VELOCITY;
    }

    // The first input of the race, whatever it asks for, starts the bounce;
    // everything below then applies to it as to any other frame.
    if (player.awaitingInput && (accepted.left || accepted.right || accepted.fastFall || accepted.reset)) {
      player.awaitingInput = false;
      player.vy = tuning.BOUNCE_VELOCITY;
    }

    const direction = (accepted.right ? 1 : 0) - (accepted.left ? 1 : 0);
    if (direction !== 0) {
      player.facingRight = direction > 0;
    }

    // The reference assigns horizontal velocity outright every frame
    // (`player.rs:125`). There is no ramp in either direction: releasing
    // stops a player dead, in the air as on a floor, and that dead stop is
    // the precision the climb is built on.
    player.vx = direction * tuning.MAX_MOVE_SPEED;

    if (accepted.fastFall) {
      player.vy = tuning.FAST_FALL_VELOCITY;
      fastFallRequests.add(player.id);
    }
    // `reset` is an edge, not a held state: one press is one respawn. The room
    // keeps a frame in force on every tick until a newer one takes over
    // (`InputQueue.take`), so a frame carrying a reset is seen on more than one
    // tick whenever the next frame is late, lost to a drop, or never sent by a
    // client that does not send one. Reading it as held would respawn the
    // player on every one of those ticks. The rule lives here rather than in
    // the room so that a client replaying its own frames reaches the same
    // answer the room did.
    if (accepted.reset && firstSight) {
      resetRequests.add(player.id);
    }
  }

  return { resetRequests, fastFallRequests };
}

/**
 * Restores a held fast fall that a bounce overwrote.
 *
 * The reference reads the two in this order for a reason: the upforce is
 * applied first and the fast fall second (`player.rs:128-137`), with no
 * exception for a landing. That makes the control the only way to stop the
 * automatic ascent — holding it on a floor pins a player to it, and holding it
 * against a wall abandons the ride.
 */
export function applyFastFallOverride(
  state: RaceState,
  fastFallRequests: ReadonlySet<PlayerId>,
  tuning: ResolvedTuning,
): void {
  for (const player of Object.values(state.players)) {
    if (!isSimulated(player)) continue;
    if (isHeld(player, state.tick)) continue;
    if (!fastFallRequests.has(player.id)) continue;

    player.vy = tuning.FAST_FALL_VELOCITY;
  }
}
