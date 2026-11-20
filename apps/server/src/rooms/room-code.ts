/**
 * Room identity.
 *
 * The six-character code a player reads off a screen *is* the Colyseus room
 * id, so joining by code is `joinById` and there is no second table mapping
 * one to the other. That is the whole reason a custom id is worth the trouble.
 *
 * Codes are claimed in Presence rather than in a process-local map, so two
 * server processes behind one address share one namespace and cannot hand the
 * same code to two rooms.
 */

import { randomInt } from "node:crypto";
import type { Presence } from "@colyseus/core";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@floor-fifty/shared/common/schemas";

export { ROOM_CODE_ALPHABET };

/** The Presence set holding every live room code. */
export const ROOM_CODE_CHANNEL = "floor-fifty:rooms";

/** Bounded so a failing random source cannot spin forever. */
export const CODE_ATTEMPTS = 8;

export function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Claims a free code.
 *
 * `sadd` is checked rather than assumed: two processes can generate the same
 * unclaimed code in the same instant, and only the set membership decides it.
 */
export async function claimRoomCode(presence: Presence): Promise<string> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode();
    const taken = await presence.sismember(ROOM_CODE_CHANNEL, code);
    if (taken) continue;
    await presence.sadd(ROOM_CODE_CHANNEL, code);
    return code;
  }
  throw new Error("could not allocate a room code");
}

export async function releaseRoomCode(presence: Presence, code: string): Promise<void> {
  await presence.srem(ROOM_CODE_CHANNEL, code);
}

/**
 * A random course seed for a room.
 *
 * Moved here from `common/session-token.ts`, which the Socket.IO cutover
 * deletes. A seed is an input to generation and never a result.
 */
export function createCourseSeed(): number {
  return randomInt(0, 0x7fffffff);
}
