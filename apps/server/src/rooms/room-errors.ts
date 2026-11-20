/**
 * How a room refuses a command, and how any failure reaches a player.
 *
 * A rule refuses by throwing `RoomCommandError`. The `CommandLedger` catches
 * whatever a command throws and turns it into the answer the player sees with
 * `toServerError`. Keeping both here lets the rules in `lobby-rules.ts`
 * refuse a command without knowing anything about Colyseus or the wire.
 */

import type { ServerErrorCode } from "@floor-fifty/shared/common/protocol";
import { ProtocolError } from "@floor-fifty/shared/common/schemas";

/** A refusal the client is expected to show the player, as opposed to a crash. */
export class RoomCommandError extends Error {
  constructor(
    readonly code: ServerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomCommandError";
  }
}

/**
 * Translates any thrown failure into something a client can render.
 *
 * A refusal and a malformed message keep their own code and words. Anything
 * else is a bug on our side, so the player gets a generic sentence and never
 * the bug's own text.
 */
export function toServerError(error: unknown): { code: ServerErrorCode; message: string } {
  if (error instanceof RoomCommandError) return { code: error.code, message: error.message };
  if (error instanceof ProtocolError) return { code: error.code, message: error.message };
  return { code: "MALFORMED_MESSAGE", message: "the server could not process that message" };
}
