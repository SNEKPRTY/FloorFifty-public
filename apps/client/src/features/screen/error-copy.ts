/**
 * What a failure says, chosen from its code (languages spec §4.4).
 *
 * The server's `message` is operator English and is never shown; it stays in
 * logs. A `detail` keeps the distinctions the client already drew -- a room
 * that closed while you were away is not a seat you lost -- without carrying
 * prose across a screen change.
 */

import type { ServerErrorCode } from "@floor-fifty/shared/common/protocol";
import * as m from "../../paraglide/messages.js";
import type { ErrorDetail, RecoverableErrorCode } from "../net/error-view";

export type ErrorCode = RecoverableErrorCode | ServerErrorCode;

const BY_CODE: Readonly<Record<ErrorCode, () => string>> = {
  INVALID_ROOM: m.error_invalid_room,
  ROOM_FULL: m.error_room_full,
  VERSION_MISMATCH: m.error_version_mismatch,
  ASSET_LOAD_FAILED: m.error_game_assets,
  ROOM_CLOSED: m.error_room_closed,
  SIMULATION_FAILURE: m.error_simulation_failure,
  NOT_HOST: m.error_not_host,
  MALFORMED_MESSAGE: m.error_malformed_message,
  RATE_LIMITED: m.error_rate_limited,
  STILL_SEARCHING: m.error_still_searching,
  SERVER_UPDATING: m.error_server_updating,
  SERVER_BUSY: m.error_server_busy,
  UNREACHABLE: m.error_unreachable,
};

const BY_DETAIL: Readonly<Record<ErrorDetail, () => string>> = {
  "last-room-closed": m.error_last_room_closed,
  "presentation-failed": m.error_presentation_failed,
  "seat-lost": m.error_seat_lost,
  "room-silent": m.error_room_silent,
  "room-racing": m.error_room_racing,
  "game-assets": m.error_game_assets,
  "race-assets": m.error_race_assets,
  "server-moving-public": m.error_server_moving,
  "server-moving-private": m.error_server_moving,
};

export const ERROR_CODES = Object.keys(BY_CODE) as readonly ErrorCode[];

export function errorCopy(code: ErrorCode, detail?: ErrorDetail): () => string {
  return detail === undefined ? BY_CODE[code] : BY_DETAIL[detail];
}

/** For a thrown `Error` with no code: a sentence that names no cause it does not know. */
export const unknownErrorCopy = m.error_unknown;
